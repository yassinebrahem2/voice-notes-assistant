import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  getThemePreference,
  setThemePreference,
  useThemePreference,
} from './themePreference';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

beforeEach(() => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockReset().mockResolvedValue();
});

test('defaults to system', async () => {
  expect(await getThemePreference()).toBe('system');
});

test('an unknown stored value falls back to system', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('purple');
  expect(await getThemePreference()).toBe('system');
});

test('round-trips through the theme key', async () => {
  await setThemePreference('dark');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('dark');
  expect(await getThemePreference()).toBe('dark');
  expect(AsyncStorage.getItem).toHaveBeenCalledWith('theme');
});

test('the hook loads the stored value and follows changes', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('light');
  const { result } = await renderHook(() => useThemePreference());
  await waitFor(() => expect(result.current.preference).toBe('light'));
  await act(async () => {
    await result.current.setPreference('dark');
  });
  expect(result.current.preference).toBe('dark');
});

test('the hook is loaded only once the stored value is read', async () => {
  let resolve!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { result } = await renderHook(() => useThemePreference());
  expect(result.current.loaded).toBe(false);
  await act(async () => {
    resolve('dark');
  });
  expect(result.current).toMatchObject({ preference: 'dark', loaded: true });
});

test('a failed read counts as loaded, with the system theme', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('disk'));
  const { result } = await renderHook(() => useThemePreference());
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.preference).toBe('system');
});
