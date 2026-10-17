import type { Schemas } from '../api/client';
import { ApiError } from '../api/errors';
import { errorMessage } from '../api/errorMessages';

export interface RowStatus {
  label: string;
  progress: number | null;
  tone: 'normal' | 'error';
}

export function needsPolling(
  recordings?: Schemas['RecordingOut'][] | null,
): boolean {
  if (!recordings || recordings.length === 0) {
    return false;
  }
  return recordings.some((r) => r.status !== 'ready' && r.status !== 'failed');
}

export function rowStatus(r: Schemas['RecordingOut']): RowStatus | null {
  switch (r.status) {
    case 'uploaded':
      return { label: 'Waiting…', progress: 0.1, tone: 'normal' };
    case 'transcribing':
      return { label: 'Transcribing…', progress: 0.35, tone: 'normal' };
    case 'diarizing':
      return { label: 'Finding speakers…', progress: 0.55, tone: 'normal' };
    case 'analyzing':
      return { label: 'Summarizing…', progress: 0.75, tone: 'normal' };
    case 'indexing':
      return { label: 'Indexing…', progress: 0.9, tone: 'normal' };
    case 'failed': {
      let label = r.error_message;
      if (!label && r.error_code) {
        label = errorMessage(new ApiError(500, r.error_code, ''));
      }
      return {
        label: label || 'Processing failed.',
        progress: null,
        tone: 'error',
      };
    }
    case 'ready':
    default:
      return null;
  }
}
