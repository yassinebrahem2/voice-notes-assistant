import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

export interface MessageBubbleProps {
  from: 'user' | 'assistant';
  children: React.ReactNode;
  accessibilityLabel?: string;
}

export function MessageBubble({
  from,
  children,
  accessibilityLabel,
}: MessageBubbleProps): React.JSX.Element {
  const { tape } = useTheme<TapeTheme>();
  const isUser = from === 'user';

  return (
    <View
      testID={isUser ? 'bubble-user' : 'bubble-assistant'}
      accessible={isUser ? true : false}
      accessibilityLabel={isUser ? accessibilityLabel : undefined}
      style={[
        styles.bubble,
        isUser
          ? [styles.user, { backgroundColor: tape.raised }]
          : [
              styles.assistant,
              {
                backgroundColor: tape.surface,
                borderColor: tape.line,
              },
            ],
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  assistant: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
