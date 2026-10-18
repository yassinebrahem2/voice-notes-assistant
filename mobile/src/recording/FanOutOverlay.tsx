import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';
import { fanOutReducer, type RecordingKind } from './fanOut';
import { closeFanOut, useFanOut } from './fanOutStore';
import { MicrophoneExplanation } from './MicrophoneExplanation';
import { ensureMicPermission } from './permissions';

const discSize = spacing.xxl + spacing.xl;
const sideOffset = spacing.xxl + spacing.md;
const rise = spacing.xxl * 2;

function haptic(style: Haptics.ImpactFeedbackStyle): void {
  void Haptics.impactAsync(style).catch(() =>
    console.warn('Haptic feedback is unavailable.'),
  );
}

export function FanOutOverlay() {
  const open = useFanOut();
  const [explanation, setExplanation] = useState<'denied' | 'error' | null>(
    null,
  );
  const onFailure = useCallback((reason: 'denied' | 'error') => {
    setExplanation(reason);
    closeFanOut();
  }, []);
  const onGranted = useCallback(() => setExplanation(null), []);

  if (open) return <FanOutMenu onFailure={onFailure} onGranted={onGranted} />;
  if (!explanation) return null;
  return (
    <MicrophoneExplanation
      reason={explanation}
      onClose={onGranted}
      onSettingsError={() => setExplanation('error')}
    />
  );
}

