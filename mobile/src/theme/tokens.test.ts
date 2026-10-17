import { tokens } from './tokens';

const expected = {
  dark: {
    bg: '#121110',
    surface: '#1C1A18',
    raised: '#26231F',
    ink: '#F2EDE4',
    inkMuted: '#A39B90',
    line: '#34302B',
    outline: '#6E665C',
    signal: '#FF4D2E',
    onSignal: '#121110',
    speaker: ['#D98A6C', '#8FB394', '#8EA4C8', '#D4B05E', '#C495C0', '#6FB8B0'],
  },
  light: {
    bg: '#F6F3EE',
    surface: '#FFFFFF',
    raised: '#EDE8E0',
    ink: '#161412',
    inkMuted: '#6B645B',
    line: '#E3DDD3',
    outline: '#8C8378',
    signal: '#C4351A',
    onSignal: '#FFFFFF',
    speaker: ['#A4532F', '#48724F', '#4A6694', '#8A6A12', '#87507F', '#2F7A72'],
  },
};

describe.each(['light', 'dark'] as const)('%s tokens', (scheme) => {
  test('matches every semantic colour in the Tape specification', () => {
    expect(tokens[scheme]).toEqual(expected[scheme]);
    expect(tokens[scheme].speaker).toHaveLength(6);
  });
});
