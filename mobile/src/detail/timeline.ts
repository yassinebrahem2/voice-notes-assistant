import type { Schemas } from '../api/client';

export type TimelineStepState = 'done' | 'current' | 'todo' | 'failed';

export type TimelineStepKey =
  'uploaded' | 'transcribing' | 'diarizing' | 'analyzing' | 'indexing';

export interface TimelineStepItem {
  step: TimelineStepKey;
  label: string;
  state: TimelineStepState;
}

const STEP_LABELS: Record<TimelineStepKey, string> = {
  uploaded: 'Audio uploaded',
  transcribing: 'Transcribing audio',
  diarizing: 'Finding speakers',
  analyzing: 'Summarizing',
  indexing: 'Indexing for search',
};

const MEETING_STEPS: TimelineStepKey[] = [
  'uploaded',
  'transcribing',
  'diarizing',
  'analyzing',
  'indexing',
];

const NOTE_STEPS: TimelineStepKey[] = [
  'uploaded',
  'transcribing',
  'analyzing',
  'indexing',
];

function resolveFailedStep(
  failedStep: Schemas['RecordingDetailOut']['failed_step'] | undefined,
  steps: TimelineStepKey[],
): TimelineStepKey {
  if (!failedStep || failedStep === 'decoding') {
    return 'transcribing';
  }
  if (steps.includes(failedStep)) {
    return failedStep;
  }
  return 'transcribing';
}

export function timelineSteps(
  kind: 'meeting' | 'note',
  status: Schemas['RecordingDetailOut']['status'],
  failedStep?: Schemas['RecordingDetailOut']['failed_step'],
): TimelineStepItem[] {
  const stepKeys = kind === 'meeting' ? MEETING_STEPS : NOTE_STEPS;

  if (status === 'ready') {
    return stepKeys.map((step) => ({
      step,
      label: STEP_LABELS[step],
      state: 'done',
    }));
  }

  if (status === 'failed') {
    const failedKey = resolveFailedStep(failedStep, stepKeys);
    const failedIdx = stepKeys.indexOf(failedKey);

    return stepKeys.map((step, idx) => {
      let state: TimelineStepState;
      if (idx < failedIdx) {
        state = 'done';
      } else if (idx === failedIdx) {
        state = 'failed';
      } else {
        state = 'todo';
      }
      return {
        step,
        label: STEP_LABELS[step],
        state,
      };
    });
  }

  // In-progress statuses
  let currentIdx = stepKeys.indexOf(status as TimelineStepKey);
  if (currentIdx === -1) {
    currentIdx = 0;
  }

  return stepKeys.map((step, idx) => {
    let state: TimelineStepState;
    if (idx < currentIdx) {
      state = 'done';
    } else if (idx === currentIdx) {
      state = 'current';
    } else {
      state = 'todo';
    }
    return {
      step,
      label: STEP_LABELS[step],
      state,
    };
  });
}
