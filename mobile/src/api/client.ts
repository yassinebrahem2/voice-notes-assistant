import { getServerUrl } from '../settings/serverUrl';
import { ApiError, parseApiError } from './errors';

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
  const abort = () => {
    controller.abort();
    rejectAbort(timeoutError());
  };
  callerSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);

  async function request(): Promise<T> {
    const response = await fetch(
      `${serverUrl}/api/v1/${path.replace(/^\/+/, '')}`,
      {
        ...options,
        signal: controller.signal,
      },
    );
    if (response.ok && response.status === 204) return undefined as T;
    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      if (controller.signal.aborted || isAbortError(error))
        throw timeoutError();
      throw new ApiError(
        response.status,
        'internal_error',
        'The server returned an invalid response.',
      );
    }
    if (!response.ok) throw parseApiError(response.status, body);
    return body as T;
  }

  try {
    return await Promise.race([request(), aborted]);
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted || isAbortError(error)) throw timeoutError();
    throw new ApiError(0, 'network_error', 'Could not reach the server.');
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abort);
  }
}
