import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { TabBar } from './TabBar';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

async function setup(index = 0, prevented = false) {
  const emit = jest.fn(() => ({ defaultPrevented: prevented }));
  const navigate = jest.fn();
  const emitter = { emit } as unknown as BottomTabBarProps['emitter'];
  const names = ['meetings', 'notes', 'chat', 'settings'];
  await render(
    <PaperProvider theme={paperTheme('dark')}>
      <TabBar
        state={{ index, routes: names.map((name) => ({ name, key: name })) }}
        emitter={emitter}
        navigateToTab={navigate}
        insets={{ top: 0, bottom: 24, left: 0, right: 0 }}
      />
    </PaperProvider>,
  );
  return { emit, navigate };
}

test('renders five accessible actions in order and marks the active tab', async () => {
  await setup(2);
  expect(
    screen
      .getAllByLabelText(/^(Meetings|Notes|Record|Chat|Settings)$/)
      .map((node) => node.props.accessibilityLabel),
  ).toEqual(['Meetings', 'Notes', 'Record', 'Chat', 'Settings']);
  expect(
    screen.getAllByRole('tab').map((node) => node.props.accessibilityLabel),
  ).toEqual(['Meetings', 'Notes', 'Chat', 'Settings']);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy();
  expect(
    screen.getByRole('tab', { name: 'Chat' }).props.accessibilityState.selected,
  ).toBe(true);
  expect(
    screen.getByRole('tab', { name: 'Meetings' }).props.accessibilityState
      .selected,
  ).toBe(false);
});

test.each(['Meetings', 'Notes', 'Chat', 'Settings'])(
  'exposes only %s as selected when its tab is active',
  async (name) => {
    await setup(['Meetings', 'Notes', 'Chat', 'Settings'].indexOf(name));
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(
      name,
    );
    expect(screen.getAllByRole('tab', { selected: false })).toHaveLength(3);
  },
);

test('navigates to a different tab and emits standard events', async () => {
  const { navigate, emit } = await setup();
  await fireEvent.press(screen.getByRole('tab', { name: 'Notes' }));
  expect(emit).toHaveBeenCalledWith({
    type: 'tabPress',
    target: 'notes',
    canPreventDefault: true,
  });
  expect(navigate).toHaveBeenCalledWith('notes');
  await fireEvent(screen.getByRole('tab', { name: 'Notes' }), 'longPress');
  expect(emit).toHaveBeenCalledWith({ type: 'tabLongPress', target: 'notes' });
});

test('does not navigate when tabPress is prevented or the tab is already selected', async () => {
  const { navigate } = await setup(0, true);
  await fireEvent.press(screen.getByRole('tab', { name: 'Notes' }));
  await fireEvent.press(screen.getByRole('tab', { name: 'Meetings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Record' }));
  expect(navigate).not.toHaveBeenCalled();
});

test('keeps the whole Record disc inside the tab bar bounds', async () => {
  await setup();
  // Android delivers touches only inside a view's parent bounds, so the disc must not be pulled out of the bar.
  let node = screen.getByRole('button', { name: 'Record' }).parent;
  const ancestors = [];
  while (node && node.props.testID !== 'tab-bar') {
    ancestors.push(node);
    node = node.parent;
  }
  expect(node?.props.testID).toBe('tab-bar');
  ancestors.push(node);
  for (const ancestor of ancestors) {
    const style = StyleSheet.flatten(ancestor?.props.style) ?? {};
    expect(style.marginTop ?? 0).toBeGreaterThanOrEqual(0);
    expect(style.top ?? 0).toBeGreaterThanOrEqual(0);
    expect(style.position).not.toBe('absolute');
    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBeUndefined();
  }
  // The area above the visible bar shows the screen background, so the root paints nothing itself.
  expect(
    StyleSheet.flatten(node?.props.style)?.backgroundColor,
  ).toBeUndefined();
});
