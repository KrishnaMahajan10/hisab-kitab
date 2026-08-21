import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import { useCategories } from '../categories';
import { DEFAULT_FILTERS, rangeOf, SOURCE_FILTERS, type HistoryFilters } from '../filters';
import { PERIODS, recentMonths } from '../period';
import { formatDate, spacing, useTheme } from '../theme';
import { Button, ChipGridMulti, ChipRow } from './ui';

const DAY_MS = 24 * 60 * 60 * 1000;

export function FilterSheet({
  visible,
  initial,
  onApply,
  onClose,
}: {
  visible: boolean;
  initial: HistoryFilters;
  onApply: (next: HistoryFilters) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const categories = useCategories();
  const [draft, setDraft] = useState<HistoryFilters>(initial);
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);

  // Re-seed the draft each time the sheet opens so a discarded edit does not
  // linger into the next open.
  useEffect(() => {
    if (visible) {
      setDraft(initial);
      setPicker(null);
    }
  }, [visible, initial]);

  const patch = (next: Partial<HistoryFilters>) =>
    setDraft((previous) => ({ ...previous, ...next }));

  const toggleCategory = (category: string) =>
    setDraft((previous) => ({
      ...previous,
      categories: previous.categories.includes(category)
        ? previous.categories.filter((c) => c !== category)
        : [...previous.categories, category],
    }));

  const draftRange = rangeOf(draft);
  const months = useMemo(() => recentMonths(new Date()), []);
  const fallbackFrom = draft.customFrom ?? draftRange.from ?? Date.now();
  const fallbackTo = draft.customTo ?? (draftRange.to ?? Date.now()) - DAY_MS;
  const selectedCount = draft.categories.length;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} accessibilityLabel="Close filters" onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.text }]}>Filters</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDraft(DEFAULT_FILTERS)}
              hitSlop={8}>
              <Text style={[styles.clear, { color: theme.accent }]}>Clear all</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            <Text style={[styles.section, { color: theme.textMuted }]}>Period</Text>
            <ChipRow
              options={PERIODS}
              value={draft.period}
              onChange={(next) => patch({ period: next })}
            />
            {draft.period === 'Pick month' ? (
              <ChipRow
                options={months.map((month) => month.short)}
                value={
                  months.find((month) => month.anchor === draft.monthAnchor)?.short ??
                  months[0].short
                }
                onChange={(short) => {
                  const picked = months.find((month) => month.short === short);
                  if (picked) patch({ monthAnchor: picked.anchor });
                }}
              />
            ) : null}
            {draft.period === 'Custom' ? (
              <View style={styles.rangeRow}>
                <Button
                  label={`From  ${formatDate(fallbackFrom)}`}
                  onPress={() => setPicker('from')}
                  style={styles.grow}
                />
                <Button
                  label={`To  ${formatDate(fallbackTo)}`}
                  onPress={() => setPicker('to')}
                  style={styles.grow}
                />
              </View>
            ) : (
              <Text style={[styles.hint, { color: theme.textMuted }]}>{draftRange.label}</Text>
            )}

            {picker ? (
              <DateTimePicker
                value={new Date(picker === 'from' ? fallbackFrom : fallbackTo)}
                mode="date"
                display={Platform.OS === 'android' ? 'calendar' : 'default'}
                onChange={(event, selected) => {
                  const which = picker;
                  setPicker(null);
                  if (event.type === 'dismissed' || !selected || !which) return;
                  if (which === 'from') patch({ customFrom: selected.getTime() });
                  else patch({ customTo: selected.getTime() });
                }}
              />
            ) : null}

            <Text style={[styles.section, { color: theme.textMuted }]}>Captured from</Text>
            <ChipRow
              options={SOURCE_FILTERS}
              value={draft.source}
              onChange={(next) => patch({ source: next })}
            />

            <View style={styles.categoryHeader}>
              <Text style={[styles.section, { color: theme.textMuted }]}>
                Category{selectedCount > 0 ? ` · ${selectedCount} selected` : ''}
              </Text>
              {selectedCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => patch({ categories: [] })}
                  hitSlop={8}>
                  <Text style={[styles.clearSmall, { color: theme.accent }]}>Reset</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={[styles.hint, { color: theme.textMuted }]}>
              {selectedCount === 0 ? 'All categories' : 'Only the selected categories'}
            </Text>

            <Text style={[styles.groupLabel, { color: theme.textMuted }]}>Expenses</Text>
            <ChipGridMulti
              options={categories.forDirection('debit')}
              selected={draft.categories}
              onToggle={toggleCategory}
            />

            <Text style={[styles.groupLabel, { color: theme.textMuted }]}>Income</Text>
            <ChipGridMulti
              options={categories.forDirection('credit')}
              selected={draft.categories}
              onToggle={toggleCategory}
            />
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                borderTopColor: theme.border,
                paddingBottom: Math.max(insets.bottom, spacing.md),
              },
            ]}>
            <Button
              label="Apply"
              tone="primary"
              onPress={() => onApply(draft)}
              style={styles.grow}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  backdropFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    maxHeight: '88%',
    flexShrink: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  clear: { fontSize: 14, fontWeight: '700' },
  clearSmall: { fontSize: 12, fontWeight: '700' },
  scroll: { flexShrink: 1 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  section: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
  },
  groupLabel: { fontSize: 12, fontWeight: '700', marginTop: spacing.md },
  hint: { fontSize: 12, marginTop: spacing.xs },
  categoryHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  rangeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1 },
});
