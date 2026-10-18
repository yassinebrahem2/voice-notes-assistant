import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import { RecordAction } from '../recording/RecordAction';
import { useServerStatusValue, type ServerStatus } from '../server/statusStore';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

type TabName = 'meetings' | 'notes' | 'chat' | 'settings';
const tabs: Record<
  TabName,
  { title: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }
> = {
  meetings: { title: 'Meetings', icon: 'account-group-outline' },
  notes: { title: 'Notes', icon: 'note-text-outline' },
  chat: { title: 'Chat', icon: 'chat-outline' },
  settings: { title: 'Settings', icon: 'cog-outline' },
};

// The dot on the Settings tab: none until the server has been tried. No address is as urgent as unreachable, since
// the banner asks for one too. The hint carries the same state in words so it is not colour-only.
function serverDot(
  status: ServerStatus,
  tape: TapeTheme['tape'],
): { color: string; hint: string } | null {
  switch (status) {
    case 'ok':
      return { color: tape.outline, hint: 'Server connected' };
    case 'unreachable':
      return { color: tape.signal, hint: 'Server unreachable' };
    case 'no_server':
      return { color: tape.signal, hint: 'No server address set' };
    case 'unknown':
      return null;
  }
}

// How far the Record disc rises above the visible bar. The root is this much taller than the bar so that the disc stays
// inside its parent: Android does not deliver touches to the part of a child drawn outside its parent's bounds.
const discOverhang = spacing.sm;

export type TabBarProps = Pick<
  BottomTabBarProps,
  'state' | 'emitter' | 'navigateToTab' | 'insets'
>;

export function TabBar({ state, emitter, navigateToTab, insets }: TabBarProps) {
  const { tape } = useTheme<TapeTheme>();
  const dot = serverDot(useServerStatusValue(), tape);

  function tab(name: TabName) {
    const route = state.routes.find((candidate) => candidate.name === name);
    if (!route) return null;
    const selected = state.routes[state.index]?.key === route.key;
    const color = selected ? tape.signal : tape.inkMuted;
    const statusDot = name === 'settings' ? dot : null;
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={tabs[name].title}
        accessibilityHint={statusDot?.hint}
        aria-selected={selected}
        onPress={() => {
          const event = emitter.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!selected && !event.defaultPrevented) navigateToTab(route.key);
        }}
        onLongPress={() =>
          emitter.emit({ type: 'tabLongPress', target: route.key })
        }
        android_ripple={{ color: tape.line }}
        style={({ pressed }) => [
          styles.tab,
          {
            backgroundColor: selected || pressed ? tape.raised : tape.surface,
            transform: [{ scale: pressed ? motion.press.scale : 1 }],
          },
        ]}
      >
        <View>
          <MaterialCommunityIcons
            name={tabs[name].icon}
            size={24}
            color={color}
            accessible={false}
          />
          {statusDot && (
            <View
              testID="server-status-dot"
              style={[styles.dot, { backgroundColor: statusDot.color }]}
            />
          )}
        </View>
        <Text variant="labelMedium" style={{ color }}>
          {tabs[name].title}
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      testID="tab-bar"
      style={[
        styles.root,
        {
          backgroundColor: tape.bg,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <View
        style={[
          styles.surface,
          { backgroundColor: tape.surface, borderTopColor: tape.line },
        ]}
      />
      {tab('meetings')}
      {tab('notes')}
      <View style={styles.record}>
        <RecordAction />
      </View>
      {tab('chat')}
      {tab('settings')}
    </View>
  );
}

const styles = StyleSheet.create({
  // The root is painted with the screen background colour (set inline from the theme), so the band above the visible
  // bar matches the screen: behind the tab bar is the navigator's own background, not the screen.
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  surface: {
    position: 'absolute',
    top: discOverhang,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    minWidth: 48,
    minHeight: 56,
    marginTop: discOverhang + spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  dot: {
    position: 'absolute',
    top: 0,
    right: -spacing.xs,
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radius.round,
  },
  record: {
    flex: 1,
    minWidth: 64,
    alignItems: 'center',
  },
});
