import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openFanOut } from '../recording/fanOutStore';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { useReduceMotion } from '../theme/useReduceMotion';
import { AnswerText } from './AnswerText';
import { ScopeBar } from './ScopeBar';
import { isActive, type RunView } from './runMachine';
import { Starters } from './Starters';
import { StatusLine } from './StatusLine';
import { useHasReadyRecording, useTags } from './useChatData';
import { useChatSession } from './useChatSession';

export const NO_RECORDING =
  'Chat answers from your recordings. Record something first.';

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  const { tape } = useTheme<TapeTheme>();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{ color: tape.line }}
      style={[styles.pill, { borderColor: tape.outline }]}
    >
      <Text variant="labelMedium">{label}</Text>
    </Pressable>
  );
}

function TurnResult({ run, onRetry }: { run: RunView; onRetry: () => void }) {
  if (isActive(run)) return <StatusLine steps={run.steps} />;
  if (run.phase === 'done') {
    // A done run is final, so Retry would only resume polling it.
    return run.message ? (
      <AnswerText message={run.message} />
    ) : (
      <Text variant="bodyMedium">No answer came back</Text>
    );
  }
  const text =
    run.phase === 'interrupted'
      ? 'Interrupted'
      : run.phase === 'too_slow'
        ? 'Taking too long'
        : (run.error ?? 'Something went wrong.');
  return (
    <View style={styles.failure}>
      <Text variant="bodyMedium">{text}</Text>
      <Pill label="Retry" onPress={onRetry} />
    </View>
  );
}

export function ChatScreen() {
  const { tape } = useTheme<TapeTheme>();
  const chat = useChatSession();
  const tags = useTags();
  const hasReady = useHasReadyRecording();
  const [draft, setDraft] = useState('');
  const reduceMotion = useReduceMotion();
  const scroll = useRef<ScrollViewInstance>(null);
  const screen = useRef<ComponentRef<typeof View>>(null);
  const [screenBottom, setScreenBottom] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(
    () => Keyboard.metrics()?.screenY ?? null,
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardTop(event.endCoordinates.screenY);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardTop(null);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Parent-local layout coordinates omit the safe area and server banner.
  // Measure the full screen in the keyboard's window coordinates; unlike a
  // cached initial height this also handles Android resizing the app window.
  const keyboardOverlap =
    Platform.OS === 'android' && keyboardTop !== null
      ? Math.max(0, screenBottom - keyboardTop)
      : 0;

  const running = chat.turns.some((turn) => isActive(turn.run));
  const canSend = !running && draft.trim() !== '';
  const send = () => {
    if (!canSend) return;
    void chat.ask(draft);
    setDraft('');
  };

  return (
    <SafeAreaView
      ref={screen}
      edges={['top', 'left', 'right']}
      onLayout={() => {
        if (Platform.OS === 'android') {
          screen.current?.measureInWindow((_x, y, _width, height) => {
            setScreenBottom(y + height);
          });
        }
      }}
      style={[
        styles.screen,
        { backgroundColor: tape.bg, paddingBottom: keyboardOverlap },
      ]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" variant="headlineLarge">
            Chat
          </Text>
          <Pill label="New chat" onPress={chat.newChat} />
        </View>
        <View style={styles.scope}>
          <ScopeBar
            scope={chat.scope}
            onScope={chat.setScope}
            tags={tags.data ?? []}
            tagIds={chat.tagIds}
            onTagIds={chat.setTagIds}
          />
        </View>
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.turns}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            scroll.current?.scrollToEnd({ animated: reduceMotion === false })
          }
        >
          {chat.turns.length === 0 && hasReady === false && (
            <View style={styles.empty}>
              <Text variant="bodyMedium">{NO_RECORDING}</Text>
              <Pill label="Record" onPress={openFanOut} />
            </View>
          )}
          {chat.turns.length === 0 && hasReady === true && (
            <Starters onPick={(question) => void chat.ask(question)} />
          )}
          {chat.turns.map((turn, index) => (
            <View key={index} style={styles.turn}>
              <Text variant="titleMedium">{turn.question}</Text>
              <TurnResult
                run={turn.run}
                onRetry={() => void chat.retry(index)}
              />
            </View>
          ))}
        </ScrollView>
        <View style={[styles.inputRow, { borderTopColor: tape.line }]}>
          <TextInput
            accessibilityLabel="Message"
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask about your recordings"
            placeholderTextColor={tape.inkMuted}
            multiline
            style={[styles.input, { color: tape.ink, borderColor: tape.line }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  scope: { padding: spacing.md },
  turns: { padding: spacing.md, gap: spacing.lg },
  turn: { gap: spacing.sm },
  empty: { gap: spacing.md, alignItems: 'flex-start' },
  failure: { gap: spacing.sm, alignItems: 'flex-start' },
  pill: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
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
