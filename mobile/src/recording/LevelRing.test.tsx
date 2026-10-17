import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { makeMutable, useReducedMotion } from 'react-native-reanimated';

import { paperTheme } from '../theme/paperTheme';
import { tokens } from '../theme/tokens';
import { LevelRing } from './LevelRing';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: jest.fn(() => false),
}));

describe('LevelRing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useReducedMotion).mockReturnValue(false);
  });

  test('renders with pointerEvents none and round radius', async () => {
    const level = makeMutable(0.2);
    await render(
      <PaperProvider theme={paperTheme('dark')}>
        <LevelRing level={level} />
      </PaperProvider>,
    );

    const ring = screen.getByTestId('level-ring');
    expect(ring).toBeTruthy();
    expect(ring.props.pointerEvents).toBe('none');
    expect(ring.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderRadius: 999,
          borderColor: tokens.dark.signal,
        }),
      ]),
    );
  });

  test('respects reduced motion', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(true);
    const level = makeMutable(0.8);
    await render(
      <PaperProvider theme={paperTheme('dark')}>
        <LevelRing level={level} />
      </PaperProvider>,
    );

    const ring = screen.getByTestId('level-ring');
    expect(ring).toBeTruthy();
  });
});
