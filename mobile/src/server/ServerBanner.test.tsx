import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { paperTheme } from '../theme/paperTheme';
import { ServerBanner } from './ServerBanner';
import { reportNetworkError, reportOk, resetStatus } from './statusStore';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

async function setup() {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 24, left: 0, right: 0, bottom: 0 },
      }}
    >
      <PaperProvider theme={paperTheme('dark')}>
        <ServerBanner />
      </PaperProvider>
    </SafeAreaProvider>,
  );
}

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  resetStatus();
  mockPush.mockClear();
  jest
    .mocked(AsyncStorage.getItem)
    .mockResolvedValue('https://server.example/');
});

test('is hidden while the server status is unknown or ok', async () => {
  await setup();
  expect(screen.queryByText(/reach the server/i)).toBeNull();
  await act(async () => reportOk());
  expect(screen.queryByText(/reach the server/i)).toBeNull();
});

test('shows an unreachable banner with a Settings link that opens Settings', async () => {
  await setup();
  await act(async () => reportNetworkError());
  expect(screen.getByText("Can't reach the server")).toBeTruthy();
  const link = screen.getByRole('link', { name: 'Open Settings' });
  expect(link).toBeTruthy();
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenCalledWith('/settings');
});

test('asks to set the server address when there is none', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  await setup();
  expect(
    await screen.findByText('Set the server address in Settings'),
  ).toBeTruthy();
});

test('disappears by itself once the server answers again', async () => {
  await setup();
  await act(async () => reportNetworkError());
  expect(screen.getByText("Can't reach the server")).toBeTruthy();
  await act(async () => reportOk());
  await waitFor(() =>
    expect(screen.queryByText("Can't reach the server")).toBeNull(),
  );
});

describe('motion', () => {
  const never = new Promise<boolean>(() => {});

  test.each([
    ['on', Promise.resolve(true)],
    ['unknown', never],
  ])('does not animate when reduce motion is %s', async (_name, enabled) => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(enabled);
    const timing = jest.spyOn(Animated, 'timing');
    await setup();
    await act(async () => reportNetworkError());
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    expect(timing).not.toHaveBeenCalled();
  });

  test('animates when reduce motion is off', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    const timing = jest.spyOn(Animated, 'timing');
    await setup();
    await act(async () => reportNetworkError());
    expect(timing).toHaveBeenCalled();
  });
});
