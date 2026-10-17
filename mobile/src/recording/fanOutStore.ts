import { useSyncExternalStore } from 'react';

// Module state, not React state: the Record disc lives inside the tab bar, but the menu must render at the root
// because Android does not deliver taps to views drawn outside their parent.
let open = false;
const listeners = new Set<() => void>();

function set(value: boolean): void {
  if (open === value) return;
  open = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openFanOut(): void {
  set(true);
}

export function closeFanOut(): void {
  set(false);
}

export function useFanOut(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
