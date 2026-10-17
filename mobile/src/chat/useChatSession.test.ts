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
