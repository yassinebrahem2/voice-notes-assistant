import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';

export interface RecordingHeaderProps {
  title: string;
  tags?: Schemas['TagOut'][];
  onBack: () => void;
}

export function RecordingHeader({ title, tags, onBack }: RecordingHeaderProps) {
  const { tape } = useTheme<TapeTheme>();

  return (
    <View style={styles.header}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          android_ripple={{ color: tape.line, borderless: true }}
          style={styles.iconButton}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={tape.ink}
            accessible={false}
          />
        </Pressable>
        <Text
          numberOfLines={1}
          style={[
            styles.topBarTitle,
            { color: tape.ink, fontFamily: fontFamilies.semibold },
          ]}
        >
          {title}
        </Text>
      </View>

      {tags && tags.length > 0 ? (
        <View style={styles.tagsRow}>
          {tags.map((tag) => (
            <View
              key={tag.id}
              style={[
                styles.tagChip,
                { backgroundColor: tape.surface, borderColor: tape.line },
              ]}
            >
              <Text
                style={[
                  styles.tagText,
                  { color: tape.inkMuted, fontFamily: fontFamilies.regular },
                ]}
              >
                {tag.name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  topBarTitle: { flex: 1, fontSize: typeScale.title },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tagChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.round,
    borderWidth: 1,
  },
  tagText: { fontSize: typeScale.small },
});
