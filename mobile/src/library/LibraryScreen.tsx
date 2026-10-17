import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  FadeInDown,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';

import { ApiError, type Schemas } from '../api/client';
import { errorMessage } from '../api/errorMessages';
import { openFanOut } from '../recording/fanOutStore';
import type { PendingUpload } from '../recording/pending';
import { usePendingUploads } from '../recording/usePendingUploads';
import { fontFamilies } from '../theme/fonts';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { getTabFilters, setTabFilters } from './filters';
import { PendingRow } from './PendingRow';
import { RecordingRow } from './RecordingRow';
import { useRecordings } from './useRecordings';
import { useTags } from './useTags';

export interface LibraryScreenProps {
  kind: 'meeting' | 'note';
}

type ListItem =
  | { type: 'pending'; item: PendingUpload }
  | { type: 'recording'; item: Schemas['RecordingOut'] };

export function LibraryScreen({ kind }: LibraryScreenProps) {
  const { tape } = useTheme<TapeTheme>();
  const reducedMotion = useReducedMotion();
  const listRef = useRef<FlatList<ListItem>>(null);

  const initialFilters = useMemo(() => getTabFilters(kind), [kind]);
  const [search, setSearch] = useState(initialFilters.search);
  const [debouncedSearch, setDebouncedSearch] = useState(initialFilters.search);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    initialFilters.tagIds,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Keep in-memory filters updated
  useEffect(() => {
    setTabFilters(kind, { search, tagIds: selectedTagIds });
  }, [kind, search, selectedTagIds]);

  const {
    items: pendingItems,
    retry: retryUpload,
    remove: removePending,
  } = usePendingUploads();

  const filteredPending = useMemo(
    () => pendingItems.filter((item) => item.kind === kind),
    [pendingItems, kind],
  );

  const {
    data: recordingsData,
    isLoading: isRecordingsLoading,
    error: recordingsError,
    refetch,
  } = useRecordings({
    kind,
    q: debouncedSearch,
    tagIds: selectedTagIds,
  });

  const { data: tagsData } = useTags();

  const recordings = useMemo(() => recordingsData ?? [], [recordingsData]);

  const tags = useMemo(() => tagsData ?? [], [tagsData]);

  const isFilterActive = search.trim().length > 0 || selectedTagIds.length > 0;

  const isNetworkError =
    recordingsError instanceof ApiError &&
    (recordingsError.code === 'network_error' ||
      recordingsError.message.toLowerCase().includes('server url'));

  const listItems = useMemo<ListItem[]>(() => {
    const pendingList: ListItem[] = filteredPending.map((item) => ({
      type: 'pending',
      item,
    }));
    const recordingList: ListItem[] = recordings.map((item) => ({
      type: 'recording',
      item,
    }));
    return [...pendingList, ...recordingList];
  }, [filteredPending, recordings]);

  // Restore scroll offset after mount
  useEffect(() => {
    if (initialFilters.scrollOffset > 0 && listRef.current) {
      const t = setTimeout(() => {
        listRef.current?.scrollToOffset({
          offset: initialFilters.scrollOffset,
          animated: false,
        });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [initialFilters.scrollOffset]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      setTabFilters(kind, { scrollOffset: offset });
    },
    [kind],
  );

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setSelectedTagIds([]);
    setTabFilters(kind, { search: '', tagIds: [] });
  }, [kind]);

  const renderEmptyState = () => {
    if (isNetworkError) {
      return (
        <View style={styles.centerContainer}>
          <MaterialCommunityIcons
            name="server-network-off"
            size={48}
            color={tape.inkMuted}
            style={styles.emptyIcon}
          />
          <Text
            style={[
              styles.emptyTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            {recordingsError?.message || 'Set a server URL in Settings.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
            onPress={() => router.push('/settings')}
            android_ripple={{ color: tape.onSignal, borderless: false }}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: tape.signal,
                transform: [{ scale: pressed ? motion.press.scale : 1 }],
              },
            ]}
          >
            <Text
              style={[
                styles.primaryButtonText,
                { color: tape.onSignal, fontFamily: fontFamilies.semibold },
              ]}
            >
              Open Settings
            </Text>
          </Pressable>
        </View>
      );
    }

    if (recordingsError) {
      return (
        <View style={styles.centerContainer}>
          <Text
            style={[
              styles.emptyTitle,
              { color: tape.signal, fontFamily: fontFamilies.semibold },
            ]}
          >
            {errorMessage(recordingsError)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={() => void refetch()}
            android_ripple={{ color: tape.line, borderless: false }}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                backgroundColor: tape.raised,
                borderColor: tape.line,
                transform: [{ scale: pressed ? motion.press.scale : 1 }],
              },
            ]}
          >
            <Text
              style={[
                styles.secondaryButtonText,
                { color: tape.ink, fontFamily: fontFamilies.semibold },
              ]}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      );
    }

    if (isFilterActive && listItems.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <MaterialCommunityIcons
            name="magnify-close"
            size={48}
            color={tape.inkMuted}
            style={styles.emptyIcon}
          />
          <Text
            style={[
              styles.emptyTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            No matching recordings
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear filters"
            onPress={handleClearFilters}
            android_ripple={{ color: tape.line, borderless: false }}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                backgroundColor: tape.raised,
                borderColor: tape.line,
                transform: [{ scale: pressed ? motion.press.scale : 1 }],
              },
            ]}
          >
            <Text
              style={[
                styles.secondaryButtonText,
                { color: tape.ink, fontFamily: fontFamilies.semibold },
              ]}
            >
              Clear filters
            </Text>
          </Pressable>
        </View>
      );
    }

    if (listItems.length === 0 && !isRecordingsLoading) {
      const emptyActionTitle =
        kind === 'meeting'
          ? 'Record your first meeting'
          : 'Record your first note';
      return (
        <View style={styles.centerContainer}>
          <MaterialCommunityIcons
            name="microphone-outline"
            size={48}
            color={tape.inkMuted}
            style={styles.emptyIcon}
          />
          <Text
            style={[
              styles.emptyTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            {emptyActionTitle}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Record"
            onPress={openFanOut}
            android_ripple={{ color: tape.onSignal, borderless: false }}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: tape.signal,
                transform: [{ scale: pressed ? motion.press.scale : 1 }],
              },
            ]}
          >
            <Text
              style={[
                styles.primaryButtonText,
                { color: tape.onSignal, fontFamily: fontFamilies.semibold },
              ]}
            >
              Record
            </Text>
          </Pressable>
        </View>
      );
    }

    return null;
  };

  const renderSkeletons = () => (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((key) => (
        <View
          key={key}
          style={[
            styles.skeletonCard,
            { backgroundColor: tape.surface, borderColor: tape.line },
          ]}
        >
          <View
            style={[styles.skeletonLineLong, { backgroundColor: tape.raised }]}
          />
          <View
            style={[styles.skeletonLineShort, { backgroundColor: tape.raised }]}
          />
        </View>
      ))}
    </View>
  );

  const renderItem = ({ item, index }: { item: ListItem; index: number }) => {
    const content =
      item.type === 'pending' ? (
        <PendingRow
          item={item.item}
          onRetry={retryUpload}
          onDelete={removePending}
        />
      ) : (
        <RecordingRow recording={item.item} />
      );

    if (reducedMotion) {
      return content;
    }

    return (
      <Animated.View
        entering={FadeInDown.delay(index * motion.staggerMs).duration(
          motion.durations.base,
        )}
        layout={LinearTransition.duration(motion.durations.base)}
      >
        {content}
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: tape.bg }]}>
      {/* Header with Search and Tags */}
      <View style={styles.header}>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: tape.surface,
              borderColor: tape.line,
            },
          ]}
        >
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={tape.inkMuted}
            accessible={false}
          />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={
              kind === 'meeting' ? 'Search meetings…' : 'Search notes…'
            }
            placeholderTextColor={tape.inkMuted}
            style={[
              styles.searchInput,
              {
                color: tape.ink,
                fontFamily: fontFamilies.regular,
              },
            ]}
            accessibilityRole="search"
            accessibilityLabel={
              kind === 'meeting' ? 'Search meetings' : 'Search notes'
            }
          />
          {search.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search text"
              onPress={() => setSearch('')}
              hitSlop={8}
              style={styles.clearSearchButton}
            >
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={tape.inkMuted}
                accessible={false}
              />
            </Pressable>
          ) : null}
        </View>

        {/* Tag suggestions before typing or active filters */}
        {tags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagScrollContent}
            style={styles.tagScrollView}
          >
            {tags.map((tag) => {
              const isSelected = selectedTagIds.includes(tag.id);
              return (
                <Pressable
                  key={tag.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter by ${tag.name}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => toggleTag(tag.id)}
                  android_ripple={{ color: tape.line, borderless: false }}
                  style={({ pressed }) => [
                    styles.tagChip,
                    {
                      backgroundColor: isSelected ? tape.signal : tape.surface,
                      borderColor: isSelected ? tape.signal : tape.line,
                      transform: [{ scale: pressed ? motion.press.scale : 1 }],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tagChipText,
                      {
                        color: isSelected ? tape.onSignal : tape.ink,
                        fontFamily: isSelected
                          ? fontFamilies.semibold
                          : fontFamilies.regular,
                      },
                    ]}
                  >
                    {tag.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {/* Content */}
      {isRecordingsLoading && listItems.length === 0 ? (
        renderSkeletons()
      ) : (
        <FlatList
          ref={listRef}
          data={listItems}
          keyExtractor={(item) =>
            item.type === 'pending'
              ? `pending-${item.item.clientUploadId}`
              : `rec-${item.item.id}`
          }
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          ListEmptyComponent={renderEmptyState}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typeScale.body,
    paddingVertical: 0,
  },
  clearSearchButton: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagScrollView: {
    marginTop: spacing.xs,
  },
  tagScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  tagChip: {
    minHeight: 48,
    borderRadius: radius.round,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagChipText: {
    fontSize: typeScale.small,
  },
  listContent: {
    padding: spacing.md,
    flexGrow: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: typeScale.body,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.card,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: typeScale.body,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: typeScale.body,
  },
  skeletonContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  skeletonCard: {
    minHeight: 80,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  skeletonLineLong: {
    height: 16,
    borderRadius: 4,
    width: '75%',
  },
  skeletonLineShort: {
    height: 12,
    borderRadius: 4,
    width: '40%',
  },
});
