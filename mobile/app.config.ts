import type { ExpoConfig } from 'expo/config';

import app from '../config/app.json';

const slug = app.name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const config: ExpoConfig = {
  owner: 'voicevoxas-team',
  name: app.name,
  slug,
  version: app.version,
  orientation: 'portrait',
  scheme: slug,
  userInterfaceStyle: 'automatic',
  android: { package: `com.app.${slug.replace(/-/g, '')}` },
  web: { output: 'single' },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-splash-screen',
    [
      'expo-audio',
      {
        microphonePermission:
          'Allow $(PRODUCT_NAME) to access your microphone for recording meetings and voice notes.',
        enableBackgroundRecording: true,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    appName: app.name,
    appVersion: app.version,
    eas: { projectId: '40fe53f5-bcdc-43ab-9fe4-fa30367bea81' },
  },
};

export default config;
