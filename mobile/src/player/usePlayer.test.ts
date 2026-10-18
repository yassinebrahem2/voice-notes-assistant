import { act, renderHook } from '@testing-library/react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { useServerUrl } from '../settings/serverUrl';
import { usePlayer } from './usePlayer';

jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(),
  useAudioPlayerStatus: jest.fn(),
}));

jest.mock('../settings/serverUrl', () => ({
  useServerUrl: jest.fn(),
}));

const mockUseAudioPlayer = jest.mocked(useAudioPlayer);
const mockUseAudioPlayerStatus = jest.mocked(useAudioPlayerStatus);
const mockUseServerUrl = jest.mocked(useServerUrl);

describe('usePlayer', () => {
  let mockPlayer: {
    play: jest.Mock;
    pause: jest.Mock;
    seekTo: jest.Mock;
    replace: jest.Mock;
    addListener: jest.Mock;
    currentTime: number;
    duration: number;
    playing: boolean;
  };

  let mockStatus: {
    playing: boolean;
    currentTime: number;
    duration: number;
    playbackState: string;
  };

  let statusListener: ((status: unknown) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStatus = {
      playing: false,
      currentTime: 0,
      duration: 10,
      playbackState: 'ready',
    };

    mockPlayer = {
      play: jest.fn(),
      pause: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      replace: jest.fn(),
      addListener: jest.fn((event, callback) => {
        if (event === 'playbackStatusUpdate') {
          statusListener = callback;
        }
        return { remove: jest.fn() };
      }),
      currentTime: 0,
      duration: 10,
      playing: false,
    };

    mockUseAudioPlayer.mockReturnValue(mockPlayer as never);
    mockUseAudioPlayerStatus.mockReturnValue(mockStatus as never);
    mockUseServerUrl.mockReturnValue({
      url: 'http://127.0.0.1:8000',
      loading: false,
      error: null,
      setUrl: jest.fn(),
    });
  });

  test('converts position and duration from seconds to ms', async () => {
    mockStatus.currentTime = 3.25;
    mockStatus.duration = 45.5;

    const { result } = await renderHook(() => usePlayer('rec_123'));

    expect(result.current.positionMs).toBe(3250);
    expect(result.current.durationMs).toBe(45500);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('playFrom seeks then plays with mocked expo-audio', async () => {
    const callOrder: string[] = [];
    mockPlayer.seekTo.mockImplementation(async (secs: number) => {
      callOrder.push(`seekTo:${secs}`);
    });
    mockPlayer.play.mockImplementation(() => {
      callOrder.push('play');
    });

    const { result } = await renderHook(() => usePlayer('rec_123'));

    await act(async () => {
      await result.current.playFrom(2500);
    });

    expect(mockPlayer.seekTo).toHaveBeenCalledWith(2.5);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['seekTo:2.5', 'play']);
  });

  test('toggle plays when paused', async () => {
    mockStatus.playing = false;
    const { result } = await renderHook(() => usePlayer('rec_123'));
    await act(async () => {
      result.current.toggle();
    });
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.pause).not.toHaveBeenCalled();
  });

  test('toggle pauses when playing', async () => {
    const playingStatus = { ...mockStatus, playing: true };
    mockUseAudioPlayerStatus.mockReturnValue(playingStatus as never);
    mockPlayer.playing = true;

    const { result } = await renderHook(() => usePlayer('rec_123'));
    await act(async () => {
      result.current.toggle();
    });
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  test('failed seek logs console.warn and does not set error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPlayer.seekTo.mockRejectedValueOnce(new Error('Audio seek failure'));

    const { result } = await renderHook(() => usePlayer('rec_123'));

    await act(async () => {
      await result.current.playFrom(1000);
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  test('playbackStatusUpdate with error shows "Couldn\'t load audio" and retry replaces source', async () => {
    const { result } = await renderHook(() => usePlayer('rec_123'));

    expect(result.current.error).toBeNull();

    await act(async () => {
      statusListener?.({ error: 'Player decode error' });
    });

    expect(result.current.error).toBe("Couldn't load audio");

    await act(async () => {
      result.current.retry();
    });

    expect(result.current.error).toBeNull();
    expect(mockPlayer.replace).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/recordings/rec_123/audio',
    );
  });

  test('when enabled is false, does not create audio source', async () => {
    await renderHook(() => usePlayer('rec_123', false));
    expect(mockUseAudioPlayer).toHaveBeenCalledWith(null, expect.anything());
  });
});
