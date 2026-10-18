import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { PaperProvider } from 'react-native-paper';

import { apiFetch } from '../api/client';
import type { Schemas } from '../api/errors';
import { openFanOut } from '../recording/fanOutStore';
import { paperTheme } from '../theme/paperTheme';
import { ChatScreen, NO_RECORDING } from './ChatScreen';
import type { RunView } from './runMachine';
import { useChatSession } from './useChatSession';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../api/client', () => ({ apiFetch: jest.fn() }));
jest.mock('../recording/fanOutStore', () => ({ openFanOut: jest.fn() }));
jest.mock('./useChatSession', () => ({ useChatSession: jest.fn() }));

const fetchMock = jest.mocked(apiFetch);
const sessionMock = jest.mocked(useChatSession);
const ask = jest.fn();
const retry = jest.fn();
const newChat = jest.fn();

function session(turns: { question: string; run: RunView }[]) {
  sessionMock.mockReturnValue({
    chatId: turns.length > 0 ? 'chat_1' : null,
    turns,
    scope: 'both',
    tagIds: [],
    ask,
    retry,
    newChat,
    setScope: jest.fn(),
    setTagIds: jest.fn(),
  });
}

function recordings(status: string) {
  fetchMock.mockImplementation(async (path: string) =>
    path === 'tags' ? [{ id: 'tag_1', name: 'work', count: 2 }] : [{ status }],
  );
}

async function setup() {
  await render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        })
      }
    >
      <PaperProvider theme={paperTheme('dark')}>
        <ChatScreen />
      </PaperProvider>
    </QueryClientProvider>,
  );
}

const message: Schemas['MessageOut'] = {
  id: 'msg_1',
  role: 'assistant',
  reply_type: 'answer' as const,
  text: 'We chose Postgres [1].',
  created_at: '',
  citations: [
    {
      n: 1,
      recording_id: 'rec_1',
      recording_title: 'Standup',
      segment_id: 'seg_9',
      start_ms: 83_000,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  recordings('ready');
  session([]);
});

test('shows the starter questions when the chat is empty', async () => {
  await setup();
  const starters = await screen.findAllByTestId('starter');
  expect(starters).toHaveLength(3);
  expect(starters.map((s) => s.props.accessibilityLabel)).toEqual([
    'What was decided in our last sync?',
    'What are my open action items?',
    'Summarize my notes on architecture.',
  ]);
});

test('a starter sends its question', async () => {
  await setup();
  await fireEvent.press((await screen.findAllByTestId('starter'))[0]);
  expect(ask).toHaveBeenCalledTimes(1);
});

test('without a ready recording it asks to record first', async () => {
  recordings('transcribing');
  await setup();
  expect(
    await screen.findByText(
      'Chat answers from your recordings. Record something first.',
    ),
  ).toBeTruthy();
  expect(screen.queryByTestId('starter')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Record' }));
  expect(openFanOut).toHaveBeenCalledTimes(1);
});

test('a citation chip opens the recording at its segment', async () => {
  session([{ question: 'Q?', run: { phase: 'done', steps: [], message } }]);
  await setup();
  expect(await screen.findByText('Q?')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Open Standup · 01:23'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/recording/[id]',
    params: { id: 'rec_1', segment: 'seg_9' },
  });
});

test('a fixed reply is shown as the server wrote it', async () => {
  const reply = {
    ...message,
    reply_type: 'greeting' as const,
    text: 'Hello [1]',
  };
  session([
    { question: 'Hi', run: { phase: 'done', steps: [], message: reply } },
  ]);
  await setup();
  expect(await screen.findByText('Hello [1]')).toBeTruthy();
  expect(screen.queryByLabelText(/^Open /)).toBeNull();
});

test('an interrupted run shows its label and a Retry that retries it', async () => {
  session([{ question: 'Q?', run: { phase: 'interrupted', steps: [] } }]);
  await setup();
  expect(await screen.findByText('Interrupted')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledWith(0);
});

test('failed and too slow runs show their message and Retry', async () => {
  session([
    { question: 'A', run: { phase: 'failed', steps: [], error: 'Boom.' } },
    { question: 'B', run: { phase: 'too_slow', steps: [] } },
  ]);
  await setup();
  expect(await screen.findByText('Boom.')).toBeTruthy();
  expect(screen.getByText('Taking too long')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2);
});

test('a running turn shows its last step and disables Send', async () => {
  session([
    {
      question: 'Q?',
      run: { phase: 'running', steps: ['Searching', 'Found 6'] },
    },
  ]);
  await setup();
  expect(await screen.findByText('Found 6')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Message'), 'Next');
  expect(
    screen.getByRole('button', { name: 'Send' }).props.accessibilityState
      .disabled,
  ).toBe(true);
});

test('Send sends the typed text and New chat starts over', async () => {
  await setup();
  await fireEvent.changeText(
    await screen.findByLabelText('Message'),
    'Hello there',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(ask).toHaveBeenCalledWith('Hello there');
  await fireEvent.press(screen.getByRole('button', { name: 'New chat' }));
  expect(newChat).toHaveBeenCalledTimes(1);
});

test('starters replace the record prompt once a recording becomes ready', async () => {
  jest.useFakeTimers();
  try {
    let status = 'transcribing';
    fetchMock.mockImplementation(async (path: string) =>
      path === 'tags' ? [] : [{ status }],
    );
    await setup();
    expect(await screen.findByText(NO_RECORDING)).toBeTruthy();
    status = 'ready';
    await act(() => jest.advanceTimersByTimeAsync(5_000));
    expect(await screen.findAllByTestId('starter')).not.toHaveLength(0);
    expect(screen.queryByText(NO_RECORDING)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('an unreachable server is not polled forever', async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockRejectedValue(new Error('offline'));
    await setup();
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    const calls = fetchMock.mock.calls.length;
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  } finally {
    jest.useRealTimers();
  }
});

test('a done run without a message shows a label and no Retry', async () => {
  session([{ question: 'Q?', run: { phase: 'done', steps: [] } }]);
  await setup();
  expect(await screen.findByText('No answer came back')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

function recordingCalls(): number {
  return fetchMock.mock.calls.filter(([path]) => path === 'recordings').length;
}

test('polling stops when the server goes down after a good load', async () => {
  jest.useFakeTimers();
  try {
    recordings('transcribing');
    await setup();
    expect(await screen.findByText(NO_RECORDING)).toBeTruthy();
    fetchMock.mockRejectedValue(new Error('offline'));
    await act(() => jest.advanceTimersByTimeAsync(5_000));
    const calls = recordingCalls();
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(recordingCalls()).toBe(calls);
  } finally {
    jest.useRealTimers();
  }
});

test('polling stops once a recording is ready', async () => {
  jest.useFakeTimers();
  try {
    await setup();
    expect(await screen.findAllByTestId('starter')).not.toHaveLength(0);
    const calls = recordingCalls();
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(recordingCalls()).toBe(calls);
  } finally {
    jest.useRealTimers();
  }
});
