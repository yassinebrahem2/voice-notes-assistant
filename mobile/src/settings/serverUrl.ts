import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'server_url';
const listeners = new Set<(url: string) => void>();

export function normalizeServerUrl(input: string): {
  url: string;
  https: boolean;
} {
  const url = input.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(url);
    const authority = /^https?:\/\/([^/]+)/i.exec(url)?.[1];
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      !authority ||
      authority.includes('@') ||
      url.includes('?') ||
      url.includes('#')
    ) {
      throw new Error('Invalid URL');
    }
    return { url, https: parsed.protocol === 'https:' };
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS server URL.');
  }
}

export async function getServerUrl(): Promise<string | null> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored === null ? null : normalizeServerUrl(stored).url;
}

export async function setServerUrl(input: string): Promise<void> {
  const { url } = normalizeServerUrl(input);
  await AsyncStorage.setItem(STORAGE_KEY, url);
  for (const listener of listeners) listener(url);
}

type ServerUrlState = {
  url: string | null;
  loading: boolean;
  error: Error | null;
};

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Could not access server settings.');
}

export function useServerUrl(): ServerUrlState & {
  setUrl: (url: string) => Promise<void>;
} {
  const [state, setState] = useState<ServerUrlState>({
    url: null,
    loading: true,
    error: null,
  });
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let updated = false;
    const onChange = (url: string) => {
      updated = true;
      setState({ url, loading: false, error: null });
    };
    listeners.add(onChange);
    void getServerUrl().then(
      (url) => {
        if (active && !updated) setState({ url, loading: false, error: null });
      },
      (error: unknown) => {
        if (active && !updated)
          setState({ url: null, loading: false, error: asError(error) });
      },
    );
    return () => {
      active = false;
      mounted.current = false;
      listeners.delete(onChange);
    };
  }, []);

  const setUrl = useCallback(async (url: string) => {
    try {
      await setServerUrl(url);
    } catch (error: unknown) {
      if (mounted.current)
        setState((previous) => ({ ...previous, error: asError(error) }));
      throw error;
    }
  }, []);

  return { ...state, setUrl };
}