function FanOutMenu({
  onFailure,
  onGranted,
}: {
  onFailure: (reason: 'denied' | 'error') => void;
  onGranted: () => void;
}) {
  const { tape } = useTheme<TapeTheme>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [phase, dispatch] = useReducer(fanOutReducer, 'idle');
  const [allowed, setAllowed] = useState(false);
  const alive = useRef(true);
  const chosen = useRef<RecordingKind | null>(null);
  const navigated = useRef(false);
  const reveal = useSharedValue(0);
  const expansion = useSharedValue(1);
  const fade = useSharedValue(0);
  // Tab rows are 72 dp tall; the 64 dp Record disc leaves an 8 dp gap above safe-area padding.
  const anchorBottom = Math.max(insets.bottom, spacing.sm) + spacing.sm;
  const centerY = height - anchorBottom - spacing.xl - rise;

  const cancel = useCallback(() => {
    dispatch('reset');
    closeFanOut();
  }, []);

  useEffect(() => {
    let active = true;
    alive.current = true;
    void ensureMicPermission()
      .then((result) => {
        if (!active) return;
        if (result === 'denied') {
          onFailure('denied');
          return;
        }
        setAllowed(true);
        onGranted();
        haptic(Haptics.ImpactFeedbackStyle.Light);
        reveal.set(
          reducedMotion
            ? withTiming(1, {
                duration: motion.durations.fast,
                reduceMotion: ReduceMotion.Never,
              })
            : withSpring(1, motion.spring),
        );
      })
      .catch(() => {
        if (active) onFailure('error');
      });
    return () => {
      active = false;
      alive.current = false;
      cancelAnimation(reveal);
      cancelAnimation(expansion);
      cancelAnimation(fade);
    };
  }, [onFailure, onGranted, reducedMotion, reveal, expansion, fade]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (chosen.current === null) {
          cancel();
        }
        return true;
      },
    );
    return () => subscription.remove();
  }, [cancel]);

  const navigate = useCallback((kind: RecordingKind) => {
    if (!alive.current || chosen.current !== kind || navigated.current) return;
    navigated.current = true;
    router.push({ pathname: '/record', params: { kind } });
  }, []);

  useEffect(() => {
    if (phase === 'idle') return;
    const kind = phase.chosen;
    if (reducedMotion) {
      fade.set(
        withTiming(
          1,
          { duration: motion.durations.slow, reduceMotion: ReduceMotion.Never },
          (finished) => {
            if (finished) scheduleOnRN(navigate, kind);
          },
        ),
      );
    } else {
      const centerX =
        width / 2 + (kind === 'meeting' ? -sideOffset : sideOffset);
      // Scale past the farthest corner, including the portrait screen's top corners.
      const scale =
        (2 *
          Math.hypot(
            Math.max(centerX, width - centerX),
            Math.max(centerY, height - centerY),
          )) /
        discSize;
      expansion.set(
        withSpring(
          scale,
          { duration: motion.durations.slow, overshootClamping: true },
          (finished) => {
            if (finished) scheduleOnRN(navigate, kind);
          },
        ),
      );
    }
  }, [phase, width, height, centerY, reducedMotion, expansion, fade, navigate]);

  const meetingStyle = useAnimatedStyle(() => ({
    opacity: reveal.get(),
    transform: [
      { translateX: reducedMotion ? 0 : sideOffset * (1 - reveal.get()) },
      { translateY: reducedMotion ? 0 : rise * (1 - reveal.get()) },
    ],
  }));
  const noteStyle = useAnimatedStyle(() => ({
    opacity: reveal.get(),
    transform: [
      { translateX: reducedMotion ? 0 : -sideOffset * (1 - reveal.get()) },
      { translateY: reducedMotion ? 0 : rise * (1 - reveal.get()) },
    ],
  }));
  const coverStyle = useAnimatedStyle(() =>
    reducedMotion
      ? { opacity: fade.get() }
      : { transform: [{ scale: expansion.get() }] },
  );

  function choose(kind: RecordingKind) {
    if (!allowed || chosen.current !== null) return;
    chosen.current = kind;
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    dispatch({ choose: kind });
  }

  function discPosition(kind: RecordingKind) {
    return {
      left:
        width / 2 -
        discSize / 2 +
        (kind === 'meeting' ? -sideOffset : sideOffset),
      top: centerY - discSize / 2,
    };
  }

  function disc(kind: RecordingKind) {
    return (
      <Animated.View
        style={[
          styles.menuDisc,
          discPosition(kind),
          kind === 'meeting' ? meetingStyle : noteStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={kind === 'meeting' ? 'Meeting' : 'Note'}
          onPress={() => choose(kind)}
          android_ripple={{ color: tape.onSignal }}
          style={({ pressed }) => [
            styles.disc,
            {
              backgroundColor: tape.signal,
              transform: [{ scale: pressed ? motion.press.scale : 1 }],
            },
          ]}
        >
          <MaterialCommunityIcons
            name={
              kind === 'meeting' ? 'account-group-outline' : 'note-text-outline'
            }
            size={24}
            color={tape.onSignal}
            accessible={false}
          />
          <Text variant="labelLarge" style={{ color: tape.onSignal }}>
            {kind === 'meeting' ? 'Meeting' : 'Note'}
          </Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <View
      testID="fan-out-overlay"
      accessibilityViewIsModal
      style={StyleSheet.absoluteFill}
    >
      {phase === 'idle' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel recording menu"
          onPress={cancel}
          android_ripple={{ color: tape.line }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {allowed && phase === 'idle' && (
        <>
          {disc('meeting')}
          {disc('note')}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close recording menu"
            onPress={cancel}
            android_ripple={{ color: tape.onSignal }}
            style={[
              styles.closeDisc,
              {
                backgroundColor: tape.signal,
                left: width / 2 - spacing.xl,
                bottom: anchorBottom,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="close"
              size={28}
              color={tape.onSignal}
              accessible={false}
            />
          </Pressable>
        </>
      )}
      {phase !== 'idle' && (
        <Animated.View
          testID="fan-out-transition"
          pointerEvents="none"
          style={[
            reducedMotion
              ? StyleSheet.absoluteFill
              : [
                  styles.menuDisc,
                  discPosition(phase.chosen),
                  {
                    width: discSize,
                    height: discSize,
                    borderRadius: radius.round,
                  },
                ],
            { backgroundColor: tape.signal },
            coverStyle,
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  menuDisc: { position: 'absolute' },
  disc: {
    width: discSize,
    height: discSize,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    overflow: 'hidden',
  },
  closeDisc: {
    position: 'absolute',
    width: spacing.xl * 2,
    height: spacing.xl * 2,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
