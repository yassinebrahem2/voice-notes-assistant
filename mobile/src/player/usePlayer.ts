import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { useServerUrl } from '../settings/serverUrl';

export interface UsePlayerResult {
  playFrom: (positionMs: number) => Promise<void>;
  toggle: () => void;
  seekTo: (positionMs: number) => Promise<void>;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  error: string | null;
  retry: () => void;
}

export function usePlayer(recordingId: string): UsePlayerResult {
  const { url: serverUrl } = useServerUrl();
  const [error, setError] = useState<string | null>(null);

  const audioUrl = useMemo(() => {
    if (!serverUrl || !recordingId) return null;
    return `${serverUrl}/api/v1/recordings/${recordingId}/audio`;
  }, [serverUrl, recordingId]);

  const player = useAudioPlayer(audioUrl, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (!player || typeof player.addListener !== 'function') return;

    const sub = player.addListener(
      'playbackStatusUpdate',
      (s: { playbackState?: string }) => {
        if (s?.playbackState === 'error') {
          setError("Couldn't load audio");
        }
      },
    );

    return () => {
      sub?.remove?.();
    };
  }, [player]);

  const isPlaying = Boolean(status?.playing ?? player?.playing ?? false);
  const positionMs = Math.max(
    0,
    Math.round((status?.currentTime ?? player?.currentTime ?? 0) * 1000),
  );
  const durationMs = Math.max(
    0,
    Math.round((status?.duration ?? player?.duration ?? 0) * 1000),
  );

  const seekTo = useCallback(
    async (posMs: number) => {
      try {
        setError(null);
        const seconds = Math.max(0, posMs / 1000);
        if (player && typeof player.seekTo === 'function') {
          await player.seekTo(seconds);
        }
      } catch {
        setError("Couldn't load audio");
      }
    },
    [player],
  );

  const playFrom = useCallback(
    async (posMs: number) => {
      try {
        setError(null);
        const seconds = Math.max(0, posMs / 1000);
        if (player && typeof player.seekTo === 'function') {
          await player.seekTo(seconds);
        }
        if (player && typeof player.play === 'function') {
          player.play();
        }
      } catch {
        setError("Couldn't load audio");
      }
    },
    [player],
  );

  const toggle = useCallback(() => {
    try {
      setError(null);
      if (isPlaying) {
        if (player && typeof player.pause === 'function') {
          player.pause();
        }
      } else {
        if (player && typeof player.play === 'function') {
          player.play();
        }
      }
    } catch {
      setError("Couldn't load audio");
    }
  }, [isPlaying, player]);

  const retry = useCallback(() => {
    setError(null);
    if (audioUrl && player && typeof player.replace === 'function') {
      try {
        player.replace(audioUrl);
      } catch {
        setError("Couldn't load audio");
      }
    }
  }, [audioUrl, player]);

  return {
    playFrom,
    toggle,
    seekTo,
    isPlaying,
    positionMs,
    durationMs,
    error,
    retry,
  };
}
