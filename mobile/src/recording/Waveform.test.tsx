import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { makeMutable, useReducedMotion } from 'react-native-reanimated';

import { paperTheme } from '../theme/paperTheme';
import { tokens } from '../theme/tokens';
import { Waveform } from './Waveform';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: jest.fn(() => false),
}));

describe('Waveform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useReducedMotion).mockReturnValue(false);
  });

  test('renders 48 bars by default when reduced motion is disabled', async () => {
    const level = makeMutable(0);
    await render(
      <PaperProvider theme={paperTheme('dark')}>
        <Waveform level={level} />
      </PaperProvider>,
    );

    expect(screen.getByTestId('waveform')).toBeTruthy();
    const bars = screen.getAllByTestId('waveform-bar');
    expect(bars).toHaveLength(48);
  });

  test('interpolates colors from inkMuted to signal across the bars', async () => {
    const level = makeMutable(0);
    await render(
      <PaperProvider theme={paperTheme('dark')}>
        <Waveform level={level} />
      </PaperProvider>,
    );

    const bars = screen.getAllByTestId('waveform-bar');
    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];

    expect(firstBar.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: tokens.dark.inkMuted }),
      ]),
    );
    expect(lastBar.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: tokens.dark.signal }),
      ]),
    );
  });

  test('renders a custom bar count when count prop is provided', async () => {
    const level = makeMutable(0);
    await render(
      <PaperProvider theme={paperTheme('dark')}>
        <Waveform level={level} count={24} />
      </PaperProvider>,
    );

    const bars = screen.getAllByTestId('waveform-bar');
    expect(bars).toHaveLength(24);
  });

  test('renders a single level bar when reduced motion is enabled', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(true);
    const level = makeMutable(0.5);
    await render(
      <PaperProvider theme={paperTheme('dark')}>
        <Waveform level={level} />
      </PaperProvider>,
    );

    expect(screen.getByTestId('waveform')).toBeTruthy();
    expect(screen.getByTestId('waveform-single-bar')).toBeTruthy();
    expect(screen.queryByTestId('waveform-bar')).toBeNull();
  });
});
