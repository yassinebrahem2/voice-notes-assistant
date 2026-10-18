import { reportNetworkError, reportOk } from '../server/statusStore';
import { getServerUrl } from '../settings/serverUrl';
import {
  ApiError,
  isApiErrorEnvelope,
  isGatewayStatus,
  parseApiError,
} from './errors';

export type { ErrorCode, Schemas } from './errors';
export { ApiError } from './errors';

function timeoutError(): ApiError {
  return new ApiError(0, 'timeout', 'The request timed out.');
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  let serverUrl: string | null;
  try {
    serverUrl = await getServerUrl();
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'Could not load the server URL. Check Settings.',
    );
  }
  if (serverUrl === null)
    throw new ApiError(0, 'network_error', 'Set a server URL in Settings.');

  const { timeoutMs = 10_000, signal: callerSignal, ...options } = init;
  if (callerSignal?.aborted) throw timeoutError();
  const controller = new AbortController();
  let rejectAbort!: (error: ApiError) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  // Only the deadline counts as the server being unreachable; a caller cancelling its own request says nothing.
  let deadlineHit = false;
  const abort = () => {
    controller.abort();
    rejectAbort(timeoutError());
  };
  callerSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    deadlineHit = true;
    abort();
  }, timeoutMs);

  async function request(): Promise<T> {
    const response = await fetch(
      `${serverUrl}/api/v1/${path.replace(/^\/+/, '')}`,
      {
        ...options,
        signal: controller.signal,
      },
    );
    if (response.ok && response.status === 204) {
      reportOk();
      return undefined as T;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      if (controller.signal.aborted || isAbortError(error))
        throw timeoutError();
      if (isGatewayStatus(response.status)) {
        reportNetworkError();
        throw new ApiError(0, 'network_error', 'Could not reach the server.');
      }
      reportOk();
      throw new ApiError(
        response.status,
        'internal_error',
        'The server returned an invalid response.',
      );
    }
    if (isGatewayStatus(response.status) && !isApiErrorEnvelope(body)) {
      reportNetworkError();
      throw new ApiError(0, 'network_error', 'Could not reach the server.');
    }
    reportOk();
    if (!response.ok) throw parseApiError(response.status, body);
    return body as T;
  }

  try {
    return await Promise.race([request(), aborted]);
  } catch (error: unknown) {
    // Reported here, not by the query cache: that fires only after the last retry, 30 s or more later.
    if (deadlineHit) reportNetworkError();
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted || isAbortError(error)) throw timeoutError();
    reportNetworkError();
    throw new ApiError(0, 'network_error', 'Could not reach the server.');
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abort);
  }
}
