import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { PlayerBar } from './PlayerBar';
import type { UsePlayerResult } from './usePlayer';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

async function renderPlayerBar(
  playerOverrides: Partial<UsePlayerResult> = {},
  peaks?: number[] | null,
) {
  const defaultPlayer: UsePlayerResult = {
    isPlaying: false,
    positionMs: 12000,
    durationMs: 90000,
    error: null,
    playFrom: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    toggle: jest.fn(),
    retry: jest.fn(),
    ...playerOverrides,
  };

  const renderResult = await render(
    <PaperProvider theme={paperTheme('dark')}>
      <PlayerBar player={defaultPlayer} peaks={peaks} />
    </PaperProvider>,
  );

  return { player: defaultPlayer, renderResult };
}

describe('PlayerBar', () => {
  test('renders Play button when paused and triggers toggle on press', async () => {
    const { player } = await renderPlayerBar({ isPlaying: false });

    const playButton = screen.getByLabelText('Play');
    expect(playButton).toBeTruthy();

    fireEvent.press(playButton);
    expect(player.toggle).toHaveBeenCalledTimes(1);
  });

  test('renders Pause button when playing and triggers toggle on press', async () => {
    const { player } = await renderPlayerBar({ isPlaying: true });

    const pauseButton = screen.getByLabelText('Pause');
    expect(pauseButton).toBeTruthy();

    fireEvent.press(pauseButton);
    expect(player.toggle).toHaveBeenCalledTimes(1);
  });

  test('renders formatted elapsed time and total duration', async () => {
    await renderPlayerBar({ positionMs: 65000, durationMs: 154000 });

    // 65000 ms -> 01:05, 154000 ms -> 02:34
    expect(screen.getByText('01:05 / 02:34')).toBeTruthy();
  });

  test('renders error state with retry button when audio loading fails', async () => {
    const { player } = await renderPlayerBar({
      error: "Couldn't load audio",
    });

    expect(screen.getByText("Couldn't load audio")).toBeTruthy();
    const retryButton = screen.getByLabelText('Retry');
    expect(retryButton).toBeTruthy();

    fireEvent.press(retryButton);
    expect(player.retry).toHaveBeenCalledTimes(1);
  });

  test('scrubber seek calls player.seekTo', async () => {
    const { player } = await renderPlayerBar(
      { positionMs: 0, durationMs: 100000 },
      [10, 20, 30, 40],
    );

    const scrubber = screen.getByTestId('player-scrubber');
    expect(scrubber).toBeTruthy();

    // Trigger layout and responder event with awaited act
    await act(async () => {
      fireEvent(scrubber, 'layout', {
        nativeEvent: { layout: { width: 200, height: 48, x: 0, y: 0 } },
      });
    });
    await act(async () => {
      fireEvent(scrubber, 'responderGrant', {
        nativeEvent: { locationX: 100 },
      });
    });

    // 100 / 200 = 50% of 100000 = 50000
    expect(player.seekTo).toHaveBeenCalledWith(50000);
  });
});
