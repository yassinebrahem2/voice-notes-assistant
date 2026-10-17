import type { Schemas } from '../api/client';

export type RecordingKind = Schemas['RecordingOut']['kind'];
export type FanOutPhase = 'idle' | { chosen: RecordingKind };

export function fanOutReducer(
  phase: FanOutPhase,
  action: { choose: RecordingKind } | 'reset',
): FanOutPhase {
  if (action === 'reset') return 'idle';
  return phase === 'idle' ? { chosen: action.choose } : phase;
}
