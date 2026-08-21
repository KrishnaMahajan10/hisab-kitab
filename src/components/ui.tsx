import { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { spacing, useTheme } from '../theme';

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        style,
      ]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  tone = 'default',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const background =
    tone === 'primary' ? theme.accent : tone === 'danger' ? 'transparent' : theme.surfaceAlt;
  const color =
    tone === 'primary' ? '#FFFFFF' : tone === 'danger' ? theme.debit : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: tone === 'danger' ? theme.border : 'transparent',
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}>
      <Text style={[styles.buttonLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            onPress={() => onChange(option)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.accent : theme.surfaceAlt,
                borderColor: active ? theme.accent : theme.border,
              },
            ]}>
            <Text
              style={[styles.chipLabel, { color: active ? '#FFFFFF' : theme.textMuted }]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ChipGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chipGrid}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.accent : theme.surfaceAlt,
                borderColor: active ? theme.accent : theme.border,
              },
            ]}>
            <Text style={[styles.chipLabel, { color: active ? '#FFFFFF' : theme.textMuted }]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ChipGridMulti({
  options,
  selected,
  onToggle,
}: {
  options: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chipGrid}>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <Pressable
            key={option}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            onPress={() => onToggle(option)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.accent : theme.surfaceAlt,
                borderColor: active ? theme.accent : theme.border,
              },
            ]}>
            <Text style={[styles.chipLabel, { color: active ? '#FFFFFF' : theme.textMuted }]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RemovableChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.activeChip,
        { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
      ]}>
      <Text style={[styles.activeChipLabel, { color: theme.text }]}>{label}</Text>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label} filter`}
          onPress={onRemove}
          hitSlop={8}>
          <Text style={[styles.activeChipClose, { color: theme.textMuted }]}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Badge({ label, tone }: { label: string; tone?: 'muted' | 'warn' }) {
  const theme = useTheme();
  const color = tone === 'warn' ? theme.warn : theme.textMuted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      {hint ? <Text style={[styles.emptyHint, { color: theme.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  button: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  activeChipLabel: { fontSize: 12, fontWeight: '600' },
  activeChipClose: { fontSize: 12, fontWeight: '700' },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyHint: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
