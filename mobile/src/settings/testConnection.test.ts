import { testConnection } from './testConnection';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('../config/appInfo', () => ({
  appInfo: { name: 'Test App', version: '1.2.3' },
}));

const health = {
  app_name: 'Test App',
  roles: { llm: 'ready' },
  speech_backend: 'fake',
  version: '0.1.0',
};

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('http is rejected without any request', async () => {
  const fetch = jest.spyOn(global, 'fetch');
  expect(await testConnection('http://laptop:8000')).toEqual({
    ok: false,
    problem: 'not_https',
  });
  expect(fetch).not.toHaveBeenCalled();
});

test('requests the typed URL, normalised, not the stored one', async () => {
  const AsyncStorage = jest.requireMock<{
    default: { getItem: jest.Mock };
  }>('@react-native-async-storage/async-storage').default;
  AsyncStorage.getItem.mockResolvedValue('https://stored.example');
  const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(response(health));
  expect(await testConnection(' https://typed.example/ ')).toEqual({
    ok: true,
    health,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe('https://typed.example/api/v1/health');
});

test('a network error is unreachable', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('offline'));
  expect(await testConnection('https://typed.example')).toEqual({
    ok: false,
    problem: 'unreachable',
  });
});

test('no answer within 5 seconds is unreachable', async () => {
  jest.useFakeTimers();
  jest.spyOn(global, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  const result = testConnection('https://typed.example');
  await jest.advanceTimersByTimeAsync(5000);
  expect(await result).toEqual({ ok: false, problem: 'unreachable' });
});

test('a fetch that ignores abort still ends as unreachable after 5 seconds', async () => {
  jest.useFakeTimers();
  jest.spyOn(global, 'fetch').mockReturnValue(new Promise(() => undefined));
  const result = testConnection('https://typed.example');
  await jest.advanceTimersByTimeAsync(5000);
  expect(await result).toEqual({ ok: false, problem: 'unreachable' });
});

test('a body that stalls past the timeout is unreachable', async () => {
  jest.useFakeTimers();
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => new Promise(() => undefined),
  } as unknown as Response);
  const result = testConnection('https://typed.example');
  await jest.advanceTimersByTimeAsync(5000);
  expect(await result).toEqual({ ok: false, problem: 'unreachable' });
});

test('another app name is not this server', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(response({ ...health, app_name: 'Other' }));
  expect(await testConnection('https://typed.example')).toEqual({
    ok: false,
    problem: 'not_this_server',
  });
});

test('a body that is not HealthOut is not this server', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(response({ hello: 'x' }));
  expect(await testConnection('https://typed.example')).toEqual({
    ok: false,
    problem: 'not_this_server',
  });
});

test('a non-JSON or error response is not this server', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => {
      throw new SyntaxError('bad json');
    },
  } as unknown as Response);
  expect(await testConnection('https://typed.example')).toEqual({
    ok: false,
    problem: 'not_this_server',
  });
});

test('an unparseable URL throws the normaliser message', async () => {
  await expect(testConnection('nonsense')).rejects.toThrow(
    'Enter a valid HTTP or HTTPS server URL.',
  );
});
