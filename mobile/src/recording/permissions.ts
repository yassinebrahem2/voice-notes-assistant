import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';

let pending: Promise<'granted' | 'denied'> | undefined;

async function checkPermission(): Promise<'granted' | 'denied'> {
  const permission = await getRecordingPermissionsAsync();
  if (permission.granted) return 'granted';
  if (permission.status === 'denied' || !permission.canAskAgain)
    return 'denied';
  const response = await requestRecordingPermissionsAsync();
  return response.granted ? 'granted' : 'denied';
}

export function ensureMicPermission(): Promise<'granted' | 'denied'> {
  // A quick close/reopen must share the same OS prompt.
  pending ??= checkPermission().finally(() => {
    pending = undefined;
  });
  return pending;
}
