import type { Schemas } from '../api/errors';
import { appInfo } from '../config/appInfo';
import { normalizeServerUrl } from './serverUrl';

export type HealthOut = Schemas['HealthOut'];
export type ConnectionResult =
  | { ok: true; health: HealthOut }
  | { ok: false; problem: 'not_https' | 'unreachable' | 'not_this_server' };

const TIMEOUT_MS = 5000;

function isHealth(body: unknown): body is HealthOut {
  if (typeof body !== 'object' || body === null) return false;
  const value = body as Record<string, unknown>;
  return (
    typeof value.app_name === 'string' &&
    typeof value.version === 'string' &&
    (value.speech_backend === 'real' || value.speech_backend === 'fake') &&
    typeof value.roles === 'object' &&
    value.roles !== null &&
    Object.values(value.roles).every((role) => typeof role === 'string')
  );
}

// Calls fetch directly: apiFetch would test the stored URL, not the one being typed.
// Throws the normaliser's message for an unparseable URL; the screen shows it as a typing error.
export async function testConnection(input: string): Promise<ConnectionResult> {
  const { url, https } = normalizeServerUrl(input);
  if (!https) return { ok: false, problem: 'not_https' };

  const controller = new AbortController();
  // Raced explicitly, like apiFetch, because a stalled fetch or body read may never reject on abort.
  let timedOut!: () => void;
  const timeout = new Promise<ConnectionResult>((resolve) => {
    timedOut = () => resolve({ ok: false, problem: 'unreachable' });
  });
  const timer = setTimeout(() => {
    controller.abort();
    timedOut();
  }, TIMEOUT_MS);

  async function request(): Promise<ConnectionResult> {
    try {
      const response = await fetch(`${url}/api/v1/health`, {
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return controller.signal.aborted
          ? { ok: false, problem: 'unreachable' }
          : { ok: false, problem: 'not_this_server' };
      }
      if (!response.ok || !isHealth(body) || body.app_name !== appInfo.name)
        return { ok: false, problem: 'not_this_server' };
      return { ok: true, health: body };
    } catch {
      return { ok: false, problem: 'unreachable' };
    }
  }

  try {
    return await Promise.race([request(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
