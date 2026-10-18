import type { Schemas } from '../api/client';

export interface Turn {
  speakerId: string | null;
  speakerName: string;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  segments: Schemas['SegmentOut'][];
}

function resolveSpeakerInfo(
  speakerId: string | null,
  speakers: Schemas['SpeakerOut'][],
): { name: string; label: string } {
  if (!speakerId) {
    return { name: 'Speaker', label: '' };
  }
  const match = speakers.find((s) => s.id === speakerId);
  if (!match) {
    return { name: 'Speaker', label: '' };
  }
  return {
    name: match.name?.trim() || match.display_name.trim() || 'Speaker',
    label: match.label ?? '',
  };
}

export function groupTurns(
  segments: Schemas['SegmentOut'][],
  speakers: Schemas['SpeakerOut'][],
): Turn[] {
  if (segments.length === 0) {
    return [];
  }

  const turns: Turn[] = [];

  for (const segment of segments) {
    const isNullSpeaker = segment.speaker_id === null;
    const lastTurn = turns[turns.length - 1];

    if (
      !isNullSpeaker &&
      lastTurn &&
      lastTurn.speakerId === segment.speaker_id
    ) {
      lastTurn.endMs = Math.max(lastTurn.endMs, segment.end_ms);
      lastTurn.text = `${lastTurn.text} ${segment.text}`.trim();
      lastTurn.segments.push(segment);
    } else {
      const { name, label } = resolveSpeakerInfo(segment.speaker_id, speakers);
      turns.push({
        speakerId: segment.speaker_id,
        speakerName: name,
        speakerLabel: label,
        startMs: segment.start_ms,
        endMs: segment.end_ms,
        text: segment.text.trim(),
        segments: [segment],
      });
    }
  }

  return turns;
}
