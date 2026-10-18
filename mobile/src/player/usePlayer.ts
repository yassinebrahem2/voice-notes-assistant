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

export function usePlayer(
  recordingId: string,
  enabled = true,
): UsePlayerResult {
  const { url: serverUrl } = useServerUrl();
  const [error, setError] = useState<string | null>(null);

  const audioUrl = useMemo(() => {
    if (!enabled || !serverUrl || !recordingId) return null;
    return `${serverUrl}/api/v1/recordings/${recordingId}/audio`;
  }, [enabled, serverUrl, recordingId]);

  const player = useAudioPlayer(audioUrl, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (!player) return;

    const sub = player.addListener(
      'playbackStatusUpdate',
      (s: { playbackState?: string; error?: string | null }) => {
        if (s?.playbackState === 'error' || Boolean(s?.error)) {
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
        const seconds = Math.max(0, posMs / 1000);
        if (player) {
          await player.seekTo(seconds);
        }
      } catch (err) {
        console.warn('Failed to seek player', err);
      }
    },
    [player],
  );

  const playFrom = useCallback(
    async (posMs: number) => {
      try {
        const seconds = Math.max(0, posMs / 1000);
        if (player) {
          await player.seekTo(seconds);
          player.play();
        }
      } catch (err) {
        console.warn('Failed to play from position', err);
      }
    },
    [player],
  );

  const toggle = useCallback(() => {
    try {
      if (!player) return;
      if (isPlaying) {
        player.pause();
      } else {
        player.play();
      }
    } catch (err) {
      console.warn('Failed to toggle playback', err);
    }
  }, [isPlaying, player]);

  const retry = useCallback(() => {
    setError(null);
    if (audioUrl && player) {
      try {
        player.replace(audioUrl);
      } catch (err) {
        console.warn('Failed to replace audio source', err);
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
