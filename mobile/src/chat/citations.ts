import type { Schemas } from '../api/errors';

type Citation = Schemas['CitationOut'];
export type AnswerPart = { text: string } | { citation: Citation };

export function splitAnswer(text: string, citations: Citation[]): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let plain = '';
  // The capture group keeps the markers in the split result.
  for (const piece of text.split(/(\[\d+\])/)) {
    const marker = /^\[(\d+)\]$/.exec(piece);
    const citation = marker
      ? citations.find((c) => c.n === Number(marker[1]))
      : undefined;
    if (citation) {
      if (plain !== '') parts.push({ text: plain });
      plain = '';
      parts.push({ citation });
    } else {
      plain += piece;
    }
  }
  if (plain !== '') parts.push({ text: plain });
  return parts;
}

export function citationTime(startMs: number): string {
  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function citationLabel(c: Citation): string {
  return `${c.recording_title} · ${citationTime(c.start_ms)}`;
}
