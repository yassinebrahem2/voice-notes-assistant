import type { components } from './schema';

export type Schemas = components['schemas'];
export type ErrorCode = Schemas['ErrorCode'];

const errorCodes = {
  validation_error: true,
  not_found: true,
  payload_too_large: true,
  unsupported_media_type: true,
  recording_busy: true,
  not_failed: true,
  not_ready: true,
  audio_unreadable: true,
  transcription_failed: true,
  diarization_failed: true,
  analysis_failed: true,
  indexing_failed: true,
  ai_unavailable: true,
  timed_out: true,
  not_implemented: true,
  internal_error: true,
} satisfies Record<ErrorCode, boolean>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'network_error' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(errorCodes, code);
}

export function parseApiError(status: number, body: unknown): ApiError {
  if (
    isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.code === 'string' &&
    typeof body.error.message === 'string'
  ) {
    return new ApiError(
      status,
      isErrorCode(body.error.code) ? body.error.code : 'internal_error',
      body.error.message,
    );
  }
  return new ApiError(
    status,
    'internal_error',
    'The server returned an invalid response.',
  );
}
