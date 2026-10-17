import { act, renderHook } from '@testing-library/react-native';

import { apiFetch } from '../api/client';
import { ApiError, type Schemas } from '../api/errors';
import { useChatSession } from './useChatSession';

jest.mock('../api/client', () => ({ apiFetch: jest.fn() }));

const fetchMock = jest.mocked(apiFetch);
const message = {
  id: 'msg_1',
  text: 'Answer',
} as unknown as Schemas['MessageOut'];

function runOut(over: Partial<Schemas['RunOut']>): Schemas['RunOut'] {
  return { status: 'running', steps: [], message: null, error: null, ...over };
}

function paths(): string[] {
  return fetchMock.mock.calls.map(([path]) => path);
}

function count(path: string): number {
  return paths().filter((p) => p === path).length;
}

function route(runs: (() => Schemas['RunOut'] | ApiError)[]): void {
  let chats = 0;
  fetchMock.mockImplementation(async (path: string) => {
    if (path === 'chats') return { id: `chat_${++chats}`, created_at: '' };
    if (path.endsWith('/messages')) return { run_id: 'run_1' };
    if (path.endsWith('/retry')) return { run_id: 'run_1' };
    const next = runs.length > 1 ? runs.shift() : runs[0];
    const result = next!();
    if (result instanceof ApiError) throw result;
    return result;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
});

afterEach(async () => {
  const { result } = await renderHook(() => useChatSession());
  await act(() => result.current.newChat());
  jest.useRealTimers();
});

test('ask creates the chat lazily, polls until done, then stops', async () => {
  route([
    () => runOut({ steps: ['Searching'] }),
    () => runOut({ status: 'done', steps: ['Searching'], message }),
  ]);
  const { result } = await renderHook(() => useChatSession());
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => {
    await result.current.ask('What did I decide?');
  });
  expect(paths().slice(0, 2)).toEqual(['chats', 'chats/chat_1/messages']);
  expect(result.current.turns[0]?.question).toBe('What did I decide?');
  expect(result.current.turns[0]?.run.phase).toBe('sending');

  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run).toEqual({
    phase: 'running',
    steps: ['Searching'],
  });
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('done');
  expect(result.current.turns[0]?.run.message).toBe(message);

  const calls = fetchMock.mock.calls.length;
  await act(() => jest.advanceTimersByTimeAsync(5_000));
  expect(fetchMock).toHaveBeenCalledTimes(calls);
});

test('ask sends scope and tag ids', async () => {
  route([() => runOut({ status: 'done', message })]);
  const { result } = await renderHook(() => useChatSession());
  await act(() => {
    result.current.setScope('meetings');
    result.current.setTagIds(['tag_1']);
  });
  await act(async () => {
    await result.current.ask('Hi');
  });
  const call = fetchMock.mock.calls.find(([p]) => p.endsWith('/messages'));
  expect(JSON.parse(call?.[1]?.body as string)).toEqual({
    text: 'Hi',
    scope: 'meetings',
    tag_ids: ['tag_1'],
  });
});

test('retry after interrupted retries the same run once and resumes polling', async () => {
  route([
    () => new ApiError(404, 'not_found', 'Run not found.'),
    () => runOut({ status: 'done', message }),
  ]);
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('interrupted');
  expect(count('chats/chat_1/messages')).toBe(1);

  await act(async () => {
    await result.current.retry(0);
  });
  expect(count('chats/chat_1/runs/run_1/retry')).toBe(1);
  expect(count('chats/chat_1/messages')).toBe(1);
  expect(result.current.turns[0]?.run.phase).toBe('sending');

  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('done');
});

test('a run that never finishes stops polling as too_slow at 90 seconds', async () => {
  route([() => runOut({ steps: ['Searching'] })]);
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  await act(() => jest.advanceTimersByTimeAsync(89_000));
  expect(result.current.turns[0]?.run.phase).toBe('running');
  await act(() => jest.advanceTimersByTimeAsync(1_500));
  expect(result.current.turns[0]?.run.phase).toBe('too_slow');
  const calls = fetchMock.mock.calls.length;
  await act(() => jest.advanceTimersByTimeAsync(5_000));
  expect(fetchMock).toHaveBeenCalledTimes(calls);
});

