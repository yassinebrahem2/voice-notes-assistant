import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch } from './client';
import { ApiError } from './errors';
import { queryClient } from './queryClient';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
  } as unknown as Response;
}

beforeEach(() => {
  jest
    .mocked(AsyncStorage.getItem)
    .mockResolvedValue('https://server.example/');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('prefixes the stored URL and forwards request options', async () => {
  const fetch = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(response(200, { id: 'rec_x' }));
  expect(
    await apiFetch('/recordings', {
      method: 'PATCH',
      body: '{}',
      headers: { 'X-Test': 'yes' },
    }),
  ).toEqual({ id: 'rec_x' });
  expect(fetch).toHaveBeenCalledWith(
    'https://server.example/api/v1/recordings',
    expect.objectContaining({
      method: 'PATCH',
      body: '{}',
      headers: { 'X-Test': 'yes' },
      signal: expect.any(AbortSignal),
    }),
  );
});

test('accepts a no-content response without parsing JSON', async () => {
  const result = response(204, undefined);
  jest.spyOn(global, 'fetch').mockResolvedValue(result);
  expect(
    await apiFetch('/recordings/rec_x', { method: 'DELETE' }),
  ).toBeUndefined();
  expect(result.json).not.toHaveBeenCalled();
});

test('preserves a valid error contract', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(
    response(501, {
      error: { code: 'not_implemented', message: 'Coming soon.' },
    }),
  );
  await expect(apiFetch('/recordings')).rejects.toMatchObject({
    status: 501,
    code: 'not_implemented',
    message: 'Coming soon.',
  });
});

test('unknown contract codes retain the server message', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(
    response(409, {
      error: { code: 'future_code', message: 'New failure description.' },
    }),
  );
  await expect(apiFetch('/recordings')).rejects.toMatchObject({
    code: 'internal_error',
    message: 'New failure description.',
  });
});

test.each([
  null,
  { detail: 'Private internal detail' },
  { error: { code: 'not_found', message: 42 } },
])('malformed error bodies fall back to a generic error', async (body) => {
  jest.spyOn(global, 'fetch').mockResolvedValue(response(500, body));
  await expect(apiFetch('/recordings')).rejects.toMatchObject({
    status: 500,
    code: 'internal_error',
    message: 'The server returned an invalid response.',
  });
});

test('non-JSON error responses do not expose their body', async () => {
  const result = response(500, undefined);
  jest
    .mocked(result.json)
    .mockRejectedValue(new Error('Private internal detail'));
  jest.spyOn(global, 'fetch').mockResolvedValue(result);
  await expect(apiFetch('/recordings')).rejects.toMatchObject({
    code: 'internal_error',
    message: 'The server returned an invalid response.',
  });
});

test('invalid success JSON is a controlled internal error', async () => {
  const result = response(200, undefined);
  jest.mocked(result.json).mockRejectedValue(new Error('Invalid JSON'));
  jest.spyOn(global, 'fetch').mockResolvedValue(result);
  await expect(apiFetch('/recordings')).rejects.toMatchObject({
    code: 'internal_error',
  });
});

test('fetch rejection maps to network_error', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Fetch failed'));
  await expect(apiFetch('/recordings')).rejects.toMatchObject({
    status: 0,
    code: 'network_error',
  });
});

test('a missing server URL yields a controlled error before fetching', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const fetch = jest.spyOn(global, 'fetch');
  await expect(apiFetch('/health')).rejects.toBeInstanceOf(ApiError);
  expect(fetch).not.toHaveBeenCalled();
});

test('the default deadline aborts even if fetch never settles', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    signal = init?.signal;
    return new Promise(() => {});
  });
  const request = apiFetch('/health');
  const rejected = expect(request).rejects.toMatchObject({ code: 'timeout' });
  await jest.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('the deadline also covers reading the response body', async () => {
  jest.useFakeTimers();
  const result = response(200, undefined);
  jest.mocked(result.json).mockReturnValue(new Promise(() => {}));
  jest.spyOn(global, 'fetch').mockResolvedValue(result);
  const rejected = expect(
    apiFetch('/health', { timeoutMs: 50 }),
  ).rejects.toMatchObject({ code: 'timeout' });
  await jest.advanceTimersByTimeAsync(50);
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});

test('forwards external cancellation and removes its listener', async () => {
  const external = new AbortController();
  const remove = jest.spyOn(external.signal, 'removeEventListener');
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  jest.spyOn(global, 'fetch').mockImplementation(() => {
    markStarted();
    return new Promise(() => {});
  });
  const rejected = expect(
    apiFetch('/health', { signal: external.signal }),
  ).rejects.toMatchObject({ code: 'timeout' });
  await started;
  external.abort();
  await rejected;
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

test('an already cancelled signal prevents the request', async () => {
  const external = new AbortController();
  external.abort();
  const fetch = jest.spyOn(global, 'fetch');
  await expect(
    apiFetch('/health', { signal: external.signal }),
  ).rejects.toMatchObject({ code: 'timeout' });
  expect(fetch).not.toHaveBeenCalled();
});

test('a successful request clears the deadline and caller listener', async () => {
  jest.useFakeTimers();
  const external = new AbortController();
  const remove = jest.spyOn(external.signal, 'removeEventListener');
  jest.spyOn(global, 'fetch').mockResolvedValue(response(200, {}));
  await apiFetch('/health', { signal: external.signal });
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

test('query defaults retry twice with backoff while mutations never retry', () => {
  const defaults = queryClient.getDefaultOptions();
  expect(defaults.queries?.retry).toBe(2);
  expect(defaults.mutations?.retry).toBe(0);
  expect(typeof defaults.queries?.retryDelay).toBe('function');
  const delay = defaults.queries?.retryDelay;
  if (typeof delay !== 'function') throw new Error('Expected retry backoff.');
  expect(delay(0, new Error())).toBe(1000);
  expect(delay(1, new Error())).toBe(2000);
});
