import type { Schemas } from '../api/client';

export function makeMockRecording(
  overrides: Partial<Schemas['RecordingDetailOut']> = {},
): Schemas['RecordingDetailOut'] {
  return {
    id: 'rec_1',
    kind: 'meeting',
    status: 'ready',
    title: 'Meeting',
    created_at: '2026-10-17T12:00:00Z',
    duration_ms: 10000,
    error_code: null,
    error_message: null,
    failed_step: null,
    processing: false,
    segments: [],
    speakers: [],
    tags: [],
    summary: null,
    note: null,
    waveform_peaks: null,
    ...overrides,
  };
}

export const mockPlayer = {
  isPlaying: false,
  positionMs: 0,
  durationMs: 60000,
  error: null,
  playFrom: jest.fn().mockResolvedValue(undefined),
  toggle: jest.fn(),
  seekTo: jest.fn().mockResolvedValue(undefined),
  retry: jest.fn(),
};

export const mockMeetingWithSummary: Schemas['RecordingDetailOut'] =
  makeMockRecording({
    id: 'rec_meeting',
    title: 'Sprint Planning',
    tags: [{ id: 'tag_1', name: 'Work', count: 1 }],
    duration_ms: 60000,
    speakers: [
      {
        id: 'spk_1',
        name: 'Sarah',
        display_name: 'Sarah',
        label: 'Speaker 1',
      },
    ],
    segments: [
      {
        id: 'seg_1',
        idx: 0,
        speaker_id: 'spk_1',
        start_ms: 12000,
        end_ms: 18000,
        text: 'We should release next Tuesday.',
      },
    ],
    summary: {
      overview: 'Discussed sprint timeline.',
      decisions: [
        {
          text: 'Ship on Tuesday.',
          citations: [
            {
              recording_id: 'rec_meeting',
              segment_id: 'seg_1',
              start_ms: 12000,
            },
          ],
        },
      ],
      action_items: [],
      open_questions: [],
    },
  });

export const mockNoteWithKeyPoints: Schemas['RecordingDetailOut'] =
  makeMockRecording({
    id: 'rec_note',
    kind: 'note',
    title: 'Idea for feature',
    duration_ms: 15000,
    segments: [
      {
        id: 'seg_n1',
        idx: 0,
        speaker_id: null,
        start_ms: 0,
        end_ms: 5000,
        text: 'Raw speech note.',
      },
    ],
    note: {
      key_points: [
        {
          text: 'Key idea number one.',
          citations: [
            { recording_id: 'rec_note', segment_id: 'seg_n1', start_ms: 0 },
          ],
        },
      ],
      clean_text: 'Cleaned up text of the idea.',
    },
  });
