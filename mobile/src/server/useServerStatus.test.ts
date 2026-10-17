import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { apiFetch } from '../api/client';
import { setServerUrl } from '../settings/serverUrl';
import {
  reportNetworkError,
  reportNoServer,
  reportOk,
  resetStatus,
  useServerStatusValue,
} from './statusStore';
import { useServerStatus } from './useServerStatus';

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
  resetStatus();
  jest.useFakeTimers();
  jest
    .mocked(AsyncStorage.getItem)
    .mockResolvedValue('https://server.example/');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('starts unknown and the store tracks reports', async () => {
  const { result } = await renderHook(() => useServerStatusValue());
  expect(result.current).toBe('unknown');
  await act(async () => reportOk());
  expect(result.current).toBe('ok');
  await act(async () => reportNetworkError());
  expect(result.current).toBe('unreachable');
});

test('the first network error flips to unreachable without waiting for retries', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Fetch failed'));
  const { result } = await renderHook(() => useServerStatusValue());
  await act(async () => {
    await expect(apiFetch('/recordings')).rejects.toMatchObject({
      code: 'network_error',
    });
  });
  expect(result.current).toBe('unreachable');
});

test('a timeout flips to unreachable', async () => {
  jest.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
  const { result } = await renderHook(() => useServerStatusValue());
  await act(async () => {
    const rejected = expect(apiFetch('/recordings')).rejects.toMatchObject({
      code: 'timeout',
    });
    await jest.advanceTimersByTimeAsync(10_000);
    await rejected;
  });
  expect(result.current).toBe('unreachable');
});

test('a caller cancellation is not a network failure', async () => {
  const external = new AbortController();
  jest.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
  const { result } = await renderHook(() => useServerStatusValue());
  await act(async () => {
    const rejected = expect(
      apiFetch('/recordings', { signal: external.signal }),
    ).rejects.toMatchObject({ code: 'timeout' });
    await jest.advanceTimersByTimeAsync(0);
    external.abort();
    await rejected;
  });
  expect(result.current).toBe('unknown');
});

test.each([200, 404, 500])(
  'a %s response proves the server is reachable',
  async (status) => {
    reportNetworkError();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        response(status, { error: { code: 'not_found', message: 'x' } }),
      );
    const { result } = await renderHook(() => useServerStatusValue());
    await act(async () => {
      await apiFetch('/recordings').catch(() => undefined);
    });
    expect(result.current).toBe('ok');
  },
);

test('an unparseable body still proves reachability', async () => {
  const bad = response(200, undefined);
  jest.mocked(bad.json).mockRejectedValue(new Error('Invalid JSON'));
  jest.spyOn(global, 'fetch').mockResolvedValue(bad);
  const { result } = await renderHook(() => useServerStatusValue());
  await act(async () => {
    await apiFetch('/recordings').catch(() => undefined);
  });
  expect(result.current).toBe('ok');
});

test('a missing server URL does not flip to unreachable', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const { result } = await renderHook(() => useServerStatusValue());
  await act(async () => {
    await expect(apiFetch('/health')).rejects.toMatchObject({
      message: 'Set a server URL in Settings.',
    });
  });
  expect(result.current).toBe('unknown');
});

test('an unreadable server URL does not flip to unreachable', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('storage'));
  const { result } = await renderHook(() => useServerStatusValue());
  await act(async () => {
    await expect(apiFetch('/health')).rejects.toBeTruthy();
  });
  expect(result.current).toBe('unknown');
});

test('polls /health every 10 s while unreachable and stops once it answers', async () => {
  const fetch = jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new TypeError('Fetch failed'));
  const { result } = await renderHook(() => useServerStatus());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(fetch).not.toHaveBeenCalled();

  await act(async () => reportNetworkError());
  expect(result.current).toBe('unreachable');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(9_999);
  });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenLastCalledWith(
    'https://server.example/api/v1/health',
    expect.anything(),
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current).toBe('unreachable');

  fetch.mockResolvedValue(response(200, {}));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(result.current).toBe('ok');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(jest.getTimerCount()).toBe(0);
});

test('never overlaps polls and cleans up on unmount', async () => {
  const fetch = jest
    .spyOn(global, 'fetch')
    .mockImplementation(() => new Promise(() => {}));
  const { unmount } = await renderHook(() => useServerStatus());
  await act(async () => reportNetworkError());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(9_000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await unmount();
  // Unmounting cancels the in-flight poll, which then clears its own deadline timer.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('no stored server URL reports no_server without polling', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const fetch = jest.spyOn(global, 'fetch');
  const { result } = await renderHook(() => useServerStatus());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(result.current).toBe('no_server');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  ['ok', reportOk],
  ['no_server', reportNoServer],
])('a changed server URL resets %s to unknown', async (_name, report) => {
  const { result } = await renderHook(() => useServerStatus());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  await act(async () => report());
  await act(async () => setServerUrl('https://other.example'));
  expect(result.current).toBe('unknown');
});

test('the first URL load does not wipe a failure reported before it finished', async () => {
  reportNetworkError();
  const { result } = await renderHook(() => useServerStatus());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(result.current).toBe('unreachable');
});

test.each([
  ['unknown', () => undefined],
  ['ok', reportOk],
  ['no_server', reportNoServer],
])('never polls /health while the status is %s', async (_name, report) => {
  const fetch = jest.spyOn(global, 'fetch');
  report();
  await renderHook(() => useServerStatus());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
