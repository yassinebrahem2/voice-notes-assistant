import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, typeScale } from '../theme/tokens';

export interface SegmentTabsProps {
  primaryLabel: string;
  activeTab: 'primary' | 'transcript';
  onSelectTab: (tab: 'primary' | 'transcript') => void;
}

export function SegmentTabs({
  primaryLabel,
  activeTab,
  onSelectTab,
}: SegmentTabsProps) {
  const { tape } = useTheme<TapeTheme>();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: tape.surface, borderColor: tape.line },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        onPress={() => onSelectTab('primary')}
        android_ripple={{ color: tape.line }}
        style={[
          styles.tab,
          activeTab === 'primary' && { backgroundColor: tape.raised },
        ]}
      >
        <Text
          style={[
            styles.tabText,
            {
              color: activeTab === 'primary' ? tape.ink : tape.inkMuted,
              fontFamily:
                activeTab === 'primary'
                  ? fontFamilies.semibold
                  : fontFamilies.regular,
            },
          ]}
        >
          {primaryLabel}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Transcript"
        onPress={() => onSelectTab('transcript')}
        android_ripple={{ color: tape.line }}
        style={[
          styles.tab,
          activeTab === 'transcript' && { backgroundColor: tape.raised },
        ]}
      >
        <Text
          style={[
            styles.tabText,
            {
              color: activeTab === 'transcript' ? tape.ink : tape.inkMuted,
              fontFamily:
                activeTab === 'transcript'
                  ? fontFamilies.semibold
                  : fontFamilies.regular,
            },
          ]}
        >
          Transcript
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
    height: 48,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: typeScale.body,
  },
});
