import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { Scrubber } from './Scrubber';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

async function renderScrubber(
  props: Partial<React.ComponentProps<typeof Scrubber>> = {},
) {
  return await render(
    <PaperProvider theme={paperTheme('dark')}>
      <Scrubber
        positionMs={10000}
        durationMs={60000}
        onSeek={jest.fn()}
        {...props}
      />
    </PaperProvider>,
  );
}

describe('Scrubber', () => {
  test('updates drag position during touch and seeks once on release', async () => {
    const onSeek = jest.fn();
    const { unmount } = await renderScrubber({ onSeek });
    const scrubber = screen.getByTestId('player-scrubber');

    await act(async () => {
      fireEvent(scrubber, 'layout', {
        nativeEvent: { layout: { width: 200 } },
      });
    });

    await act(async () => {
      fireEvent(scrubber, 'responderGrant', {
        nativeEvent: { locationX: 50 },
      });
    });
    expect(onSeek).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(scrubber, 'responderMove', {
        nativeEvent: { locationX: 100 },
      });
    });
    expect(onSeek).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(scrubber, 'responderRelease', {
        nativeEvent: { locationX: 100 },
      });
    });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(30000);
    unmount();
  });

  test('handles accessibility actions for increment and decrement (+/- 5s)', async () => {
    const onSeek = jest.fn();
    const { unmount } = await renderScrubber({ onSeek });
    const scrubber = screen.getByTestId('player-scrubber');

    await act(async () => {
      fireEvent(scrubber, 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(onSeek).toHaveBeenCalledWith(15000);

    await act(async () => {
      fireEvent(scrubber, 'accessibilityAction', {
        nativeEvent: { actionName: 'decrement' },
      });
    });
    expect(onSeek).toHaveBeenCalledWith(5000);
    unmount();
  });
});