test('state survives unmounting and remounting the consumer', async () => {
  route([
    () => runOut({ steps: ['Searching'] }),
    () => runOut({ status: 'done', message }),
  ]);
  const first = await renderHook(() => useChatSession());
  await act(async () => {
    await first.result.current.ask('Q');
  });
  await first.unmount();

  await act(() => jest.advanceTimersByTimeAsync(1_000));
  const second = await renderHook(() => useChatSession());
  expect(second.result.current.turns).toHaveLength(1);
  expect(second.result.current.turns[0]?.run.phase).toBe('done');
});

test('newChat clears the turns and the next ask creates a new chat', async () => {
  route([() => runOut({ status: 'done', message })]);
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('One');
  });
  expect(result.current.chatId).toBe('chat_1');

  await act(() => result.current.newChat());
  expect(result.current.turns).toEqual([]);
  expect(result.current.chatId).toBeNull();

  await act(async () => {
    await result.current.ask('Two');
  });
  expect(count('chats')).toBe(2);
  expect(result.current.chatId).toBe('chat_2');
  expect(result.current.turns).toHaveLength(1);
});

test('retry is refused while another turn is running', async () => {
  let asked = 0;
  fetchMock.mockImplementation(async (path: string) => {
    if (path === 'chats') return { id: 'chat_1', created_at: '' };
    if (path.endsWith('/messages')) return { run_id: `run_${++asked}` };
    if (path.endsWith('/runs/run_1'))
      throw new ApiError(404, 'not_found', 'Run not found.');
    return runOut({ steps: ['Searching'] });
  });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('One');
  });
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('interrupted');
  await act(async () => {
    await result.current.ask('Two');
  });
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[1]?.run.phase).toBe('running');

  const before = result.current.turns[0];
  await act(async () => {
    await result.current.retry(0);
  });
  expect(count('chats/chat_1/runs/run_1/retry')).toBe(0);
  expect(result.current.turns[0]).toBe(before);
});

test('a network error while polling keeps polling', async () => {
  route([
    () => new ApiError(0, 'network_error', 'Could not reach the server.'),
    () => runOut({ status: 'done', message }),
  ]);
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('sending');
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('done');
});

test('a poll response arriving after newChat does not touch the new chat', async () => {
  let release!: (run: Schemas['RunOut']) => void;
  let chats = 0;
  fetchMock.mockImplementation(async (path: string) => {
    if (path === 'chats') return { id: `chat_${++chats}`, created_at: '' };
    if (path.endsWith('/messages'))
      return { run_id: path.startsWith('chats/chat_1') ? 'run_1' : 'run_2' };
    if (path.endsWith('/runs/run_1'))
      return new Promise<Schemas['RunOut']>((resolve) => {
        release = resolve;
      });
    return runOut({ steps: ['Searching'] });
  });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Old');
  });
  await act(() => jest.advanceTimersByTimeAsync(500));
  await act(() => result.current.newChat());
  await act(async () => {
    await result.current.ask('New');
  });
  await act(async () => {
    release(runOut({ status: 'done', message }));
  });
  expect(result.current.chatId).toBe('chat_2');
  expect(result.current.turns).toHaveLength(1);
  expect(result.current.turns[0]?.run.phase).not.toBe('done');
});

type Stored = { id: string; text: string; role?: 'user' | 'assistant' };

// A server where the first POST /messages fails with `askError`; later ones succeed
// with run ids run_2, run_3...
function lostRunServer(opts: {
  askError: ApiError | null;
  stored: Stored[] | ApiError;
  chatError?: ApiError;
}): void {
  let asked = 0;
  let chats = 0;
  fetchMock.mockImplementation(async (path: string) => {
    if (path === 'chats') {
      if (opts.chatError && chats++ === 0) throw opts.chatError;
      return { id: 'chat_1', created_at: '' };
    }
    if (path === 'chats/chat_1') {
      if (opts.stored instanceof ApiError) throw opts.stored;
      return {
        id: 'chat_1',
        messages: opts.stored.map((m) => ({ role: 'user', ...m })),
      };
    }
    if (path.endsWith('/messages')) {
      asked += 1;
      if (asked === 1 && opts.askError) throw opts.askError;
      return { run_id: `run_${asked}` };
    }
    if (path.endsWith('/retry')) return { run_id: 'x' };
    return runOut({ status: 'done', message });
  });
}

const timeout = () => new ApiError(0, 'timeout', 'The request timed out.');

