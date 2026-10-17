import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  FadeIn,
  FadeInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Schemas } from '../../src/api/client';
import { NoteView } from '../../src/detail/NoteView';
import { ProcessingTimeline } from '../../src/detail/ProcessingTimeline';
import { SummaryView } from '../../src/detail/SummaryView';
import { TranscriptView } from '../../src/detail/TranscriptView';
import { groupTurns } from '../../src/detail/turns';
import { useRecording } from '../../src/detail/useRecording';
import { fontFamilies } from '../../src/theme/fonts';
import { motion } from '../../src/theme/motion';
import type { TapeTheme } from '../../src/theme/paperTheme';
import { radius, spacing, typeScale } from '../../src/theme/tokens';

export interface RecordingScreenProps {
  id?: string;
  segment?: string;
}

function isAnalysisEmpty(r: Schemas['RecordingDetailOut']): boolean {
  if (!r.segments || r.segments.length === 0) return true;
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
  const { data: recording, isLoading, deleted } = useRecording(id);

  const [activeTab, setActiveTab] = useState<'primary' | 'transcript'>(() =>
    initialSegment ? 'transcript' : 'primary',
  );
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(
    () => initialSegment ?? null,
  );

  const segments = recording?.segments;
  const speakers = recording?.speakers;
  const turns = useMemo(() => {
    if (!segments) return [];
    return groupTurns(segments, speakers ?? []);
  }, [segments, speakers]);

  const handleSelectSegment = (segmentId: string) => {
    setActiveSegmentId(segmentId);
    setActiveTab('transcript');
  };

  const renderTopBar = (titleText?: string) => (
    <View style={styles.topBar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        android_ripple={{ color: tape.line, borderless: true }}
        style={styles.iconButton}
      >
        <MaterialCommunityIcons
          name="arrow-left"
          size={24}
          color={tape.ink}
          accessible={false}
        />
      </Pressable>
      {titleText ? (
        <Text
          numberOfLines={1}
          style={[
            styles.topBarTitle,
            { color: tape.ink, fontFamily: fontFamilies.semibold },
          ]}
        >
          {titleText}
        </Text>
      ) : null}
    </View>
  );

  if (deleted) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
        {renderTopBar()}
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

  if (isLoading || !recording) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
        <View style={styles.loadingContainer}>
          <View
            style={[
              styles.skeletonCard,
              { backgroundColor: tape.surface, borderColor: tape.line },
            ]}
          >
            <View
              style={[
                styles.skeletonLineLong,
                { backgroundColor: tape.raised },
              ]}
            />
            <View
              style={[
                styles.skeletonLineShort,
                { backgroundColor: tape.raised },
              ]}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const title = recording.title?.trim() || 'Untitled recording';

  if (recording.status !== 'ready') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
        {renderTopBar(title)}
        <ProcessingTimeline recording={recording} />
      </SafeAreaView>
    );
  }

  const empty = isAnalysisEmpty(recording);
  const primaryTabLabel = recording.kind === 'meeting' ? 'Summary' : 'Note';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: tape.bg }]}>
      <Animated.View
        entering={
          reducedMotion ? FadeIn : FadeInDown.duration(motion.durations.base)
        }
        style={styles.content}
      >
        <View style={styles.header}>
          {renderTopBar(title)}
          {recording.tags && recording.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {recording.tags.map((tag) => (
                <View
                  key={tag.id}
                  style={[
                    styles.tagChip,
                    { backgroundColor: tape.surface, borderColor: tape.line },
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      {
                        color: tape.inkMuted,
                        fontFamily: fontFamilies.regular,
                      },
                    ]}
                  >
                    {tag.name}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {empty ? (
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
                  activeTab === 'primary' && { backgroundColor: tape.raised },
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    {
                      color: activeTab === 'primary' ? tape.ink : tape.inkMuted,
                      fontFamily:
                        activeTab === 'primary'
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
                  activeTab === 'transcript' && {
                    backgroundColor: tape.raised,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    {
                      color:
                        activeTab === 'transcript' ? tape.ink : tape.inkMuted,
                      fontFamily:
                        activeTab === 'transcript'
                          ? fontFamilies.semibold
                          : fontFamilies.regular,
                    },
                  ]}
                >
                  Transcript
                </Text>
              </Pressable>
            </View>

            <View style={styles.tabContent}>
              {activeTab === 'primary' ? (
                <ScrollView showsVerticalScrollIndicator={false}>
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
                  onSelectSegment={setActiveSegmentId}
                  speakers={recording.speakers ?? []}
                  kind={recording.kind}
                />
              )}
            </View>
          </View>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

export default RecordingScreen;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  topBarTitle: { flex: 1, fontSize: typeScale.title },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tagChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.round,
    borderWidth: 1,
  },
  tagText: { fontSize: typeScale.small },
  body: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.md },
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
  loadingContainer: { padding: spacing.md },
  skeletonCard: {
    minHeight: 120,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  skeletonLineLong: { height: 20, borderRadius: 4, width: '70%' },
  skeletonLineShort: { height: 14, borderRadius: 4, width: '40%' },
});
