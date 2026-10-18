import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';
import { spacing } from '../theme/tokens';

export type RecorderErrorState =
  'start_failed' | 'recording_failed' | 'enqueue_failed' | 'offer_save';

export interface RecorderErrorViewProps {
  state: RecorderErrorState;
  theme: TapeTheme;
  onClose: () => void;
  onRetry: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

export function RecorderErrorView({
  state,
  theme,
  onClose,
  onRetry,
  onSave,
  onDiscard,
}: RecorderErrorViewProps) {
  const { tape } = theme;

  if (state === 'start_failed') {
    return (
      <View style={styles.errorContainer}>
        <Text
          variant="headlineSmall"
          style={[styles.errorTitle, { color: tape.ink }]}
        >
          {"Couldn't start recording"}
        </Text>
        <Button
          mode="contained"
          onPress={onClose}
          accessibilityLabel="Close"
          buttonColor={tape.signal}
          textColor={tape.onSignal}
          style={styles.actionButton}
        >
          Close
        </Button>
      </View>
    );
  }

  if (state === 'recording_failed') {
    return (
      <View style={styles.errorContainer}>
        <Text
          variant="headlineSmall"
          style={[styles.errorTitle, { color: tape.ink }]}
        >
          Recording failed
        </Text>
        <Button
          mode="contained"
          onPress={onClose}
          accessibilityLabel="Close"
          buttonColor={tape.signal}
          textColor={tape.onSignal}
          style={styles.actionButton}
        >
          Close
        </Button>
      </View>
    );
  }

  if (state === 'enqueue_failed') {
    return (
      <View style={styles.errorContainer}>
        <Text
          variant="headlineSmall"
          style={[styles.errorTitle, { color: tape.ink }]}
        >
          {"Couldn't save the recording"}
        </Text>
        <View style={styles.buttonRow}>
          <Button
            mode="outlined"
            onPress={onClose}
            accessibilityLabel="Close"
            textColor={tape.ink}
            style={[styles.actionButton, { borderColor: tape.outline }]}
          >
            Close
          </Button>
          <Button
            mode="contained"
            onPress={onRetry}
            accessibilityLabel="Retry"
            buttonColor={tape.signal}
            textColor={tape.onSignal}
            style={styles.actionButton}
          >
            Retry
          </Button>
        </View>
      </View>
    );
  }

  if (state === 'offer_save') {
    return (
      <View style={styles.errorContainer}>
        <Text
          variant="headlineSmall"
          style={[styles.errorTitle, { color: tape.ink }]}
        >
          Recorder stopped unexpectedly
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.errorDesc, { color: tape.inkMuted }]}
        >
          Audio is playable. Would you like to save it?
        </Text>
        <View style={styles.buttonRow}>
          <Button
            mode="outlined"
            onPress={onDiscard}
            accessibilityLabel="Discard recording"
            textColor={tape.ink}
            style={[styles.actionButton, { borderColor: tape.outline }]}
          >
            Discard
          </Button>
          <Button
            mode="contained"
            onPress={onSave}
            accessibilityLabel="Save recording"
            buttonColor={tape.signal}
            textColor={tape.onSignal}
            style={styles.actionButton}
          >
            Save
          </Button>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  errorTitle: {
    textAlign: 'center',
  },
  errorDesc: {
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  actionButton: {
    minHeight: 48,
    minWidth: 120,
    justifyContent: 'center',
  },
});
