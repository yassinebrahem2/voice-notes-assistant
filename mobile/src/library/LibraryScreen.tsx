import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  FadeInDown,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';

import { ApiError, type Schemas } from '../api/client';
import type { PendingUpload } from '../recording/pending';
import { usePendingUploads } from '../recording/usePendingUploads';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { spacing } from '../theme/tokens';
import { getTabFilters, setTabFilters } from './filters';
import { LibraryEmptyState } from './LibraryEmptyState';
import { LibraryHeader } from './LibraryHeader';
import { LibrarySkeleton } from './LibrarySkeleton';
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

  const handleRetryUpload = useCallback(
    async (id: string) => {
      try {
        await retryUpload(id);
        void refetch();
      } catch {
        // retry errors handled/kept in pending queue
      }
    },
    [retryUpload, refetch],
  );

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

  const handleRetryQuery = useCallback(() => {
    void refetch();
  }, [refetch]);

  const renderEmptyState = useCallback(() => {
    if (listItems.length > 0 || isRecordingsLoading) {
      return null;
    }
    return (
      <LibraryEmptyState
        kind={kind}
        isNetworkError={isNetworkError}
        error={recordingsError}
        isFilterActive={isFilterActive}
        onClearFilters={handleClearFilters}
        onRetryQuery={handleRetryQuery}
      />
    );
  }, [
    listItems.length,
    isRecordingsLoading,
    kind,
    isNetworkError,
    recordingsError,
    isFilterActive,
    handleClearFilters,
    handleRetryQuery,
  ]);

  const renderItem = ({ item, index }: { item: ListItem; index: number }) => {
    const content =
      item.type === 'pending' ? (
        <PendingRow
          item={item.item}
          onRetry={handleRetryUpload}
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
      <LibraryHeader
        kind={kind}
        search={search}
        onSearchChange={setSearch}
        tags={tags}
        selectedTagIds={selectedTagIds}
        onToggleTag={toggleTag}
      />

      {isRecordingsLoading && listItems.length === 0 ? (
        <LibrarySkeleton />
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
  listContent: {
    padding: spacing.md,
    flexGrow: 1,
  },
});
