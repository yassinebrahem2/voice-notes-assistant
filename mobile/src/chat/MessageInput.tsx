import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';

export const INPUT_LINE_HEIGHT = 24;
export const INPUT_PADDING_V = 12;
export const INPUT_MIN_HEIGHT = 48; // 1 line + padding
export const INPUT_MAX_HEIGHT = 144; // 5 lines + padding

export function inputHeight(contentHeight: number): number {
  return Math.min(
    INPUT_MAX_HEIGHT,
    Math.max(INPUT_MIN_HEIGHT, Math.ceil(contentHeight)),
  );
}

export type MessageInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  canSend: boolean;
};

export function MessageInput({
  value,
  onChangeText,
  onSend,
  canSend,
}: MessageInputProps): React.JSX.Element {
  const { tape } = useTheme<TapeTheme>();
  const [prevValue, setPrevValue] = useState(value);
  const [height, setHeight] = useState(INPUT_MIN_HEIGHT);

  if (value !== prevValue) {
    setPrevValue(value);
    if (value === '') {
      setHeight(INPUT_MIN_HEIGHT);
    }
  }

  return (
    <View style={[styles.row, { borderTopColor: tape.line }]}>
      <TextInput
        accessibilityLabel="Message"
        placeholder="Ask about your recordings"
        placeholderTextColor={tape.inkMuted}
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={(e) =>
          setHeight(inputHeight(e.nativeEvent.contentSize.height))
        }
        multiline
        style={[
          styles.input,
          {
            height,
            borderColor: tape.line,
            color: tape.ink,
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={onSend}
        android_ripple={{ color: tape.onSignal }}
        style={[
          styles.send,
          { backgroundColor: canSend ? tape.signal : tape.raised },
        ]}
      >
        <MaterialCommunityIcons
          name="arrow-up"
          size={24}
          color={canSend ? tape.onSignal : tape.inkMuted}
          accessible={false}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: INPUT_PADDING_V,
    lineHeight: INPUT_LINE_HEIGHT,
    textAlignVertical: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    fontFamily: fontFamilies.regular,
    fontSize: typeScale.body,
  },
  send: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.round,
    overflow: 'hidden',
  },
});
