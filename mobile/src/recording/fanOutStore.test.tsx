import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { closeFanOut, openFanOut, useFanOut } from './fanOutStore';
import { RecordAction } from './RecordAction';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

beforeEach(async () => {
  await act(() => closeFanOut());
});

test('is closed by default', async () => {
  const { result } = await renderHook(() => useFanOut());
  expect(result.current).toBe(false);
});

test('openFanOut and closeFanOut update subscribers', async () => {
  const { result } = await renderHook(() => useFanOut());
  await act(() => openFanOut());
  expect(result.current).toBe(true);
  await act(() => closeFanOut());
  expect(result.current).toBe(false);
});

test('every mounted subscriber sees the change', async () => {
  const first = await renderHook(() => useFanOut());
  const second = await renderHook(() => useFanOut());
  await act(() => openFanOut());
  expect(first.result.current).toBe(true);
  expect(second.result.current).toBe(true);
});

test('pressing Record opens the menu', async () => {
  const { result } = await renderHook(() => useFanOut());
  await render(
    <PaperProvider theme={paperTheme('dark')}>
      <RecordAction />
    </PaperProvider>,
  );
  expect(result.current).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Record' }));
  expect(result.current).toBe(true);
});
