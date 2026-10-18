import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { apiFetch } from '../api/client';
import { ApiError } from '../api/errors';
import { reportNetworkError, reportOk } from '../server/statusStore';
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
jest.mock('./testConnection', () => ({
  ...jest.requireActual('./testConnection'),
  testConnection: jest.fn(),
}));

async function setup(
  storedUrl: string | null = null,
  health: () => Promise<unknown> = () => Promise.reject(new Error('offline')),
) {
  jest.mocked(AsyncStorage.getItem).mockReset().mockResolvedValue(storedUrl);
  jest.mocked(AsyncStorage.setItem).mockReset().mockResolvedValue();
  jest
    .mocked(apiFetch)
    .mockReset()
    .mockImplementation(health as never);
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

test('a stored server that answers with a non-health body does not crash', async () => {
  await setup('https://s.example', async () => ({ hello: 'x' }));
  expect(
    await screen.findByText("That isn't this app's server"),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Server URL')).toBeOnTheScreen();
});

test('a null health body is reported, not left on Checking', async () => {
  await setup('https://s.example', async () => null);
  expect(
    await screen.findByText("That isn't this app's server"),
  ).toBeOnTheScreen();
});

test('an unreachable stored server shows the readiness message', async () => {
  await setup('https://s.example', () =>
    Promise.reject(new ApiError(0, 'network_error', 'x')),
  );
  expect(await screen.findByText("Can't reach the server.")).toBeOnTheScreen();
});

test('readiness recovers once the server is reachable again', async () => {
  reportNetworkError();
  await setup('https://s.example', () =>
    Promise.reject(new ApiError(0, 'network_error', 'x')),
  );
  expect(await screen.findByText("Can't reach the server.")).toBeOnTheScreen();
  jest.mocked(apiFetch).mockResolvedValue({
    app_name: 'Test App',
    version: '0.1.0',
    speech_backend: 'real',
    roles: { llm: 'ready' },
  });
  await act(async () => {
    reportOk();
  });
  expect(await screen.findByLabelText('Chat AI: ready')).toBeOnTheScreen();
});

test('a connection result for an edited URL is ignored', async () => {
  await setup();
  let resolve!: (value: { ok: true; health: never }) => void;
  jest.mocked(testConnection).mockReturnValue(
    new Promise((r) => {
      resolve = r as typeof resolve;
    }),
  );
  await fireEvent.changeText(screen.getByLabelText('Server URL'), 'https://a');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Test connection' }),
  );
  await fireEvent.changeText(screen.getByLabelText('Server URL'), 'https://b');
  resolve({ ok: true, health: undefined as never });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Test connection' }),
    ).toBeEnabled(),
  );
  expect(screen.queryByText('Connected')).not.toBeOnTheScreen();
});

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
