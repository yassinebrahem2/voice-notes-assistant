import type { Schemas } from '../api/errors';
import { citationLabel, splitAnswer } from './citations';

function cite(n: number, over: Partial<Schemas['CitationOut']> = {}) {
  return {
    n,
    recording_id: `rec_${n}`,
    recording_title: `Title ${n}`,
    segment_id: `seg_${n}`,
    start_ms: 0,
    ...over,
  };
}

describe('splitAnswer', () => {
  test('turns markers into citation parts in order', () => {
    const [one, two] = [cite(1), cite(2)];
    expect(splitAnswer('Yes [1] and no [2].', [one, two])).toEqual([
      { text: 'Yes ' },
      { citation: one },
      { text: ' and no ' },
      { citation: two },
      { text: '.' },
    ]);
  });

  test('a repeated marker becomes a chip each time', () => {
    const one = cite(1);
    expect(splitAnswer('A [1] B [1]', [one])).toEqual([
      { text: 'A ' },
      { citation: one },
      { text: ' B ' },
      { citation: one },
    ]);
  });

  test('an unknown marker stays as text', () => {
    expect(splitAnswer('See [3] now', [cite(1)])).toEqual([
      { text: 'See [3] now' },
    ]);
  });

  test('text without markers is one part, empty text has none', () => {
    expect(splitAnswer('Plain', [])).toEqual([{ text: 'Plain' }]);
    expect(splitAnswer('', [])).toEqual([]);
  });
});

describe('citationLabel', () => {
  test('joins the title and the mm:ss start', () => {
    expect(
      citationLabel(cite(1, { recording_title: 'Standup', start_ms: 83_000 })),
    ).toBe('Standup · 01:23');
  });

  test('pads seconds and keeps minutes past an hour', () => {
    expect(citationLabel(cite(1, { start_ms: 5_000 }))).toBe('Title 1 · 00:05');
    expect(citationLabel(cite(1, { start_ms: 3_725_000 }))).toBe(
      'Title 1 · 62:05',
    );
  });
});
