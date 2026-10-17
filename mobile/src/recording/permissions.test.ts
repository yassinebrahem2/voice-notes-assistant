import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';

import { ensureMicPermission } from './permissions';

jest.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: jest.fn(),
  requestRecordingPermissionsAsync: jest.fn(),
}));

const getPermission = jest.mocked(getRecordingPermissionsAsync);
const requestPermission = jest.mocked(requestRecordingPermissionsAsync);
const response = (status: 'granted' | 'denied' | 'undetermined') =>
  ({
    status,
    granted: status === 'granted',
    canAskAgain: true,
    expires: 'never',
  }) as Awaited<ReturnType<typeof getRecordingPermissionsAsync>>;

beforeEach(() => jest.resetAllMocks());

test('does not prompt again after denial, even when the OS allows another prompt', async () => {
  getPermission.mockResolvedValue(response('denied'));
  expect(await ensureMicPermission()).toBe('denied');
  expect(requestPermission).not.toHaveBeenCalled();
});

test('returns granted after the initial prompt is accepted', async () => {
  getPermission.mockResolvedValue(response('undetermined'));
  requestPermission.mockResolvedValue(response('granted'));
  expect(await ensureMicPermission()).toBe('granted');
  expect(requestPermission).toHaveBeenCalledTimes(1);
});

test('returns granted without prompting when already allowed', async () => {
  getPermission.mockResolvedValue(response('granted'));
  expect(await ensureMicPermission()).toBe('granted');
  expect(requestPermission).not.toHaveBeenCalled();
});

test('returns denied when the initial prompt is refused', async () => {
  getPermission.mockResolvedValue(response('undetermined'));
  requestPermission.mockResolvedValue(response('denied'));
  expect(await ensureMicPermission()).toBe('denied');
});

test('propagates native permission failures for the caller to explain', async () => {
  getPermission.mockRejectedValue(new Error('Microphone unavailable'));
  await expect(ensureMicPermission()).rejects.toThrow('Microphone unavailable');
});

test('shares one OS prompt between concurrent open attempts', async () => {
  getPermission.mockResolvedValue(response('undetermined'));
  requestPermission.mockResolvedValue(response('granted'));
  const first = ensureMicPermission();
  const second = ensureMicPermission();
  expect(await Promise.all([first, second])).toEqual(['granted', 'granted']);
  expect(requestPermission).toHaveBeenCalledTimes(1);
});
