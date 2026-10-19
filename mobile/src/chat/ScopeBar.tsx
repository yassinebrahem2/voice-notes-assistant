import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { Chip } from '../components/Chip';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

type Scope = Schemas['AskIn']['scope'];

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'notes', label: 'Notes' },
  { value: 'meetings', label: 'Meetings' },
  { value: 'both', label: 'Both' },
];

type Props = {
  scope: Scope;
  onScope: (scope: Scope) => void;
  tags: Schemas['TagOut'][];
  tagIds: string[];
  onTagIds: (tagIds: string[]) => void;
};

export function ScopeBar({ scope, onScope, tags, tagIds, onTagIds }: Props) {
  const { tape } = useTheme<TapeTheme>();
  const toggle = (id: string) =>
    onTagIds(
      tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id],
    );
  return (
    <View style={styles.bar}>
      <View
        accessibilityRole="radiogroup"
        style={[styles.segments, { borderColor: tape.line }]}
      >
        {SCOPES.map(({ value, label }) => {
          const selected = scope === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected }}
              onPress={() => onScope(value)}
              android_ripple={{ color: tape.line }}
              style={[
                styles.segment,
                selected && { backgroundColor: tape.raised },
              ]}
            >
              <Text
                variant="labelMedium"
                style={{ color: selected ? tape.ink : tape.inkMuted }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {tags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tags}
        >
          {tags.map((tag) => (
            <Chip
              key={tag.id}
              label={tag.name}
              onPress={() => toggle(tag.id)}
              accessibilityRole="checkbox"
              accessibilityLabel={`Tag ${tag.name}`}
              selected={tagIds.includes(tag.id)}
              selectedVariant="outline"
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: spacing.sm },
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
  tags: { gap: spacing.sm },
});
