import { act, renderHook } from '@testing-library/react-native';

import {
  dismissSnackbar,
  getSnackbarMessage,
  showSnackbar,
  useSnackbar,
} from './snackbarStore';

describe('snackbarStore', () => {
  beforeEach(async () => {
    await act(() => dismissSnackbar());
  });

  test('is empty by default', async () => {
    const { result } = await renderHook(() => useSnackbar());
    expect(result.current).toBeNull();
    expect(getSnackbarMessage()).toBeNull();
  });

  test('showSnackbar and dismissSnackbar update subscribers', async () => {
    const { result } = await renderHook(() => useSnackbar());
    await act(() => showSnackbar('Deleted'));
    expect(result.current).toBe('Deleted');
    expect(getSnackbarMessage()).toBe('Deleted');

    await act(() => dismissSnackbar());
    expect(result.current).toBeNull();
    expect(getSnackbarMessage()).toBeNull();
  });

  test('multiple subscribers see the update', async () => {
    const first = await renderHook(() => useSnackbar());
    const second = await renderHook(() => useSnackbar());

    await act(() => showSnackbar('Updated'));
    expect(first.result.current).toBe('Updated');
    expect(second.result.current).toBe('Updated');
  });
});
