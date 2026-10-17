import { useSyncExternalStore } from 'react';

import { ApiError, type Schemas } from '../api/errors';
import { errorMessage } from '../api/errorMessages';
import * as api from './api';
import { isActive, nextRunView, type RunView } from './runMachine';

type Scope = Schemas['AskIn']['scope'];
// Why a turn has no run id: the POST may or may not have stored the question.
type Unsent = 'rejected' | 'uncertain';
type Turn = { question: string; run: RunView };

type State = {
  chatId: string | null;
  turns: Turn[];
  scope: Scope;
  tagIds: string[];
};

const POLL_MS = 500;

// Module state, not React state, so a run keeps going while the user visits another tab.
let state: State = { chatId: null, turns: [], scope: 'both', tagIds: [] };
// Per turn index; kept out of State because the screens never need them.
let runIds: (string | undefined)[] = [];
let startedAt: number[] = [];
let unsent: (Unsent | undefined)[] = [];
// Bumped by newChat so late responses of the old chat are dropped.
let generation = 0;
let creatingChat: Promise<string> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
const listeners = new Set<() => void>();

function emit(next: State): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function setRun(index: number, run: RunView): void {
  emit({
    ...state,
    turns: state.turns.map((turn, i) =>
      i === index ? { ...turn, run } : turn,
    ),
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function stopPolling(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function schedulePoll(): void {
  if (timer !== null || polling) return;
  if (!state.turns.some((turn) => isActive(turn.run))) return;
  timer = setTimeout(() => {
    timer = null;
    void pollOnce();
  }, POLL_MS);
}

async function pollOnce(): Promise<void> {
  const { chatId } = state;
  const gen = generation;
  if (chatId === null) return;
  polling = true;
  try {
    const targets = state.turns.flatMap((turn, index) => {
      const runId = runIds[index];
      return isActive(turn.run) && runId !== undefined
        ? [{ index, runId }]
        : [];
    });
    await Promise.all(
      targets.map(async ({ index, runId }) => {
        let view: RunView | undefined;
        try {
          const poll = await api.getRun(chatId, runId);
          if (gen !== generation) return;
          view = nextRunView(state.turns[index].run, { poll });
        } catch (error: unknown) {
          if (gen !== generation) return;
          if (!(error instanceof ApiError)) throw error;
          view = nextRunView(state.turns[index].run, { pollError: error });
        }
        view = nextRunView(view, { elapsedMs: Date.now() - startedAt[index] });
        setRun(index, view);
      }),
    );
  } finally {
    polling = false;
  }
  schedulePoll();
}

async function ensureChat(): Promise<string> {
  if (state.chatId !== null) return state.chatId;
  creatingChat ??= api.createChat().then(
    ({ id }) => id,
    (error: unknown) => {
      creatingChat = null;
      throw error;
    },
  );
  const id = await creatingChat;
  creatingChat = null;
  return id;
}

// A network drop, timeout, 5xx or unreadable 2xx leaves the question possibly stored
// (the backend stores the user message before starting the run); only a 4xx means the
// server rejected it without storing.
function unsentKind(error: unknown): Unsent {
  if (!(error instanceof ApiError)) return 'rejected';
  const lost = error.code === 'network_error' || error.code === 'timeout';
  const is5xx = error.status >= 500 && error.status < 600;
  const is2xx = error.status >= 200 && error.status < 300;
  return lost || is5xx || is2xx ? 'uncertain' : 'rejected';
}

async function send(index: number, question: string): Promise<void> {
  const gen = generation;
  try {
    const chatId = await ensureChat();
    if (gen !== generation) return;
    if (state.chatId === null) emit({ ...state, chatId });
    let runId: string;
    try {
      ({ run_id: runId } = await api.ask(chatId, {
        text: question,
        scope: state.scope,
        ...(state.tagIds.length > 0 ? { tag_ids: state.tagIds } : {}),
      }));
    } catch (error: unknown) {
      // A late failure of an old chat must not write into the new chat's turn at this index.
      if (gen === generation) unsent[index] = unsentKind(error);
      throw error;
    }
    if (gen !== generation) return;
    unsent[index] = undefined;
    runIds[index] = runId;
    startedAt[index] = Date.now();
    schedulePoll();
  } catch (error: unknown) {
    if (gen !== generation) return;
    setRun(index, { phase: 'failed', steps: [], error: errorMessage(error) });
  }
}

async function ask(text: string): Promise<void> {
  const question = text.trim();
  if (question === '' || state.turns.some((turn) => isActive(turn.run))) return;
  const index = state.turns.length;
  startedAt[index] = Date.now();
  emit({
    ...state,
    turns: [...state.turns, { question, run: { phase: 'sending', steps: [] } }],
  });
  await send(index, question);
}

async function retry(index: number): Promise<void> {
  const turn = state.turns[index];
  // Same guard as ask: a second active run would be polled before the server
  // registers the retried one (404 -> wrongly interrupted) and answers would interleave.
  if (!turn || state.turns.some((t) => isActive(t.run))) return;
  const { chatId } = state;
  const runId = runIds[index];
  setRun(index, { phase: 'sending', steps: [] });
  startedAt[index] = Date.now();
  const gen = generation;
  if (runId === undefined || chatId === null) {
    if (chatId !== null && unsent[index] === 'uncertain') {
      await recoverRunId(chatId, index, turn.question);
    } else {
      // Nothing was stored: no chat yet, or the server answered with an error.
      await send(index, turn.question);
    }
    return;
  }
  try {
    await api.retryRun(chatId, runId);
  } catch (error: unknown) {
    if (gen !== generation) return;
    // not_failed: the run is still going or already done, so just follow it.
    if (!(error instanceof ApiError && error.code === 'not_failed')) {
      setRun(index, { phase: 'failed', steps: [], error: errorMessage(error) });
      return;
    }
  }
  if (gen !== generation) return;
  startedAt[index] = Date.now();
  schedulePoll();
}

// The run id is the stored user message's id, so a POST whose answer was lost can be
// found again in the chat instead of sending the question a second time.
async function recoverRunId(
  chatId: string,
  index: number,
  question: string,
): Promise<void> {
  const gen = generation;
  let detail: Schemas['ChatDetailOut'];
  try {
    detail = await api.getChat(chatId);
  } catch (error: unknown) {
    if (gen !== generation) return;
    setRun(index, { phase: 'failed', steps: [], error: errorMessage(error) });
    return;
  }
  if (gen !== generation) return;
  const stored = detail.messages.find(
    (m) => m.role === 'user' && m.text === question && !runIds.includes(m.id),
  );
  if (stored === undefined) {
    await send(index, question);
    return;
  }
  unsent[index] = undefined;
  runIds[index] = stored.id;
  startedAt[index] = Date.now();
  schedulePoll();
}

function newChat(): void {
  generation += 1;
  stopPolling();
  creatingChat = null;
  runIds = [];
  startedAt = [];
  unsent = [];
  emit({ ...state, chatId: null, turns: [] });
}

function setScope(scope: Scope): void {
  emit({ ...state, scope });
}

function setTagIds(tagIds: string[]): void {
  emit({ ...state, tagIds });
}

export function useChatSession(): State & {
  ask: (text: string) => Promise<void>;
  retry: (index: number) => Promise<void>;
  newChat: () => void;
  setScope: (scope: Scope) => void;
  setTagIds: (tagIds: string[]) => void;
} {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  return { ...snapshot, ask, retry, newChat, setScope, setTagIds };
}
