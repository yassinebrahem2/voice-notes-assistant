const jestPreset = require('jest-expo/jest-preset');

module.exports = {
  preset: 'jest-expo',
  resolver: 'react-native-reanimated/jest/resolver',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transformIgnorePatterns: jestPreset.transformIgnorePatterns.map((pattern) =>
    typeof pattern === 'string' && pattern.includes('node_modules/(?!')
      ? pattern.replace('standard-navigation', 'standard-navigation|marked')
      : pattern,
  ),
};
