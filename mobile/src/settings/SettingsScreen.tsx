import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiFetch } from '../api/client';
import { errorMessage } from '../api/errorMessages';
import { appInfo } from '../config/appInfo';
import { useServerStatusValue } from '../server/statusStore';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { normalizeServerUrl, useServerUrl } from './serverUrl';
import { isHealth, testConnection, type HealthOut } from './testConnection';
import { useThemePreference, type ThemePreference } from './themePreference';

export const CONNECTION_TEXT = {
  connected: 'Connected',
  not_https: 'Not HTTPS',
  unreachable: "Can't reach the server",
  not_this_server: "That isn't this app's server",
} as const;

const roleLabels = [
  ['llm', 'Chat AI'],
  ['llm_analysis', 'Summary AI'],
  ['embedder', 'Search'],
  ['asr', 'Speech'],
  ['diarizer', 'Speakers'],
] as const;

interface ReadinessRow {
  key: string;
  label: string;
  value: string;
}

// Values are shown as the server wrote them ("ready", "Missing GROQ_API_KEY"); only the speech row adds the backend.
export function readinessRows(health: HealthOut): ReadinessRow[] {
  const rows: ReadinessRow[] = [];
  for (const [key, label] of roleLabels) {
    const status = health.roles[key];
    if (status === undefined) continue;
    const value =
      key === 'asr' && status === 'ready' && health.speech_backend === 'fake'
        ? 'fake (dev)'
        : status;
    rows.push({ key, label, value });
  }
  return rows;
}

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function ActionButton({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { tape } = useTheme<TapeTheme>();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: primary ? tape.onSignal : tape.line }}
      style={[
        styles.button,
        primary
          ? { backgroundColor: tape.signal }
          : {
              borderColor: tape.outline,
              borderWidth: StyleSheet.hairlineWidth,
            },
        disabled === true && styles.disabled,
      ]}
    >
      <Text
        variant="labelLarge"
        style={{ color: primary ? tape.onSignal : tape.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ThemeChoice() {
  const { tape } = useTheme<TapeTheme>();
  const { preference, setPreference } = useThemePreference();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Theme"
      style={[styles.segments, { borderColor: tape.outline }]}
    >
      {themeOptions.map(({ value, label }) => {
        const selected = preference === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected }}
            onPress={() => void setPreference(value)}
            android_ripple={{ color: tape.line }}
            style={[
              styles.segment,
              selected && { backgroundColor: tape.raised },
            ]}
          >
            <Text
              variant="labelLarge"
              style={{ color: selected ? tape.ink : tape.inkMuted }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Readiness({ url }: { url: string | null }) {
  const { tape } = useTheme<TapeTheme>();
  const health = useQuery({
    queryKey: ['health', url],
    // apiFetch only casts the body; a wrong server can answer 200 with anything, or with another app's health, and
    // null marks that, as Test connection does.
    queryFn: async (): Promise<HealthOut | null> => {
      const body = await apiFetch<unknown>('health');
      return isHealth(body) && body.app_name === appInfo.name ? body : null;
    },
    enabled: url !== null,
    retry: false,
  });
  // The tab stays mounted, so an error from an outage would outlive it. Only the move to ok counts: apiFetch also
  // reports ok just before throwing an HTTP error, and refetching then would only repeat that error.
  const serverStatus = useServerStatusValue();
  const previousStatus = useRef(serverStatus);
  const { isError, refetch } = health;
  useEffect(() => {
    const recovered = serverStatus === 'ok' && previousStatus.current !== 'ok';
    previousStatus.current = serverStatus;
    if (recovered && isError) void refetch();
  }, [serverStatus, isError, refetch]);
  if (url === null)
    return (
      <Text style={{ color: tape.inkMuted }}>Set a server URL first.</Text>
    );
  if (health.isError)
    return (
      <Text style={{ color: tape.inkMuted }}>{errorMessage(health.error)}</Text>
    );
  if (health.data === null)
    return (
      <Text style={{ color: tape.inkMuted }}>
        {CONNECTION_TEXT.not_this_server}
      </Text>
    );
  if (!health.data)
    return <Text style={{ color: tape.inkMuted }}>Checking…</Text>;
  return (
    <View>
      {readinessRows(health.data).map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${row.label}: ${row.value}`}
          style={[styles.row, { borderColor: tape.line }]}
        >
          <Text variant="bodyLarge">{row.label}</Text>
          <Text style={{ color: tape.inkMuted }}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function SettingsScreen() {
  const { tape } = useTheme<TapeTheme>();
  const server = useServerUrl();
  // null until the person types, so the stored URL shows without copying it into state.
  const [typed, setTyped] = useState<string | null>(null);
  const draft = typed ?? server.url ?? '';
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped whenever the draft changes, so a test started for an older URL cannot report on the new one.
  const edits = useRef(0);

  function onChange(text: string) {
    edits.current += 1;
    setTyped(text);
    setNote(null);
  }

  async function save() {
    edits.current += 1;
    try {
      const { url } = normalizeServerUrl(draft);
      await server.setUrl(url);
      setTyped(url);
      setNote('Saved');
    } catch (error: unknown) {
      setNote(message(error));
    }
  }

  async function test() {
    const started = edits.current;
    setBusy(true);
    setNote(null);
    try {
      const result = await testConnection(draft);
      if (started !== edits.current) return;
      setNote(
        result.ok ? CONNECTION_TEXT.connected : CONNECTION_TEXT[result.problem],
      );
    } catch (error: unknown) {
      if (started !== edits.current) return;
      // An unparseable URL is a typing error, not a connection problem.
      setNote(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: tape.bg }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.screen}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Text accessibilityRole="header" variant="headlineLarge">
            Settings
          </Text>

          <View style={styles.section}>
            <Text accessibilityRole="header" variant="titleMedium">
              Server
            </Text>
            <TextInput
              accessibilityLabel="Server URL"
              value={draft}
              onChangeText={onChange}
              placeholder="https://your-laptop.tailnet.ts.net"
              placeholderTextColor={tape.inkMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.input,
                { borderColor: tape.outline, color: tape.ink },
              ]}
            />
            <View style={styles.actions}>
              <ActionButton label="Save" primary onPress={() => void save()} />
              <ActionButton
                label="Test connection"
                disabled={busy}
                onPress={() => void test()}
              />
            </View>
            <View accessibilityLiveRegion="polite">
              {note !== null && <Text>{note}</Text>}
            </View>
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" variant="titleMedium">
              Theme
            </Text>
            <ThemeChoice />
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" variant="titleMedium">
              Readiness
            </Text>
            <Readiness url={server.url} />
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" variant="titleMedium">
              About
            </Text>
            <Text>{appInfo.name}</Text>
            <Text
              style={{ color: tape.inkMuted, fontFamily: fontFamilies.mono }}
            >
              Version {appInfo.version}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.lg },
  section: { gap: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamilies.regular,
    fontSize: typeScale.body,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  button: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  segments: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
