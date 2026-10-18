import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';

export async function checkAudioPlayable(
  uri: string | null | undefined,
): Promise<boolean> {
  if (!uri) return false;
  try {
    const file = new File(uri);
    if (!file.exists) return false;
  } catch {
    return false;
  }

  let player: AudioPlayer | null = null;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sub: { remove: () => void } | null = null;

    const finish = (result: boolean) => {
      if (!settled) {
        settled = true;
        if (timer !== null) clearTimeout(timer);
        try {
          sub?.remove();
        } catch {}
        try {
          player?.release();
        } catch {}
        resolve(result);
      }
    };

    timer = setTimeout(() => {
      finish(false);
    }, 3000);

    try {
      player = createAudioPlayer(uri);
    } catch {
      finish(false);
      return;
    }

    if (player.currentStatus) {
      const s = player.currentStatus as {
        hasError?: boolean;
        error?: string | null;
        isLoaded?: boolean;
        duration?: number;
      };
      if (s.hasError || s.error) {
        finish(false);
        return;
      }
      if (s.isLoaded && (s.duration ?? 0) > 0) {
        finish(true);
        return;
      }
    }

    try {
      sub = player.addListener('playbackStatusUpdate', (status) => {
        const s = status as {
          hasError?: boolean;
          error?: string | null;
          isLoaded?: boolean;
          duration?: number;
        };
        if (s.hasError || s.error) {
          finish(false);
        } else if (s.isLoaded) {
          if ((s.duration ?? 0) > 0) {
            finish(true);
          } else {
            finish(false);
          }
        }
      });
    } catch {
      finish(false);
    }
  });
}
