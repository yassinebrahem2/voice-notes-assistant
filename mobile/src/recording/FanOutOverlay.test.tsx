import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  BackHandler,
  Dimensions,
  Linking,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { PaperProvider } from 'react-native-paper';
import * as Reanimated from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RecordScreen from '../../app/record';
import { TabBar, type TabBarProps } from '../components/TabBar';
import { paperTheme } from '../theme/paperTheme';
import { spacing } from '../theme/tokens';
import { closeFanOut, openFanOut, useFanOut } from './fanOutStore';
import { FanOutOverlay } from './FanOutOverlay';
import { ensureMicPermission } from './permissions';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ kind: 'meeting' }),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Heavy: 'heavy' },
}));
jest.mock('./permissions', () => ({ ensureMicPermission: jest.fn() }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: jest.fn(() => false),
}));

const permission = jest.mocked(ensureMicPermission);
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 24, bottom: 24, left: 0, right: 0 },
};

async function setup() {
  const { result } = await renderHook(() => useFanOut());
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <PaperProvider theme={paperTheme('dark')}>
        <FanOutOverlay />
      </PaperProvider>
    </SafeAreaProvider>,
  );
  return result;
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  permission.mockResolvedValue('granted');
  jest.mocked(Reanimated.useReducedMotion).mockReturnValue(false);
  await act(() => closeFanOut());
});

afterEach(() => jest.useRealTimers());

