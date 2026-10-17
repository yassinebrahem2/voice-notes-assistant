import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const listeners = new Set<(preference: ThemePreference) => void>();

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export async function getThemePreference(): Promise<ThemePreference> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return isThemePreference(stored) ? stored : 'system';
}

export async function setThemePreference(
  preference: ThemePreference,
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, preference);
  for (const listener of listeners) listener(preference);
}

export function useThemePreference(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => Promise<void>;
} {
  const [preference, setLocal] = useState<ThemePreference>('system');

  useEffect(() => {
    let active = true;
    let updated = false;
    const onChange = (next: ThemePreference) => {
      updated = true;
      setLocal(next);
    };
    listeners.add(onChange);
    // A failed read keeps the system theme rather than blocking the app.
    void getThemePreference().then(
      (stored) => {
        if (active && !updated) setLocal(stored);
      },
      () => undefined,
    );
    return () => {
      active = false;
      listeners.delete(onChange);
    };
  }, []);

  const setPreference = useCallback(
    (next: ThemePreference) => setThemePreference(next),
    [],
  );
  return { preference, setPreference };
}
