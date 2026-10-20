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
  icon: './assets/icon.png',
  android: {
    package: `com.app.${slug.replace(/-/g, '')}`,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundColor: '#191512',
    },
  },
  web: { output: 'single', favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#191512',
      },
    ],
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
