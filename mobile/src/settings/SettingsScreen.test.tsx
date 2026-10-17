import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { apiFetch } from '../api/client';
import { paperTheme } from '../theme/paperTheme';
import { readinessRows, SettingsScreen } from './SettingsScreen';
import { testConnection } from './testConnection';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('../config/appInfo', () => ({
  appInfo: { name: 'Test App', version: '1.2.3' },
}));
jest.mock('../api/client', () => ({ apiFetch: jest.fn() }));
jest.mock('./testConnection', () => ({ testConnection: jest.fn() }));

async function setup() {
  jest.mocked(AsyncStorage.getItem).mockReset().mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockReset().mockResolvedValue();
  jest.mocked(apiFetch).mockRejectedValue(new Error('offline'));
  await render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        })
      }
    >
      <PaperProvider theme={paperTheme('light')}>
        <SettingsScreen />
      </PaperProvider>
    </QueryClientProvider>,
  );
}

test('Save stores the normalised URL, http included', async () => {
  await setup();
  await fireEvent.changeText(
    screen.getByLabelText('Server URL'),
    ' http://laptop:8000/ ',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'server_url',
      'http://laptop:8000',
    ),
  );
  expect(await screen.findByText('Saved')).toBeOnTheScreen();
  expect(screen.getByLabelText('Server URL').props.value).toBe(
    'http://laptop:8000',
  );
});

test('Test connection shows the result inline', async () => {
  await setup();
  jest
    .mocked(testConnection)
    .mockResolvedValue({ ok: false, problem: 'not_https' });
  await fireEvent.changeText(screen.getByLabelText('Server URL'), 'http://x/');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Test connection' }),
  );
  expect(await screen.findByText('Not HTTPS')).toBeOnTheScreen();
});

test('an invalid URL shows the normaliser message and does not save', async () => {
  await setup();
  await fireEvent.changeText(screen.getByLabelText('Server URL'), 'nonsense');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(
    await screen.findByText('Enter a valid HTTP or HTTPS server URL.'),
  ).toBeOnTheScreen();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('shows the app name and version from the app info', async () => {
  await setup();
  expect(screen.getByText('Test App')).toBeOnTheScreen();
  expect(screen.getByText('Version 1.2.3')).toBeOnTheScreen();
});

const base = {
  app_name: 'Test App',
  version: '0.1.0',
  speech_backend: 'real' as const,
};

test('labels each role in a fixed order and keeps the server wording', () => {
  const rows = readinessRows({
    ...base,
    roles: {
      diarizer: 'Missing HF_TOKEN',
      asr: 'ready',
      llm: 'Missing GROQ_API_KEY',
      embedder: 'ready',
      llm_analysis: 'ready',
    },
  });
  expect(rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
    'Chat AI: Missing GROQ_API_KEY',
    'Summary AI: ready',
    'Search: ready',
    'Speech: ready',
    'Speakers: Missing HF_TOKEN',
  ]);
});

test('marks a ready fake speech backend as dev', () => {
  const rows = readinessRows({
    ...base,
    speech_backend: 'fake',
    roles: { asr: 'ready' },
  });
  expect(rows).toEqual([{ key: 'asr', label: 'Speech', value: 'fake (dev)' }]);
});

test('a missing speech key is not hidden by the fake backend', () => {
  const rows = readinessRows({
    ...base,
    speech_backend: 'fake',
    roles: { asr: 'Missing X_KEY' },
  });
  expect(rows[0]?.value).toBe('Missing X_KEY');
});
