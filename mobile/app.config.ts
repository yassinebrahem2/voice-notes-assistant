import type { ExpoConfig } from 'expo/config';

import app from '../config/app.json';

const slug = app.name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const config: ExpoConfig = {
  name: app.name,
  slug,
  version: app.version,
  orientation: 'portrait',
  scheme: slug,
  userInterfaceStyle: 'automatic',
  android: { package: `com.app.${slug.replace(/-/g, '')}` },
  web: { output: 'single' },
  plugins: ['expo-router', 'expo-font', 'expo-splash-screen'],
  experiments: { typedRoutes: true },
  extra: { appName: app.name, appVersion: app.version },
};

export default config;
