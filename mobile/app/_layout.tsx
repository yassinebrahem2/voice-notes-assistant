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
import { useThemePreference } from '../src/settings/themePreference';
import { fontAssets } from '../src/theme/fonts';
import { paperTheme } from '../src/theme/paperTheme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const systemScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { preference } = useThemePreference();
  const scheme = preference === 'system' ? systemScheme : preference;
  const theme = paperTheme(scheme);
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontError) throw fontError;
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
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