test('retry after a timed-out POST adopts the stored message id without asking again', async () => {
  lostRunServer({ askError: timeout(), stored: [{ id: 'msg_u1', text: 'Q' }] });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  expect(result.current.turns[0]?.run.phase).toBe('failed');
  await act(async () => {
    await result.current.retry(0);
  });
  expect(count('chats/chat_1/messages')).toBe(1);
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(paths()).toContain('chats/chat_1/runs/msg_u1');
  expect(result.current.turns[0]?.run.phase).toBe('done');
});

test('retry after a timed-out POST whose question is not stored asks once more', async () => {
  lostRunServer({ askError: timeout(), stored: [] });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  await act(async () => {
    await result.current.retry(0);
  });
  expect(count('chats/chat_1/messages')).toBe(2);
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('done');
});

test('retry with no chat id creates the chat and asks', async () => {
  lostRunServer({
    askError: null,
    stored: [],
    chatError: new ApiError(0, 'network_error', 'Could not reach the server.'),
  });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  expect(result.current.chatId).toBeNull();
  await act(async () => {
    await result.current.retry(0);
  });
  expect(count('chats')).toBe(2);
  expect(count('chats/chat_1/messages')).toBe(1);
  expect(count('chats/chat_1')).toBe(0);
});

test('retry after a server error response asks again without looking in the chat', async () => {
  lostRunServer({
    askError: new ApiError(500, 'internal_error', 'boom'),
    stored: [{ id: 'msg_u1', text: 'Q' }],
  });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  await act(async () => {
    await result.current.retry(0);
  });
  expect(count('chats/chat_1')).toBe(0);
  expect(count('chats/chat_1/messages')).toBe(2);
});

test('when getChat fails the turn stays failed and Retry stays available', async () => {
  lostRunServer({
    askError: timeout(),
    stored: new ApiError(0, 'network_error', 'Could not reach the server.'),
  });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  await act(async () => {
    await result.current.retry(0);
  });
  expect(result.current.turns[0]?.run).toEqual({
    phase: 'failed',
    steps: [],
    error: "Can't reach the server.",
  });
  expect(count('chats/chat_1/messages')).toBe(1);
  await act(async () => {
    await result.current.retry(0);
  });
  expect(count('chats/chat_1')).toBe(2);
});

test('a stored message id already used by another turn is not adopted', async () => {
  let asked = 0;
  fetchMock.mockImplementation(async (path: string) => {
    if (path === 'chats') return { id: 'chat_1', created_at: '' };
    if (path === 'chats/chat_1')
      return {
        id: 'chat_1',
        messages: [
          { role: 'user', id: 'msg_a', text: 'Same' },
          { role: 'assistant', id: 'msg_x', text: 'Same' },
        ],
      };
    if (path.endsWith('/messages')) {
      asked += 1;
      if (asked === 1) return { run_id: 'msg_a' };
      if (asked === 2) throw timeout();
      return { run_id: 'msg_c' };
    }
    return runOut({ status: 'done', message });
  });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Same');
  });
  await act(() => jest.advanceTimersByTimeAsync(500));
  await act(async () => {
    await result.current.ask('Same');
  });
  await act(async () => {
    await result.current.retry(1);
  });
  expect(count('chats/chat_1/messages')).toBe(3);
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(paths()).toContain('chats/chat_1/runs/msg_c');
  expect(paths()).not.toContain('chats/chat_1/runs/msg_x');
});

test('retryRun answered with not_failed resumes polling instead of failing', async () => {
  let polls = 0;
  fetchMock.mockImplementation(async (path: string) => {
    if (path === 'chats') return { id: 'chat_1', created_at: '' };
    if (path.endsWith('/messages')) return { run_id: 'run_1' };
    if (path.endsWith('/retry'))
      throw new ApiError(409, 'not_failed', 'The run is not failed.');
    polls += 1;
    if (polls === 1) throw new ApiError(404, 'not_found', 'Run not found.');
    return runOut({ status: 'done', message });
  });
  const { result } = await renderHook(() => useChatSession());
  await act(async () => {
    await result.current.ask('Q');
  });
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('interrupted');
  await act(async () => {
    await result.current.retry(0);
  });
  expect(result.current.turns[0]?.run.phase).toBe('sending');
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect(result.current.turns[0]?.run.phase).toBe('done');
});
