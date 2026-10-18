import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Snackbar, useTheme } from 'react-native-paper';
import Animated, {
  FadeIn,
  FadeInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Schemas } from '../../src/api/client';
import { errorMessage } from '../../src/api/errorMessages';
import { NoteView } from '../../src/detail/NoteView';
import { ProcessingTimeline } from '../../src/detail/ProcessingTimeline';
import { RecordingHeader } from '../../src/detail/RecordingHeader';
import { SummaryView } from '../../src/detail/SummaryView';
import { TranscriptView } from '../../src/detail/TranscriptView';
import { groupTurns } from '../../src/detail/turns';
import { useRecording } from '../../src/detail/useRecording';
import { LibrarySkeleton } from '../../src/library/LibrarySkeleton';
import { activeSegmentIndex } from '../../src/player/activeSegment';
import { PlayerBar } from '../../src/player/PlayerBar';
import { usePlayer } from '../../src/player/usePlayer';
import { fontFamilies } from '../../src/theme/fonts';
import { motion } from '../../src/theme/motion';
import type { TapeTheme } from '../../src/theme/paperTheme';
import { radius, spacing, typeScale } from '../../src/theme/tokens';

export interface RecordingScreenProps {
  id?: string;
  segment?: string;
}

function isPrimaryEmpty(r: Schemas['RecordingDetailOut']): boolean {
  if (r.kind === 'meeting') {
    const s = r.summary;
    return (
      !s ||
      (!s.overview?.trim() &&
        !s.decisions?.length &&
        !s.action_items?.length &&
        !s.open_questions?.length)
    );
  }
  const n = r.note;
  return !n || (!n.key_points?.length && !n.clean_text?.trim());
}

