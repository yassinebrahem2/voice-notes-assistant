import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { useDeleteRecording } from './mutations';

export interface HeaderMenuProps {
  recording: Schemas['RecordingDetailOut'];
  onShowSnackbar?: (message: string) => void;
  onDelete?: () => void;
}

export function HeaderMenu({
  recording,
  onShowSnackbar,
  onDelete,
}: HeaderMenuProps) {
  const { tape } = useTheme<TapeTheme>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = useDeleteRecording({
    onNotify: onShowSnackbar,
  });

  const isProcessing = Boolean(recording.processing);

  const handleOpenDeleteConfirm = () => {
    if (isProcessing) return;
    setMenuOpen(false);
    setConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfirmOpen(false);
    if (onDelete) {
      onDelete();
    } else {
      deleteMutation.mutate(recording.id);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More options"
        onPress={() => setMenuOpen(true)}
        android_ripple={{ color: tape.line, borderless: true }}
        style={styles.iconButton}
      >
        <MaterialCommunityIcons
          name="dots-vertical"
          size={24}
          color={tape.ink}
          accessible={false}
        />
      </Pressable>

      {/* Menu dropdown modal */}
      {menuOpen ? (
        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <Pressable
            style={[
              styles.modalBackdrop,
              { backgroundColor: tape.bg, opacity: 0.95 },
            ]}
            onPress={() => setMenuOpen(false)}
            accessibilityRole="none"
            accessibilityLabel="Dismiss menu"
          >
            <View
              style={[
                styles.menuCard,
                { backgroundColor: tape.raised, borderColor: tape.line },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isProcessing
                    ? 'Delete recording (Available when processing finishes)'
                    : 'Delete recording'
                }
                accessibilityState={{ disabled: isProcessing }}
                disabled={isProcessing}
                onPress={handleOpenDeleteConfirm}
                android_ripple={{ color: tape.line }}
                style={[
                  styles.menuItem,
                  isProcessing && styles.menuItemDisabled,
                ]}
              >
                <MaterialCommunityIcons
                  name="delete-outline"
                  size={20}
                  color={isProcessing ? tape.inkMuted : tape.signal}
                  accessible={false}
                />
                <View style={styles.menuItemTextContainer}>
                  <Text
                    style={[
                      styles.menuItemText,
                      {
                        color: isProcessing ? tape.inkMuted : tape.signal,
                        fontFamily: fontFamilies.semibold,
                      },
                    ]}
                  >
                    Delete
                  </Text>
                  {isProcessing ? (
                    <Text
                      style={[
                        styles.subText,
                        {
                          color: tape.inkMuted,
                          fontFamily: fontFamilies.regular,
                        },
                      ]}
                    >
                      Available when processing finishes
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      ) : null}

      {/* Confirm Delete Dialog */}
      {confirmOpen ? (
        <Modal
          visible={confirmOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirmOpen(false)}
        >
          <Pressable
            style={[
              styles.dialogBackdrop,
              { backgroundColor: tape.bg, opacity: 0.95 },
            ]}
            onPress={() => setConfirmOpen(false)}
            accessibilityRole="none"
            accessibilityLabel="Dismiss delete confirmation"
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
                  styles.dialogTitle,
                  { color: tape.ink, fontFamily: fontFamilies.semibold },
                ]}
              >
                Delete recording?
              </Text>

              <Text
                style={[
                  styles.dialogMessage,
                  { color: tape.inkMuted, fontFamily: fontFamilies.regular },
                ]}
              >
                This cannot be undone.
              </Text>

              <View style={styles.dialogActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel delete"
                  onPress={() => setConfirmOpen(false)}
                  android_ripple={{ color: tape.line }}
                  style={[styles.dialogButton, styles.cancelButton]}
                >
                  <Text
                    style={[
                      styles.dialogButtonText,
                      {
                        color: tape.inkMuted,
                        fontFamily: fontFamilies.semibold,
                      },
                    ]}
                  >
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm delete"
                  onPress={handleConfirmDelete}
                  android_ripple={{ color: tape.line }}
                  style={[
                    styles.dialogButton,
                    styles.deleteButton,
                    { backgroundColor: tape.surface, borderColor: tape.line },
                  ]}
                >
                  <Text
                    style={[
                      styles.dialogButtonText,
                      { color: tape.signal, fontFamily: fontFamilies.semibold },
                    ]}
                  >
                    Delete
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    paddingTop: 56,
    paddingRight: spacing.md,
    alignItems: 'flex-end',
  },
  menuCard: {
    minWidth: 200,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingVertical: spacing.xs,
    elevation: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  menuItemDisabled: {
    opacity: 0.6,
  },
  menuItemTextContainer: {
    flex: 1,
  },
  menuItemText: {
    fontSize: typeScale.body,
  },
  subText: {
    fontSize: typeScale.small,
  },
  dialogBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  dialogContainer: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  dialogTitle: {
    fontSize: typeScale.title,
  },
  dialogMessage: {
    fontSize: typeScale.body,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  dialogButton: {
    minHeight: 48,
    minWidth: 80,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {},
  deleteButton: {
    borderWidth: 1,
  },
  dialogButtonText: {
    fontSize: typeScale.body,
  },
});
