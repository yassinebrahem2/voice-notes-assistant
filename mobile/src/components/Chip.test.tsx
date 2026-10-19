import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { tokens } from '../theme/tokens';
import { Chip, type ChipProps } from './Chip';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

async function renderChip(
  props: Partial<ChipProps> & {
    label: string;
    onPress: () => void;
    accessibilityLabel: string;
  },
  scheme: 'light' | 'dark' = 'dark',
) {
  const mergedProps: ChipProps = {
    ...props,
  };
  return await render(
    <PaperProvider theme={paperTheme(scheme)}>
      <Chip {...mergedProps} />
    </PaperProvider>,
  );
}

describe('Chip', () => {
  test('calls onPress once when pressed', async () => {
    const onPress = jest.fn();
    await renderChip({
      label: 'Design',
      onPress,
      accessibilityLabel: 'Filter by Design',
    });

    const button = screen.getByRole('button', { name: 'Filter by Design' });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('has 32 dp minHeight, 6 dp radius, and no fixed height, minWidth, or hitSlop', async () => {
    const onPress = jest.fn();
    await renderChip({
      label: 'Design',
      onPress,
      accessibilityLabel: 'Filter by Design',
    });

    const pressable = screen.getByRole('button', { name: 'Filter by Design' });
    expect(pressable).toHaveStyle({ minHeight: 32, borderRadius: 6 });

    const flatStyle = StyleSheet.flatten(pressable.props.style);
    expect(flatStyle.height).toBeUndefined();
    expect(flatStyle.minWidth).toBeUndefined();
    expect(pressable.props.hitSlop).toBeUndefined();
  });

  test('renders selected signal variant with signal background and onSignal label', async () => {
    await renderChip({
      label: 'Design',
      onPress: jest.fn(),
      accessibilityLabel: 'Filter by Design',
      selected: true,
      selectedVariant: 'signal',
    });

    const pressable = screen.getByRole('button', { name: 'Filter by Design' });
    expect(pressable).toHaveStyle({
      backgroundColor: tokens.dark.signal,
      borderColor: tokens.dark.signal,
    });
    expect(pressable.props.accessibilityState).toEqual({ selected: true });

    const text = screen.getByText('Design');
    expect(text).toHaveStyle({ color: tokens.dark.onSignal });
  });

  test('renders selected outline variant with raised background and ink border', async () => {
    await renderChip({
      label: 'Design',
      onPress: jest.fn(),
      accessibilityLabel: 'Tag Design',
      selected: true,
      selectedVariant: 'outline',
    });

    const pressable = screen.getByRole('button', { name: 'Tag Design' });
    expect(pressable).toHaveStyle({
      backgroundColor: tokens.dark.raised,
      borderColor: tokens.dark.ink,
    });

    const text = screen.getByText('Design');
    expect(text).toHaveStyle({ color: tokens.dark.ink });
  });

  test('renders unselected signal variant with surface background and line border', async () => {
    await renderChip({
      label: 'Design',
      onPress: jest.fn(),
      accessibilityLabel: 'Filter by Design',
      selected: false,
      selectedVariant: 'signal',
    });

    const pressable = screen.getByRole('button', { name: 'Filter by Design' });
    expect(pressable).toHaveStyle({
      backgroundColor: tokens.dark.surface,
      borderColor: tokens.dark.line,
    });

    const text = screen.getByText('Design');
    expect(text).toHaveStyle({ color: tokens.dark.ink });
  });

  test('renders unselected outline variant with transparent background and line border', async () => {
    await renderChip({
      label: 'Design',
      onPress: jest.fn(),
      accessibilityLabel: 'Tag Design',
      selected: false,
      selectedVariant: 'outline',
    });

    const pressable = screen.getByRole('button', { name: 'Tag Design' });
    expect(pressable).toHaveStyle({
      backgroundColor: 'transparent',
      borderColor: tokens.dark.line,
    });

    const text = screen.getByText('Design');
    expect(text).toHaveStyle({ color: tokens.dark.ink });
  });

  test('accessibility role checkbox exposes checked state', async () => {
    await renderChip({
      label: 'Design',
      onPress: jest.fn(),
      accessibilityLabel: 'Tag Design',
      accessibilityRole: 'checkbox',
      selected: true,
    });

    const checkbox = screen.getByRole('checkbox', { name: 'Tag Design' });
    expect(checkbox.props.accessibilityState).toEqual({ checked: true });
  });

  test('non-selectable chip has no accessibilityState selected', async () => {
    await renderChip({
      label: 'Alex',
      onPress: jest.fn(),
      accessibilityLabel: 'Rename speaker Alex',
    });

    const button = screen.getByRole('button', { name: 'Rename speaker Alex' });
    expect(button.props.accessibilityState?.selected).toBeUndefined();
  });

  test('renders leading element when provided', async () => {
    await renderChip({
      label: 'Alex',
      onPress: jest.fn(),
      accessibilityLabel: 'Rename speaker Alex',
      leading: <View testID="speaker-dot" />,
    });

    expect(screen.getByTestId('speaker-dot')).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();
  });
});
