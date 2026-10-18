import { useSyncExternalStore } from 'react';

let message: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showSnackbar(msg: string): void {
  message = msg;
  emit();
}

export function dismissSnackbar(): void {
  message = null;
  emit();
}

export function getSnackbarMessage(): string | null {
  return message;
}

export function useSnackbar(): string | null {
  return useSyncExternalStore(subscribe, () => message);
}
