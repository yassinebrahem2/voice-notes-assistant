import { useSyncExternalStore } from 'react';

import { ApiError } from '../api/errors';
import { errorMessage } from '../api/errorMessages';
import * as api from './api';
import { isActive, nextRunView, type RunView } from './runMachine';

type Scope = 'notes' | 'meetings' | 'both';
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
    const targets = state.turns
      .map((turn, index) => ({ turn, index, runId: runIds[index] }))
      .filter(({ turn, runId }) => isActive(turn.run) && runId !== undefined);
    await Promise.all(
      targets.map(async ({ index, runId }) => {
        let view: RunView | undefined;
        try {
          const poll = await api.getRun(chatId, runId as string);
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

async function send(index: number, question: string): Promise<void> {
  const gen = generation;
  try {
    const chatId = await ensureChat();
    if (gen !== generation) return;
    if (state.chatId === null) emit({ ...state, chatId });
    const { run_id } = await api.ask(chatId, {
      text: question,
      scope: state.scope,
      ...(state.tagIds.length > 0 ? { tag_ids: state.tagIds } : {}),
    });
    if (gen !== generation) return;
    runIds[index] = run_id;
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
  if (!turn || isActive(turn.run)) return;
  const { chatId } = state;
  const runId = runIds[index];
  setRun(index, { phase: 'sending', steps: [] });
  startedAt[index] = Date.now();
  // The question never reached the server (the send itself failed): ask again.
  if (chatId === null || runId === undefined) {
    await send(index, turn.question);
    return;
  }
  const gen = generation;
  try {
    await api.retryRun(chatId, runId);
    if (gen !== generation) return;
    startedAt[index] = Date.now();
    schedulePoll();
  } catch (error: unknown) {
    if (gen !== generation) return;
    setRun(index, { phase: 'failed', steps: [], error: errorMessage(error) });
  }
}

function newChat(): void {
  generation += 1;
  stopPolling();
  creatingChat = null;
  runIds = [];
  startedAt = [];
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
