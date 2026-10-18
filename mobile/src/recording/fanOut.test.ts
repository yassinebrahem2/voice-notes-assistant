import { fanOutReducer } from './fanOut';

test.each(['meeting', 'note'] as const)('chooses %s from idle', (kind) => {
  expect(fanOutReducer('idle', { choose: kind })).toEqual({ chosen: kind });
});

test('ignores another choice until reset', () => {
  const chosen = { chosen: 'meeting' } as const;
  expect(fanOutReducer(chosen, { choose: 'note' })).toBe(chosen);
  expect(fanOutReducer(chosen, 'reset')).toBe('idle');
  expect(fanOutReducer('idle', 'reset')).toBe('idle');
});
