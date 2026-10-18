import { StyleSheet } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';

export interface DiscardDialogProps {
  visible: boolean;
  theme: TapeTheme;
  onDismiss: () => void;
  onDiscard: () => void;
}

export function DiscardDialog({
  visible,
  theme,
  onDismiss,
  onDiscard,
}: DiscardDialogProps) {
  const { tape } = theme;
  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={onDismiss}
        style={{ backgroundColor: tape.surface }}
      >
        <Dialog.Title style={{ color: tape.ink }}>
          Discard recording?
        </Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium" style={{ color: tape.inkMuted }}>
            This recording will not be saved.
          </Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button
            textColor={tape.inkMuted}
            onPress={onDismiss}
            accessibilityLabel="Keep recording"
            style={styles.dialogButton}
          >
            Keep recording
          </Button>
          <Button
            textColor={tape.signal}
            onPress={onDiscard}
            accessibilityLabel="Discard"
            style={styles.dialogButton}
          >
            Discard
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialogButton: {
    minHeight: 48,
    justifyContent: 'center',
  },
});
