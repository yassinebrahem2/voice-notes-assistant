import { useEffect, useRef } from 'react';

import { apiFetch } from '../api/client';
import { useServerUrl } from '../settings/serverUrl';
import {
  reportNoServer,
  resetStatus,
  useServerStatusValue,
  type ServerStatus,
} from './statusStore';

const POLL_INTERVAL_MS = 10_000;

// Mount this once (the root banner does). It owns the only health poller; other components read
// useServerStatusValue instead.
export function useServerStatus(): ServerStatus {
  const status = useServerStatusValue();
  const { url, loading, error } = useServerUrl();
  const unreachable = status === 'unreachable';

  const previousUrl = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (loading) return;
    // An unreadable setting leaves nothing to test, so it reads as no address.
    const current = error ? null : url;
    if (current === null) reportNoServer();
    // A newly set address has not been tried yet. The first load must not reset: a request may already have failed.
    else if (
      previousUrl.current !== undefined &&
      previousUrl.current !== current
    )
      resetStatus();
    previousUrl.current = current;
  }, [url, loading, error]);

  useEffect(() => {
    if (!unreachable) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The next poll is scheduled only after the previous one settles, so polls never overlap. apiFetch reports ok on
    // success, which ends this effect.
    const poll = () => {
      timer = setTimeout(() => {
        apiFetch<unknown>('health', { signal: controller.signal }).then(
          schedule,
          schedule,
        );
      }, POLL_INTERVAL_MS);
    };
    const schedule = () => {
      if (!controller.signal.aborted) poll();
    };
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [unreachable]);

  return status;
}
