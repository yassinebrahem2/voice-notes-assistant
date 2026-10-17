import { ApiError, type ErrorCode } from './errors';

// null: show the server's own message. Typed over every code so a new one fails type checking until it has an entry.
const messages: Record<ErrorCode | 'network_error' | 'timeout', string | null> =
  {
    network_error: "Can't reach the server.",
    timeout: 'The server took too long to answer.',
    validation_error: null,
    not_found: 'Not found.',
    payload_too_large: 'This recording is too large to upload.',
    unsupported_media_type: "This audio format isn't supported.",
    recording_busy: 'Available when processing finishes.',
    not_failed: null,
    not_ready: 'Available once processing is done.',
    audio_unreadable: "Couldn't read this audio.",
    transcription_failed: "Couldn't transcribe this recording.",
    diarization_failed: "Couldn't tell the speakers apart.",
    analysis_failed: "Couldn't analyze this recording.",
    indexing_failed: "Couldn't prepare this recording for search.",
    ai_unavailable: "Couldn't reach the AI right now.",
    timed_out: 'That took too long.',
    not_implemented: 'Not available yet.',
    internal_error: 'Something went wrong on the server.',
  };

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return messages[error.code] ?? error.message;
  }
  return 'Something went wrong.';
}
