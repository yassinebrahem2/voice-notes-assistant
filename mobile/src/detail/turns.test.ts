import type { Schemas } from '../api/client';
import { groupTurns } from './turns';

describe('groupTurns', () => {
  const speakers: Schemas['SpeakerOut'][] = [
    {
      id: 'spk_1',
      display_name: 'Alice',
      label: 'Speaker 1',
      name: 'Alice Cooper',
    },
    {
      id: 'spk_2',
      display_name: 'Bob',
      label: 'Speaker 2',
      name: null,
    },
  ];

  test('returns empty array when segments are empty', () => {
    expect(groupTurns([], speakers)).toEqual([]);
  });

  test('merges consecutive segments from the same speaker in a meeting', () => {
    const segments: Schemas['SegmentOut'][] = [
      {
        id: 'seg_1',
        idx: 0,
        speaker_id: 'spk_1',
        start_ms: 0,
        end_ms: 1500,
        text: 'Hello everyone.',
      },
      {
        id: 'seg_2',
        idx: 1,
        speaker_id: 'spk_1',
        start_ms: 1500,
        end_ms: 3200,
        text: 'Welcome to the meeting.',
      },
    ];

    const turns = groupTurns(segments, speakers);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toEqual({
      speakerId: 'spk_1',
      speakerName: 'Alice Cooper',
      speakerLabel: 'Speaker 1',
      startMs: 0,
      endMs: 3200,
      text: 'Hello everyone. Welcome to the meeting.',
      segments,
    });
  });

  test('creates separate turns on speaker changes', () => {
    const segments: Schemas['SegmentOut'][] = [
      {
        id: 'seg_1',
        idx: 0,
        speaker_id: 'spk_1',
        start_ms: 0,
        end_ms: 1000,
        text: 'First point.',
      },
      {
        id: 'seg_2',
        idx: 1,
        speaker_id: 'spk_2',
        start_ms: 1100,
        end_ms: 2000,
        text: 'I agree with that.',
      },
      {
        id: 'seg_3',
        idx: 2,
        speaker_id: 'spk_1',
        start_ms: 2100,
        end_ms: 3000,
        text: 'Moving on.',
      },
    ];

    const turns = groupTurns(segments, speakers);
    expect(turns).toHaveLength(3);
    expect(turns[0].speakerId).toBe('spk_1');
    expect(turns[0].speakerName).toBe('Alice Cooper');
    expect(turns[0].text).toBe('First point.');

    expect(turns[1].speakerId).toBe('spk_2');
    expect(turns[1].speakerName).toBe('Bob'); // name is null so fallback to display_name
    expect(turns[1].speakerLabel).toBe('Speaker 2');
    expect(turns[1].text).toBe('I agree with that.');

    expect(turns[2].speakerId).toBe('spk_1');
    expect(turns[2].text).toBe('Moving on.');
  });

  test('falls back to "Speaker" and "" when speaker is unknown', () => {
    const segments: Schemas['SegmentOut'][] = [
      {
        id: 'seg_1',
        idx: 0,
        speaker_id: 'spk_unknown',
        start_ms: 0,
        end_ms: 1000,
        text: 'Who said this?',
      },
    ];

    const turns = groupTurns(segments, speakers);
    expect(turns).toHaveLength(1);
    expect(turns[0].speakerName).toBe('Speaker');
    expect(turns[0].speakerLabel).toBe('');
  });

  test('does not merge consecutive segments when speaker_id is null (e.g. notes)', () => {
    const segments: Schemas['SegmentOut'][] = [
      {
        id: 'seg_1',
        idx: 0,
        speaker_id: null,
        start_ms: 0,
        end_ms: 1000,
        text: 'Note paragraph one.',
      },
      {
        id: 'seg_2',
        idx: 1,
        speaker_id: null,
        start_ms: 1200,
        end_ms: 2400,
        text: 'Note paragraph two.',
      },
    ];

    const turns = groupTurns(segments, speakers);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({
      speakerId: null,
      speakerName: 'Speaker',
      speakerLabel: '',
      startMs: 0,
      endMs: 1000,
      text: 'Note paragraph one.',
      segments: [segments[0]],
    });
    expect(turns[1]).toEqual({
      speakerId: null,
      speakerName: 'Speaker',
      speakerLabel: '',
      startMs: 1200,
      endMs: 2400,
      text: 'Note paragraph two.',
      segments: [segments[1]],
    });
  });
});
