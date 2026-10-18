import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { HeaderMenu } from './HeaderMenu';
import { useUpdateRecording } from './mutations';

export interface RecordingHeaderProps {
  title: string;
  onBack: () => void;
  recording?: Schemas['RecordingDetailOut'];
  tags?: Schemas['TagOut'][];
  onShowSnackbar?: (message: string) => void;
  onUpdateTitle?: (title: string) => void;
  onUpdateTags?: (tags: string[]) => void;
}

export function RecordingHeader({
  title,
  tags,
  recording,
  onBack,
  onShowSnackbar,
  onUpdateTitle,
  onUpdateTags,
}: RecordingHeaderProps) {
  const { tape } = useTheme<TapeTheme>();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const [prevTitle, setPrevTitle] = useState(title);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  if (title !== prevTitle) {
    setPrevTitle(title);
    setEditedTitle(title);
  }

  const updateMutation = useUpdateRecording(recording?.id ?? '', {
    onNotify: onShowSnackbar,
  });

  const isReady = recording?.status === 'ready';

  const handleSaveTitle = (overrideTitle?: unknown) => {
    const val = typeof overrideTitle === 'string' ? overrideTitle : editedTitle;
    const trimmed = val.trim();
    if (trimmed && trimmed !== title) {
      if (onUpdateTitle) {
        onUpdateTitle(trimmed);
      } else if (recording) {
        updateMutation.mutate({ title: trimmed });
      }
    }
    setIsEditingTitle(false);
  };

  const handleRemoveTag = (tagName: string) => {
    const currentTags = (tags ?? []).map((t) => t.name);
    const updated = currentTags.filter((t) => t !== tagName);
    if (onUpdateTags) {
      onUpdateTags(updated);
    } else if (recording) {
      updateMutation.mutate({ tags: updated });
    }
  };

  const handleAddTag = () => {
    const trimmed = newTagName.trim();
    if (trimmed) {
      const currentTags = (tags ?? []).map((t) => t.name);
      if (!currentTags.includes(trimmed)) {
        const updated = [...currentTags, trimmed];
        if (onUpdateTags) {
          onUpdateTags(updated);
        } else if (recording) {
          updateMutation.mutate({ tags: updated });
        }
      }
    }
    setNewTagName('');
    setIsAddingTag(false);
  };

  return (
    <View style={styles.header}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
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

        {isEditingTitle ? (
          <View style={styles.titleEditRow}>
            <TextInput
              value={editedTitle}
              onChangeText={setEditedTitle}
              onSubmitEditing={(e) => handleSaveTitle(e.nativeEvent.text)}
              accessibilityLabel="Recording title input"
              style={[
                styles.titleInput,
                {
                  color: tape.ink,
                  borderColor: tape.line,
                  backgroundColor: tape.surface,
                  fontFamily: fontFamilies.semibold,
                },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save title"
              onPress={handleSaveTitle}
              android_ripple={{ color: tape.line, borderless: true }}
              style={styles.iconButton}
            >
              <MaterialCommunityIcons
                name="check"
                size={22}
                color={tape.ink}
                accessible={false}
              />
            </Pressable>
          </View>
        ) : isReady ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit title"
            onPress={() => setIsEditingTitle(true)}
            android_ripple={{ color: tape.line }}
            style={styles.titlePressable}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.topBarTitle,
                { color: tape.ink, fontFamily: fontFamilies.semibold },
              ]}
            >
              {title}
            </Text>
            <MaterialCommunityIcons
              name="pencil-outline"
              size={18}
              color={tape.inkMuted}
              accessible={false}
            />
          </Pressable>
        ) : (
          <Text
            numberOfLines={1}
            style={[
              styles.topBarTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            {title}
          </Text>
        )}

        {recording ? (
          <HeaderMenu recording={recording} onShowSnackbar={onShowSnackbar} />
        ) : null}
      </View>

      {(tags && tags.length > 0) || (isReady && recording) ? (
        <View style={styles.tagsRow}>
          {tags?.map((tag) => (
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
                  { color: tape.inkMuted, fontFamily: fontFamilies.regular },
                ]}
              >
                {tag.name}
              </Text>
              {isReady ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove tag ${tag.name}`}
                  onPress={() => handleRemoveTag(tag.name)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  android_ripple={{ color: tape.line, borderless: true }}
                  style={styles.tagActionIcon}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={14}
                    color={tape.inkMuted}
                    accessible={false}
                  />
                </Pressable>
              ) : null}
            </View>
          ))}

          {isReady && isAddingTag ? (
            <View
              style={[
                styles.addTagInputContainer,
                { backgroundColor: tape.surface, borderColor: tape.line },
              ]}
            >
              <TextInput
                value={newTagName}
                onChangeText={setNewTagName}
                onSubmitEditing={handleAddTag}
                autoFocus
                placeholder="Tag name"
                placeholderTextColor={tape.inkMuted}
                accessibilityLabel="New tag input"
                style={[
                  styles.addTagInput,
                  { color: tape.ink, fontFamily: fontFamilies.regular },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save tag"
                onPress={handleAddTag}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                android_ripple={{ color: tape.line, borderless: true }}
                style={styles.tagActionIcon}
              >
                <MaterialCommunityIcons
                  name="check"
                  size={14}
                  color={tape.ink}
                  accessible={false}
                />
              </Pressable>
            </View>
          ) : isReady && recording ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add tag"
              onPress={() => setIsAddingTag(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              android_ripple={{ color: tape.line }}
              style={[
                styles.tagChip,
                styles.addTagChip,
                { borderColor: tape.line },
              ]}
            >
              <MaterialCommunityIcons
                name="plus"
                size={14}
                color={tape.inkMuted}
                accessible={false}
              />
              <Text
                style={[
                  styles.tagText,
                  { color: tape.inkMuted, fontFamily: fontFamilies.regular },
                ]}
              >
                Add tag
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  topBarTitle: {
    flex: 1,
    fontSize: typeScale.title,
  },
  titlePressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 48,
  },
  titleEditRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  titleInput: {
    flex: 1,
    fontSize: typeScale.body,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.card,
    borderWidth: 1,
    minHeight: 48,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 32,
    borderRadius: radius.round,
    borderWidth: 1,
  },
  addTagChip: {
    borderStyle: 'dashed',
  },
  addTagInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    height: 32,
    borderRadius: radius.round,
    borderWidth: 1,
  },
  addTagInput: {
    fontSize: typeScale.small,
    paddingVertical: 0,
    minWidth: 60,
  },
  tagText: {
    fontSize: typeScale.small,
  },
  tagActionIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
