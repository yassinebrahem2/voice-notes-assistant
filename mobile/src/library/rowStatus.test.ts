import type { Schemas } from '../api/client';
import { needsPolling, rowStatus } from './rowStatus';

function makeRecording(
  overrides: Partial<Schemas['RecordingOut']> = {},
): Schemas['RecordingOut'] {
  return {
    id: 'rec-1',
    kind: 'meeting',
    title: 'Weekly Sync',
    status: 'uploaded',
    created_at: '2026-10-17T12:00:00Z',
    duration_ms: 120000,
    processing: true,
    error_code: null,
    error_message: null,
    failed_step: null,
    waveform_peaks: null,
    tags: [],
    ...overrides,
  };
}

describe('rowStatus', () => {
  test('returns Waiting… with progress 0.1 for uploaded', () => {
    const status = rowStatus(makeRecording({ status: 'uploaded' }));
    expect(status).toEqual({
      label: 'Waiting…',
      progress: 0.1,
      tone: 'normal',
    });
  });

  test('returns Transcribing… with progress 0.35 for transcribing', () => {
    const status = rowStatus(makeRecording({ status: 'transcribing' }));
    expect(status).toEqual({
      label: 'Transcribing…',
      progress: 0.35,
      tone: 'normal',
    });
  });

  test('returns Finding speakers… with progress 0.55 for diarizing', () => {
    const status = rowStatus(makeRecording({ status: 'diarizing' }));
    expect(status).toEqual({
      label: 'Finding speakers…',
      progress: 0.55,
      tone: 'normal',
    });
  });

  test('returns Summarizing… with progress 0.75 for analyzing', () => {
    const status = rowStatus(makeRecording({ status: 'analyzing' }));
    expect(status).toEqual({
      label: 'Summarizing…',
      progress: 0.75,
      tone: 'normal',
    });
  });

  test('returns Indexing… with progress 0.9 for indexing', () => {
    const status = rowStatus(makeRecording({ status: 'indexing' }));
    expect(status).toEqual({
      label: 'Indexing…',
      progress: 0.9,
      tone: 'normal',
    });
  });

  test('returns error tone and message with progress null for failed', () => {
    const statusWithMsg = rowStatus(
      makeRecording({
        status: 'failed',
        error_message: 'Audio could not be decoded',
      }),
    );
    expect(statusWithMsg).toEqual({
      label: 'Audio could not be decoded',
      progress: null,
      tone: 'error',
    });

    const statusWithCode = rowStatus(
      makeRecording({
        status: 'failed',
        error_message: null,
        error_code: 'transcription_failed',
      }),
    );
    expect(statusWithCode).toEqual({
      label: "Couldn't transcribe this recording.",
      progress: null,
      tone: 'error',
    });

    const statusFallback = rowStatus(
      makeRecording({
        status: 'failed',
        error_message: null,
        error_code: null,
      }),
    );
    expect(statusFallback).toEqual({
      label: 'Processing failed.',
      progress: null,
      tone: 'error',
    });
  });

  test('returns null for ready', () => {
    const status = rowStatus(
      makeRecording({ status: 'ready', processing: false }),
    );
    expect(status).toBeNull();
  });
});

describe('needsPolling', () => {
  test('returns false for null, undefined, or empty list', () => {
    expect(needsPolling(null)).toBe(false);
    expect(needsPolling(undefined)).toBe(false);
    expect(needsPolling([])).toBe(false);
  });

  test('returns false when all recordings are in terminal states', () => {
    const list = [
      makeRecording({ id: '1', status: 'ready' }),
      makeRecording({ id: '2', status: 'failed' }),
    ];
    expect(needsPolling(list)).toBe(false);
  });

  test('returns true when any recording is non-terminal', () => {
    const list = [
      makeRecording({ id: '1', status: 'ready' }),
      makeRecording({ id: '2', status: 'transcribing' }),
      makeRecording({ id: '3', status: 'failed' }),
    ];
    expect(needsPolling(list)).toBe(true);
  });
});
