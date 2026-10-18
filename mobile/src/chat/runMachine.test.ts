import { ApiError, type Schemas } from '../api/errors';
import { nextRunView, type RunView } from './runMachine';

const message = {
  id: 'msg_1',
  text: 'Answer',
} as unknown as Schemas['MessageOut'];

function run(over: Partial<Schemas['RunOut']>): Schemas['RunOut'] {
  return { status: 'running', steps: [], message: null, error: null, ...over };
}

const sending: RunView = { phase: 'sending', steps: [] };
const running: RunView = { phase: 'running', steps: ['Searching notes'] };

test('a running poll shows the latest steps', () => {
  expect(
    nextRunView(sending, {
      poll: run({ steps: ['Searching notes', 'Reading meetings'] }),
    }),
  ).toEqual({
    phase: 'running',
    steps: ['Searching notes', 'Reading meetings'],
  });
});

test('a done poll carries the server message untouched', () => {
  expect(
    nextRunView(running, {
      poll: run({ status: 'done', steps: ['Searching notes'], message }),
    }),
  ).toEqual({ phase: 'done', steps: ['Searching notes'], message });
});

test('a failed ai_unavailable run shows the fixed text', () => {
  const view = nextRunView(running, {
    poll: run({
      status: 'failed',
      error: { code: 'ai_unavailable', message: 'upstream 503' },
    }),
  });
  expect(view.phase).toBe('failed');
  expect(view.error).toBe("Couldn't reach the AI right now.");
});

test('a 404 poll means the server restarted', () => {
  expect(
    nextRunView(running, {
      pollError: new ApiError(404, 'not_found', 'Run not found.'),
    }),
  ).toEqual({ phase: 'interrupted', steps: ['Searching notes'] });
});

test('network errors keep polling', () => {
  expect(
    nextRunView(running, {
      pollError: new ApiError(
        0,
        'network_error',
        'Could not reach the server.',
      ),
    }),
  ).toBe(running);
});

test('90 seconds without an answer is too slow', () => {
  expect(nextRunView(running, { elapsedMs: 89_999 })).toBe(running);
  expect(nextRunView(running, { elapsedMs: 90_000 })).toEqual({
    phase: 'too_slow',
    steps: ['Searching notes'],
  });
});

test('a finished run ignores late events', () => {
  const done: RunView = { phase: 'done', steps: [], message };
  expect(nextRunView(done, { elapsedMs: 120_000 })).toBe(done);
  expect(nextRunView(done, { poll: run({}) })).toBe(done);
});