export function RecordingScreen(props: RecordingScreenProps = {}) {
  const params = useLocalSearchParams<{ id?: string; segment?: string }>();
  const id = props.id ?? params.id ?? '';
  const initialSegment = props.segment ?? params.segment;

  const { tape } = useTheme<TapeTheme>();
  const reducedMotion = useReducedMotion();
  const {
    data: recording,
    isLoading,
    error,
    deleted,
    refetch,
  } = useRecording(id);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  const player = usePlayer(id, recording?.status === 'ready' && !deleted);
  const initialPlayed = useRef(false);
  const [isFollowing, setIsFollowing] = useState(true);

  const [activeTab, setActiveTab] = useState<'primary' | 'transcript'>(() =>
    initialSegment ? 'transcript' : 'primary',
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    () => initialSegment ?? null,
  );

  const segments = recording?.segments;
  const speakers = recording?.speakers;
  const turns = useMemo(
    () => (!segments ? [] : groupTurns(segments, speakers ?? [])),
    [segments, speakers],
  );

  const activeIdx = segments
    ? activeSegmentIndex(segments, player.positionMs)
    : -1;
  const playbackActiveSegmentId =
    activeIdx >= 0 && segments ? (segments[activeIdx]?.id ?? null) : null;

  const activeSegmentId = playbackActiveSegmentId ?? selectedSegmentId;

  const handleSelectSegment = (segmentId: string) => {
    setSelectedSegmentId(segmentId);
    setActiveTab('transcript');
    setIsFollowing(true);
    const seg = segments?.find((s) => s.id === segmentId);
    if (seg) {
      void player.playFrom(seg.start_ms);
    }
  };

  useEffect(() => {
    if (
      !initialPlayed.current &&
      initialSegment &&
      segments &&
      segments.length > 0
    ) {
      const seg = segments.find((s) => s.id === initialSegment);
      if (seg) {
        initialPlayed.current = true;
        void player.playFrom(seg.start_ms);
      }
    }
  }, [initialSegment, segments, player]);

  if (deleted) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
        <RecordingHeader title="" onBack={() => router.back()} />
        <View style={styles.centerContainer}>
          <MaterialCommunityIcons
            name="delete-outline"
            size={48}
            color={tape.inkMuted}
            accessible={false}
          />
          <Text
            style={[
              styles.centerText,
              { color: tape.inkMuted, fontFamily: fontFamilies.regular },
            ]}
          >
            This recording was deleted
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
        <RecordingHeader title="" onBack={() => router.back()} />
        <View style={styles.centerContainer}>
          <Text
            style={[
              styles.centerText,
              {
                color: tape.ink,
                fontFamily: fontFamilies.regular,
                marginBottom: spacing.md,
              },
            ]}
          >
            {errorMessage(error)}
          </Text>
          <Button
            mode="contained"
            onPress={() => refetch()}
            accessibilityLabel="Retry"
            buttonColor={tape.signal}
            textColor={tape.onSignal}
            style={{ borderRadius: radius.card, minHeight: 48 }}
          >
            Retry
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading || !recording) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
        <LibrarySkeleton />
      </SafeAreaView>
    );
  }

  const title = recording.title?.trim() || 'Untitled recording';

  if (recording.status !== 'ready') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
        <RecordingHeader
          title={title}
          recording={recording}
          onBack={() => router.back()}
          onShowSnackbar={setSnackbarMessage}
        />
        <ProcessingTimeline recording={recording} />
        <Snackbar
          visible={Boolean(snackbarMessage)}
          onDismiss={() => setSnackbarMessage(null)}
          duration={3000}
        >
          {snackbarMessage}
        </Snackbar>
      </SafeAreaView>
    );
  }

  const hasNoSegments = !recording.segments || recording.segments.length === 0;
  const primaryEmpty = isPrimaryEmpty(recording);
  const currentTab =
    activeTab === 'primary' && primaryEmpty ? 'transcript' : activeTab;
  const primaryTabLabel = recording.kind === 'meeting' ? 'Summary' : 'Note';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
      <Animated.View
        entering={
          reducedMotion ? FadeIn : FadeInDown.duration(motion.durations.base)
        }
        style={styles.content}
      >
        <RecordingHeader
          title={title}
          tags={recording.tags}
          recording={recording}
          onBack={() => router.back()}
          onShowSnackbar={setSnackbarMessage}
        />

        {hasNoSegments ? (
          <View style={styles.centerContainer}>
            <MaterialCommunityIcons
              name="microphone-off"
              size={48}
              color={tape.inkMuted}
              accessible={false}
            />
            <Text
              style={[
                styles.centerText,
                { color: tape.inkMuted, fontFamily: fontFamilies.regular },
              ]}
            >
              Nothing was said
            </Text>
          </View>
        ) : (
          <View style={styles.body}>
            {!primaryEmpty ? (
              <View
                style={[
                  styles.segmentedContainer,
                  { backgroundColor: tape.surface, borderColor: tape.line },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={primaryTabLabel}
                  onPress={() => setActiveTab('primary')}
                  android_ripple={{ color: tape.line }}
                  style={[
                    styles.segmentTab,
                    currentTab === 'primary' && {
                      backgroundColor: tape.raised,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      {
                        color:
                          currentTab === 'primary' ? tape.ink : tape.inkMuted,
                        fontFamily:
                          currentTab === 'primary'
                            ? fontFamilies.semibold
                            : fontFamilies.regular,
                      },
                    ]}
                  >
                    {primaryTabLabel}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Transcript"
                  onPress={() => setActiveTab('transcript')}
                  android_ripple={{ color: tape.line }}
                  style={[
                    styles.segmentTab,
                    currentTab === 'transcript' && {
                      backgroundColor: tape.raised,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      {
                        color:
                          currentTab === 'transcript'
                            ? tape.ink
                            : tape.inkMuted,
                        fontFamily:
                          currentTab === 'transcript'
                            ? fontFamilies.semibold
                            : fontFamilies.regular,
                      },
                    ]}
                  >
                    Transcript
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.tabContent}>
              {currentTab === 'primary' ? (
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.scrollContent}
                >
                  {recording.kind === 'meeting' && recording.summary ? (
                    <SummaryView
                      summary={recording.summary}
                      speakers={recording.speakers ?? []}
                      onSelectSegment={handleSelectSegment}
                    />
                  ) : null}
                  {recording.kind === 'note' && recording.note ? (
                    <NoteView
                      note={recording.note}
                      onSelectSegment={handleSelectSegment}
                    />
                  ) : null}
                </ScrollView>
              ) : (
                <TranscriptView
                  turns={turns}
                  activeSegmentId={activeSegmentId}
                  onSelectSegment={handleSelectSegment}
                  speakers={recording.speakers ?? []}
                  kind={recording.kind}
                  recordingId={recording.id}
                  onShowSnackbar={setSnackbarMessage}
                  onScrollBeginDrag={() => {
                    setIsFollowing(false);
                  }}
                  isFollowing={isFollowing}
                  onFollow={() => {
                    setIsFollowing(true);
                  }}
                />
              )}
            </View>
          </View>
        )}
      </Animated.View>
      {recording.status === 'ready' && !hasNoSegments ? (
        <PlayerBar player={player} peaks={recording.waveform_peaks} />
      ) : null}
      <Snackbar
        visible={Boolean(snackbarMessage)}
        onDismiss={() => setSnackbarMessage(null)}
        duration={3000}
      >
        {snackbarMessage}
      </Snackbar>
    </SafeAreaView>
  );
}

export default RecordingScreen;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  body: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.md },
  scrollContent: {
    paddingBottom: 96,
  },
  segmentedContainer: {
    flexDirection: 'row',
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
    height: 48,
  },
  segmentTab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: { fontSize: typeScale.body },
  tabContent: { flex: 1 },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  centerText: { fontSize: typeScale.body, textAlign: 'center' },
});
