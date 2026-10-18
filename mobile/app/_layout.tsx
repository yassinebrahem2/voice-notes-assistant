import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '../src/api/queryClient';
import { ServerBanner } from '../src/server/ServerBanner';
import { useThemePreference } from '../src/settings/themePreference';
import { fontAssets } from '../src/theme/fonts';
import { paperTheme } from '../src/theme/paperTheme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const systemScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { preference, loaded: themeLoaded } = useThemePreference();
  const scheme = preference === 'system' ? systemScheme : preference;
  const theme = paperTheme(scheme);
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontError) throw fontError;
    // The stored theme can arrive a frame after the fonts; hiding the splash before it would flash the system theme.
    if (fontsLoaded && themeLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError, themeLoaded]);

  if (!fontsLoaded || !themeLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <ServerBanner />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.tape.bg },
            }}
          >
            <Stack.Screen name="(tabs)" />
          </Stack>
        </PaperProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
