import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { WaveThumb } from './WaveThumb';

async function renderWaveThumb(peaks: number[]) {
  return await render(
    <PaperProvider theme={paperTheme('dark')}>
      <WaveThumb peaks={peaks} />
    </PaperProvider>,
  );
}

describe('WaveThumb', () => {
  test('returns null when peaks is empty', async () => {
    await renderWaveThumb([]);
    expect(screen.queryByTestId('wave-thumb')).toBeNull();
  });

  test('renders 24 bars when provided 96 peaks', async () => {
    const peaks = Array.from({ length: 96 }, (_, i) => (i % 10) / 10);
    await renderWaveThumb(peaks);

    const container = screen.getByTestId('wave-thumb');
    expect(container).toBeTruthy();
    expect(container.props.accessibilityLabel).toBe('Waveform thumbnail');

    const bars = screen.getAllByTestId('wave-thumb-bar');
    expect(bars).toHaveLength(24);
  });
});
