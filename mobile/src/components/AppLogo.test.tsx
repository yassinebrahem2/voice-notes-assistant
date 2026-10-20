import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { AppLogo } from './AppLogo';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));
jest.mock('../config/appInfo', () => ({
  appInfo: { name: 'Test App', version: '1.2.3' },
}));

async function renderLogo(props: React.ComponentProps<typeof AppLogo>) {
  return await render(
    <PaperProvider theme={paperTheme('dark')}>
      <AppLogo {...props} />
    </PaperProvider>,
  );
}

it('shows the configured app name next to the mark', async () => {
  await renderLogo({ size: 'small' });

  expect(screen.getByText('Test App')).toBeTruthy();
  expect(screen.getByLabelText('Test App')).toBeTruthy();
});

it('draws the seven waveform bars', async () => {
  await renderLogo({ size: 'large' });

  expect(screen.getAllByTestId('app-logo-bar')).toHaveLength(7);
});
