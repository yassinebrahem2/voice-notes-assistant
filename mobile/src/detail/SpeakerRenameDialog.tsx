import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { useRenameSpeaker } from './mutations';

export interface SpeakerRenameDialogProps {
  visible: boolean;
  speaker: Schemas['SpeakerOut'] | null;
  recordingId?: string;
  onDismiss: () => void;
  onSave?: (speakerId: string, name: string) => void;
  onShowSnackbar?: (message: string) => void;
}

export function SpeakerRenameDialog({
  visible,
  speaker,
  recordingId,
  onDismiss,
  onSave,
  onShowSnackbar,
}: SpeakerRenameDialogProps) {
  const { tape } = useTheme<TapeTheme>();
  const initialName = speaker?.name ?? speaker?.display_name ?? '';
  const [name, setName] = useState(initialName);
  const [prevSpeakerId, setPrevSpeakerId] = useState(speaker?.id);

  if (speaker && speaker.id !== prevSpeakerId) {
    setPrevSpeakerId(speaker.id);
    const nextName = speaker.name ?? speaker.display_name ?? '';
    setName(nextName);
  }

  const renameMutation = useRenameSpeaker(recordingId ?? '', {
    onNotify: onShowSnackbar,
  });

  const handleSave = (overrideName?: unknown) => {
    if (!speaker) return;
    const val = typeof overrideName === 'string' ? overrideName : name;
    const trimmed = val.trim();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onSave) {
      onSave(speaker.id, trimmed);
    } else if (recordingId) {
      renameMutation.mutate({ speakerId: speaker.id, name: trimmed });
    }
    onDismiss();
  };

  const handleClear = () => {
    setName('');
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: tape.bg, opacity: 0.95 }]}
        onPress={onDismiss}
        accessibilityRole="none"
        accessibilityLabel="Dismiss dialog backdrop"
      >
        <Pressable
          style={[
            styles.dialogContainer,
            { backgroundColor: tape.raised, borderColor: tape.line },
          ]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="none"
        >
          <Text
            style={[
              styles.title,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Rename speaker
          </Text>

          <View
            style={[
              styles.inputRow,
              { backgroundColor: tape.surface, borderColor: tape.line },
            ]}
          >
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Speaker name"
              placeholderTextColor={tape.inkMuted}
              accessibilityLabel="Speaker name input"
              onSubmitEditing={(e) => handleSave(e.nativeEvent.text)}
              style={[
                styles.textInput,
                { color: tape.ink, fontFamily: fontFamilies.regular },
              ]}
            />
            {name.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear speaker name"
                onPress={handleClear}
                android_ripple={{ color: tape.line, borderless: true }}
                style={styles.clearButton}
              >
                <Text
                  style={[
                    styles.clearText,
                    { color: tape.inkMuted, fontFamily: fontFamilies.regular },
                  ]}
                >
                  ✕
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={onDismiss}
              android_ripple={{ color: tape.line }}
              style={[styles.button, styles.cancelButton]}
            >
              <Text
                style={[
                  styles.buttonText,
                  { color: tape.inkMuted, fontFamily: fontFamilies.semibold },
                ]}
              >
                Cancel
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save speaker name"
              onPress={handleSave}
              android_ripple={{ color: tape.line }}
              style={[
                styles.button,
                styles.saveButton,
                { backgroundColor: tape.surface, borderColor: tape.line },
              ]}
            >
              <Text
                style={[
                  styles.buttonText,
                  { color: tape.ink, fontFamily: fontFamilies.semibold },
                ]}
              >
                Save
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  dialogContainer: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: typeScale.title,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  textInput: {
    flex: 1,
    fontSize: typeScale.body,
    paddingVertical: spacing.sm,
  },
  clearButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: {
    fontSize: typeScale.body,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  button: {
    minHeight: 48,
    minWidth: 80,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {},
  saveButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontSize: typeScale.body,
  },
});
