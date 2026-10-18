import { useSyncExternalStore } from 'react';

export type ServerStatus = 'unknown' | 'ok' | 'unreachable' | 'no_server';

// Module state, not React state: apiFetch reports from outside React, and the banner, the tab bar and the poller read
// the same value. It imports nothing from src/api so that src/api/client.ts can use it without a cycle.
let status: ServerStatus = 'unknown';
const listeners = new Set<() => void>();

function set(value: ServerStatus): void {
  if (status === value) return;
  status = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportNetworkError(): void {
  set('unreachable');
}

export function reportOk(): void {
  set('ok');
}

export function reportNoServer(): void {
  set('no_server');
}

// Back to not knowing: a new or newly set server address has not been tried yet.
export function resetStatus(): void {
  set('unknown');
}

export function useServerStatusValue(): ServerStatus {
  return useSyncExternalStore(subscribe, () => status);
}
