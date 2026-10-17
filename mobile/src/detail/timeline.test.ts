import { timelineSteps } from './timeline';

describe('timelineSteps', () => {
  describe('meeting', () => {
    test('returns 5 steps with correct labels', () => {
      const steps = timelineSteps('meeting', 'uploaded');
      expect(steps.map((s) => s.step)).toEqual([
        'uploaded',
        'transcribing',
        'diarizing',
        'analyzing',
        'indexing',
      ]);
      expect(steps.map((s) => s.label)).toEqual([
        'Audio uploaded',
        'Transcribing audio',
        'Finding speakers',
        'Summarizing',
        'Indexing for search',
      ]);
    });

    test('marks all steps as done when status is ready', () => {
      const steps = timelineSteps('meeting', 'ready');
      expect(steps.every((s) => s.state === 'done')).toBe(true);
    });

    test('marks past steps done, active step current, remaining todo for in-progress statuses', () => {
      const diarizingSteps = timelineSteps('meeting', 'diarizing');
      expect(diarizingSteps.map((s) => s.state)).toEqual([
        'done',
        'done',
        'current',
        'todo',
        'todo',
      ]);

      const transcribingSteps = timelineSteps('meeting', 'transcribing');
      expect(transcribingSteps.map((s) => s.state)).toEqual([
        'done',
        'current',
        'todo',
        'todo',
        'todo',
      ]);
    });

    test('marks failed step failed, prior steps done, following steps todo', () => {
      const failedDiarizing = timelineSteps('meeting', 'failed', 'diarizing');
      expect(failedDiarizing.map((s) => s.state)).toEqual([
        'done',
        'done',
        'failed',
        'todo',
        'todo',
      ]);
    });

    test('maps decoding failure to transcribing step', () => {
      const failedDecoding = timelineSteps('meeting', 'failed', 'decoding');
      expect(failedDecoding[1].step).toBe('transcribing');
      expect(failedDecoding[1].state).toBe('failed');
      expect(failedDecoding[0].state).toBe('done');
      expect(failedDecoding.slice(2).every((s) => s.state === 'todo')).toBe(
        true,
      );
    });
  });

  describe('note', () => {
    test('returns 4 steps omitting diarizing', () => {
      const steps = timelineSteps('note', 'uploaded');
      expect(steps.map((s) => s.step)).toEqual([
        'uploaded',
        'transcribing',
        'analyzing',
        'indexing',
      ]);
      expect(steps.find((s) => s.step === 'diarizing')).toBeUndefined();
    });

    test('marks all steps as done when status is ready', () => {
      const steps = timelineSteps('note', 'ready');
      expect(steps.every((s) => s.state === 'done')).toBe(true);
    });

    test('marks active step current for note', () => {
      const analyzingSteps = timelineSteps('note', 'analyzing');
      expect(analyzingSteps.map((s) => s.state)).toEqual([
        'done',
        'done',
        'current',
        'todo',
      ]);
    });

    test('marks failed step for note', () => {
      const failedAnalyzing = timelineSteps('note', 'failed', 'analyzing');
      expect(failedAnalyzing.map((s) => s.state)).toEqual([
        'done',
        'done',
        'failed',
        'todo',
      ]);
    });
  });
});
