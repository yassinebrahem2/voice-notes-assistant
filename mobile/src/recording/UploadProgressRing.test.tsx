import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { UploadProgressRing } from './UploadProgressRing';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
  loadAsync: () => Promise.resolve(),
}));

async function renderWithTheme(ui: React.ReactElement) {
  return await render(
    <PaperProvider theme={paperTheme('dark')}>{ui}</PaperProvider>,
  );
}

describe('UploadProgressRing', () => {
  test('renders uploading state with progress percent', async () => {
    await renderWithTheme(
      <UploadProgressRing progress={0.65} status="uploading" />,
    );

    const ring = screen.getByTestId('upload-progress-ring');
    expect(ring).toBeTruthy();
    expect(screen.getByText('65%')).toBeTruthy();
  });

  test('renders success state with check icon', async () => {
    await renderWithTheme(<UploadProgressRing progress={1} status="success" />);

    expect(screen.getByTestId('upload-success-icon')).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();
  });

  test('renders error state and handles onRetry', async () => {
    const onRetry = jest.fn();
    await renderWithTheme(
      <UploadProgressRing progress={0.5} status="error" onRetry={onRetry} />,
    );

    const ring = screen.getByTestId('upload-progress-ring');
    expect(screen.getByText('Retry')).toBeTruthy();

    fireEvent.press(ring);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
