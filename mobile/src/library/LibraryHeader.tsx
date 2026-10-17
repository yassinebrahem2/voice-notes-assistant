import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';

export interface LibraryHeaderProps {
  kind: 'meeting' | 'note';
  search: string;
  onSearchChange: (text: string) => void;
  tags: Schemas['TagOut'][];
  selectedTagIds: string[];
  onToggleTag: (tagId: string) => void;
}

export function LibraryHeader({
  kind,
  search,
  onSearchChange,
  tags,
  selectedTagIds,
  onToggleTag,
}: LibraryHeaderProps) {
  const { tape } = useTheme<TapeTheme>();

  return (
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
          onChangeText={onSearchChange}
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
            onPress={() => onSearchChange('')}
            android_ripple={{ color: tape.line, borderless: true }}
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
                onPress={() => onToggleTag(tag.id)}
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
  );
}

const styles = StyleSheet.create({
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
    minWidth: 48,
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
});