test('denied permission explains why, opens settings, and renders no discs or haptic', async () => {
  permission.mockResolvedValue('denied');
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const store = await setup();
  await act(() => openFanOut());
  expect(
    screen.getByText(
      'Microphone access is needed to record meetings and notes. Allow it in Settings.',
    ),
  ).toBeTruthy();
  expect(store.current).toBe(false);
  expect(screen.queryByRole('button', { name: 'Meeting' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Note' })).toBeNull();
  expect(screen.queryByTestId('fan-out-transition')).toBeNull();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
  expect(settings).toHaveBeenCalledTimes(1);
  settings.mockRestore();
});

test('permission rejection explains the failure and leaves no discs', async () => {
  permission.mockRejectedValue(new Error('Native permission failure'));
  const store = await setup();
  await act(() => openFanOut());
  expect(
    screen.getByText("Couldn't check microphone access. Try again."),
  ).toBeTruthy();
  expect(store.current).toBe(false);
  expect(screen.queryByRole('button', { name: 'Meeting' })).toBeNull();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

test('opens labelled discs only after permission and cancels with the close disc', async () => {
  const store = await setup();
  await act(() => openFanOut());
  expect(screen.getByRole('button', { name: 'Meeting' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Note' })).toBeTruthy();
  expect(Haptics.impactAsync).toHaveBeenCalledWith(
    Haptics.ImpactFeedbackStyle.Light,
  );
  expect(
    StyleSheet.flatten(screen.getByTestId('fan-out-overlay').props.style),
  ).toMatchObject({
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Close recording menu' }),
  );
  expect(store.current).toBe(false);
  expect(screen.queryByRole('button', { name: 'Meeting' })).toBeNull();
});

test.each([0, 24, 48])(
  'aligns the close disc and fan-out origin with Record at bottom inset %s',
  async (bottom) => {
    const insets = { ...metrics.insets, bottom };
    await render(
      <SafeAreaProvider initialMetrics={{ ...metrics, insets }}>
        <PaperProvider theme={paperTheme('dark')}>
          <TabBar
            state={{
              index: 0,
              routes: ['meetings', 'notes', 'chat', 'settings'].map((name) => ({
                name,
                key: name,
              })),
            }}
            emitter={{ emit: jest.fn() } as unknown as TabBarProps['emitter']}
            navigateToTab={jest.fn()}
            insets={insets}
          />
          <FanOutOverlay />
        </PaperProvider>
      </SafeAreaProvider>,
    );
    const barStyle = StyleSheet.flatten(
      screen.getByTestId('tab-bar').props.style,
    );
    const tabStyle = StyleSheet.flatten(
      screen.getByRole('tab', { name: 'Meetings' }).props.style,
    );
    const recordStyle = StyleSheet.flatten(
      screen.getByRole('button', { name: 'Record' }).props.style,
    );
    const recordBottom =
      barStyle.paddingBottom +
      tabStyle.marginTop +
      tabStyle.minHeight -
      recordStyle.height;
    await fireEvent.press(screen.getByRole('button', { name: 'Record' }));
    const closeStyle = StyleSheet.flatten(
      screen.getByRole('button', { name: 'Close recording menu' }).props.style,
    );
    expect(closeStyle.bottom).toBe(recordBottom);
    expect(closeStyle.height).toBe(recordStyle.height);
    const expectedCenterY =
      Dimensions.get('window').height -
      recordBottom -
      recordStyle.height / 2 -
      spacing.xxl * 2;
    const positions = ['Meeting', 'Note'].map((name) => {
      let node = screen.getByRole('button', { name });
      const menuSize = StyleSheet.flatten(node.props.style).height;
      while (
        node.parent &&
        StyleSheet.flatten(node.props.style)?.position !== 'absolute'
      )
        node = node.parent;
      const style = StyleSheet.flatten(node.props.style);
      expect(style.top + menuSize / 2).toBe(expectedCenterY);
      return style;
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Note' }));
    const coverStyle = StyleSheet.flatten(
      screen.getByTestId('fan-out-transition').props.style,
    );
    expect(coverStyle.top).toBe(positions[1].top);
    expect(coverStyle.left).toBe(positions[1].left);
  },
);

test('ignores a permission result after cancelling and reopening', async () => {
  let resolveFirst!: (value: 'granted') => void;
  permission.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
  );
  const store = await setup();
  await act(() => openFanOut());
  expect(screen.queryByRole('button', { name: 'Meeting' })).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancel recording menu' }),
  );
  permission.mockResolvedValue('denied');
  await act(() => openFanOut());
  await act(() => resolveFirst('granted'));
  expect(store.current).toBe(false);
  expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Meeting' })).toBeNull();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

test.each(['Meeting', 'Note'])(
  'chooses %s once and keeps the cover until the route lays out',
  async (label) => {
    const store = await setup();
    await act(() => openFanOut());
    const choice = screen.getByRole('button', { name: label });
    await fireEvent.press(choice);
    await fireEvent.press(choice);
    expect(router.push).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1500));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/record',
      params: { kind: label.toLowerCase() },
    });
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.impactAsync).toHaveBeenLastCalledWith(
      Haptics.ImpactFeedbackStyle.Heavy,
    );
    expect(store.current).toBe(true);
    expect(screen.getByTestId('fan-out-transition')).toBeTruthy();
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <PaperProvider theme={paperTheme('dark')}>
          <RecordScreen />
        </PaperProvider>
      </SafeAreaProvider>,
    );
    expect(store.current).toBe(true);
    await fireEvent(screen.getByTestId('record-screen'), 'layout', {
      nativeEvent: { layout: metrics.frame },
    });
    expect(store.current).toBe(false);
  },
);

test('cancels from the backdrop without navigating', async () => {
  const store = await setup();
  await act(() => openFanOut());
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancel recording menu' }),
  );
  await act(() => jest.advanceTimersByTime(1500));
  expect(store.current).toBe(false);
  expect(router.push).not.toHaveBeenCalled();
});

test('Android back cancels the menu before navigating away from the tab', async () => {
  const back = jest.spyOn(BackHandler, 'addEventListener');
  const store = await setup();
  await act(() => openFanOut());
  const handler = back.mock.calls.at(-1)?.[1];
  expect(handler).toBeDefined();
  await act(() => {
    expect(handler?.({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true);
  });
  expect(store.current).toBe(false);
  expect(screen.queryByTestId('fan-out-overlay')).toBeNull();
  expect(router.push).not.toHaveBeenCalled();
  back.mockRestore();
});

test('dismissing a permission explanation removes the full-screen touch blocker', async () => {
  permission.mockResolvedValue('denied');
  await setup();
  await act(() => openFanOut());
  expect(screen.getByTestId('microphone-explanation')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Close microphone explanation' }),
  );
  expect(screen.queryByTestId('microphone-explanation')).toBeNull();
  expect(screen.queryByTestId('fan-out-overlay')).toBeNull();
  permission.mockResolvedValue('granted');
  await act(() => openFanOut());
  expect(screen.getByRole('button', { name: 'Meeting' })).toBeTruthy();
});

test('reduced motion fades the full-screen colour without scaling a disc', async () => {
  jest.mocked(Reanimated.useReducedMotion).mockReturnValue(true);
  await setup();
  await act(() => openFanOut());
  await fireEvent.press(screen.getByRole('button', { name: 'Note' }));
  await act(() => jest.advanceTimersByTime(100));
  const cover = screen.getByTestId('fan-out-transition');
  // The Jest resolver uses native test utilities; package-root types describe web stubs.
  const getAnimatedStyle = Reanimated.getAnimatedStyle as unknown as (node: {
    props: Record<string, unknown>;
  }) => ViewStyle;
  const style = getAnimatedStyle(cover);
  expect(style.transform).toBeUndefined();
  expect(style.opacity).toBeGreaterThan(0);
  expect(style.opacity).toBeLessThan(1);
  expect(router.push).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(500));
  expect(router.push).toHaveBeenCalledTimes(1);
});

test('closing externally during expansion cancels the pending navigation', async () => {
  await setup();
  await act(() => openFanOut());
  await fireEvent.press(screen.getByRole('button', { name: 'Meeting' }));
  await act(() => closeFanOut());
  await act(() => jest.advanceTimersByTime(1500));
  expect(router.push).not.toHaveBeenCalled();
  await act(() => openFanOut());
  expect(screen.getByRole('button', { name: 'Note' })).toBeTruthy();
});

test('record route exposes its fixed kind and back action', async () => {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <PaperProvider theme={paperTheme('dark')}>
        <RecordScreen />
      </PaperProvider>
    </SafeAreaProvider>,
  );
  expect(screen.getByText('Meeting')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close recorder' }));
  expect(router.back).toHaveBeenCalledTimes(1);
});
