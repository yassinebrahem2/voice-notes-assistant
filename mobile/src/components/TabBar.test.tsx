import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { fireEvent, render, screen } from '@testing-library/react-native';
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
