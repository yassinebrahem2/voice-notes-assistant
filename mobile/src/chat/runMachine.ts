import { errorMessage } from '../api/errorMessages';
import { ApiError, type Schemas } from '../api/errors';

export const TOO_SLOW_MS = 90_000;

export type RunView = {
  phase: 'sending' | 'running' | 'done' | 'failed' | 'interrupted' | 'too_slow';
  steps: string[];
  message?: Schemas['MessageOut'];
  error?: string;
};

export type RunEvent =
  { poll: Schemas['RunOut'] } | { pollError: ApiError } | { elapsedMs: number };

export function isActive(view: RunView): boolean {
  return view.phase === 'sending' || view.phase === 'running';
}

export function nextRunView(prev: RunView, event: RunEvent): RunView {
  // A finished run is final until the user retries, which starts a new view.
  if (!isActive(prev)) return prev;

  if ('poll' in event) {
    const { status, steps, message, error } = event.poll;
    if (status === 'done') {
      return message
        ? { phase: 'done', steps, message }
        : { phase: 'done', steps };
    }
    if (status === 'failed') {
      return {
        phase: 'failed',
        steps,
        error: errorMessage(
          error
            ? new ApiError(0, error.code, error.message)
            : new ApiError(0, 'internal_error', 'The run failed.'),
        ),
      };
    }
    return { phase: 'running', steps };
  }

  if ('pollError' in event) {
    // Runs live in server memory, so a 404 means the server restarted. Any other
    // error (network, timeout) is transient: keep polling until the 90 s limit.
    return event.pollError.status === 404
      ? { phase: 'interrupted', steps: prev.steps }
      : prev;
  }

  return event.elapsedMs >= TOO_SLOW_MS
    ? { phase: 'too_slow', steps: prev.steps }
    : prev;
}
