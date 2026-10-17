import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  getServerUrl,
  normalizeServerUrl,
  setServerUrl,
  useServerUrl,
} from './serverUrl';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

beforeEach(() => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockReset().mockResolvedValue();
});

test('normalizes surrounding whitespace and trailing slashes', () => {
  expect(normalizeServerUrl('  https://laptop.tail.ts.net/// ')).toEqual({
    url: 'https://laptop.tail.ts.net',
    https: true,
  });
  expect(normalizeServerUrl('http://localhost:8000/')).toEqual({
    url: 'http://localhost:8000',
    https: false,
  });
  expect(normalizeServerUrl(' https://Server.example/base-path/ ')).toEqual({
    url: 'https://Server.example/base-path',
    https: true,
  });
});

test.each([
  '',
  'laptop.tail.ts.net',
  'file:///private',
  'https://user:password@host',
  'https://host?query=1',
  'https://host#fragment',
  'https://@host',
  'https://host?',
  'https://host#',
])('rejects unsafe or invalid server URL %s', (input) => {
  expect(() => normalizeServerUrl(input)).toThrow(
    'Enter a valid HTTP or HTTPS server URL.',
  );
});

test('persists and reads the normalized server URL', async () => {
  let stored: string | null = null;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
    stored = value;
  });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async () => stored);
  expect(await getServerUrl()).toBeNull();
  await setServerUrl(' https://server.example/ ');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    'server_url',
    'https://server.example',
  );
  expect(await getServerUrl()).toBe('https://server.example');
});

test('all mounted hooks observe a saved URL', async () => {
  const first = await renderHook(useServerUrl);
  const second = await renderHook(useServerUrl);
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  await act(async () => {
    await first.result.current.setUrl('https://new.example/');
  });
  expect(first.result.current.url).toBe('https://new.example');
  expect(second.result.current.url).toBe('https://new.example');
  expect(first.result.current.error).toBeNull();
});

test('a delayed initial read cannot overwrite a newer saved URL', async () => {
  let completeRead!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockReturnValue(
    new Promise((resolve) => {
      completeRead = resolve;
    }),
  );
  const hook = await renderHook(useServerUrl);
  await act(async () => {
    await setServerUrl('https://new.example');
  });
  await act(async () => {
    completeRead('https://old.example');
  });
  expect(hook.result.current.url).toBe('https://new.example');
  expect(hook.result.current.loading).toBe(false);
});

test('storage read errors end loading and surface through the hook', async () => {
  jest
    .mocked(AsyncStorage.getItem)
    .mockRejectedValue(new Error('Storage unavailable'));
  const hook = await renderHook(useServerUrl);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.error).toBeInstanceOf(Error);
});

test('a failed save keeps the previous URL and surfaces an error', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('https://old.example');
  const hook = await renderHook(useServerUrl);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValue(new Error('Storage unavailable'));
  await act(async () => {
    await expect(
      hook.result.current.setUrl('https://new.example'),
    ).rejects.toThrow();
  });
  expect(hook.result.current.url).toBe('https://old.example');
  expect(hook.result.current.error).toBeInstanceOf(Error);
});
