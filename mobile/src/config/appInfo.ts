import Constants from 'expo-constants';

const extra: unknown = Constants.expoConfig?.extra;
if (
  !extra ||
  typeof extra !== 'object' ||
  !('appName' in extra) ||
  typeof extra.appName !== 'string' ||
  !('appVersion' in extra) ||
  typeof extra.appVersion !== 'string'
) {
  throw new Error('App identity is missing from the Expo configuration.');
}

export const appInfo: { name: string; version: string } = {
  name: extra.appName,
  version: extra.appVersion,
};
