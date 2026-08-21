import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import {
  Badge,
  Button,
  Card,
  ChipGrid,
  ChipRow,
  EmptyState,
  RemovableChip,
  SectionTitle,
} from '../components/ui';
import { useCategories } from '../categories';
import {
  deleteTransaction,
  historySummary,
  learnRule,
  listAccounts,
  listHistory,
  updateTransaction,
  type Account,
  type TransactionWithAccount,
} from '../db/repo';
import { displayTitle, originBadge, originDescription, paymentReference } from '../labels';
import { ruleKeyFor } from '../parse/categorize';
import { FilterSheet } from '../components/FilterSheet';
import {
  activeChips,
  activeFilterCount,
  DEFAULT_FILTERS,
  rangeOf,
  SOURCE_TO_QUERY,
  type HistoryFilters,
} from '../filters';
import { formatDate, formatDateTime, formatMoney, spacing, useTheme } from '../theme';

const PAGE_SIZE = 50;

type Draft = {
  amount: string;
  direction: 'debit' | 'credit';
  title: string;
  merchant: string;
  category: string;
  note: string;
  accountId: number | null;
  occurredAt: number;
};

function toDraft(row: TransactionWithAccount): Draft {
  return {
    amount: (row.amount_paise / 100).toFixed(2),
    direction: row.direction,
    title: row.title ?? '',
    merchant: row.merchant ?? '',
    category: row.category,
    note: row.note ?? '',
    accountId: row.account_id,
    occurredAt: row.occurred_at,
  };
}

function monthKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export default function HistoryScreen({
  refreshToken,
  onChanged,
}: {
  refreshToken: number;
  onChanged: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const categories = useCategories();

  const [rows, setRows] = useState<TransactionWithAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState({ count: 0, spent: 0, earned: 0, moved: 0 });
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<TransactionWithAccount | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const range = useMemo(() => rangeOf(filters), [filters]);
  const chips = useMemo(() => activeChips(filters), [filters]);
  const filterCount = activeFilterCount(filters);

  const query = useMemo(
    () => ({
      search,
      source: SOURCE_TO_QUERY[filters.source],
      from: range.from,
      to: range.to,
      categories: filters.categories,
    }),
    [search, filters.source, filters.categories, range.from, range.to]
  );

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      const [page, totals, accountRows] = await Promise.all([
        listHistory(db, { ...query, limit: PAGE_SIZE, offset: nextOffset }),
        historySummary(db, query),
        listAccounts(db),
      ]);
      setRows((previous) => (append ? [...previous, ...page] : page));
      setSummary(totals);
      setAccounts(accountRows);
      setOffset(nextOffset);
    },
    [db, query]
  );

  useEffect(() => {
    void load(0, false);
  }, [load, refreshToken]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(0, false);
    setRefreshing(false);
  }, [load]);

  const openEditor = (row: TransactionWithAccount) => {
    setEditing(row);
    setDraft(toDraft(row));
  };

  const closeEditor = () => {
    setEditing(null);
    setDraft(null);
    setShowPicker(false);
  };

  const patch = (next: Partial<Draft>) =>
    setDraft((previous) => (previous ? { ...previous, ...next } : previous));

  const save = async () => {
    if (!editing || !draft) return;
    const rupees = Number.parseFloat(draft.amount.replace(/,/g, ''));
    if (!Number.isFinite(rupees) || rupees <= 0) {
      Alert.alert('Check the amount', 'Amount must be a number greater than zero.');
      return;
    }

    setSaving(true);
    const merchant = draft.merchant.trim() || null;
    await updateTransaction(db, editing.id, {
      accountId: draft.accountId,
      amountPaise: Math.round(rupees * 100),
      direction: draft.direction,
      title: draft.title.trim() || null,
      merchant,
      category: draft.category,
      occurredAt: draft.occurredAt,
      note: draft.note.trim() || null,
    });

    if (draft.category !== editing.category) {
      const key = ruleKeyFor(merchant);
      if (key) await learnRule(db, key, draft.category);
    }

    setSaving(false);
    closeEditor();
    await load(0, false);
    onChanged();
  };

  const remove = () => {
    if (!editing) return;
    const target = editing;
    Alert.alert('Delete this transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteTransaction(db, target.id);
            closeEditor();
            await load(0, false);
            onChanged();
          })();
        },
      },
    ]);
  };

  const grouped = useMemo(() => {
    const buckets: Array<{ month: string; items: TransactionWithAccount[] }> = [];
    for (const row of rows) {
      const key = monthKey(row.occurred_at);
      const last = buckets[buckets.length - 1];
      if (last && last.month === key) last.items.push(row);
      else buckets.push({ month: key, items: [row] });
    }
    return buckets;
  }, [rows]);

  const hasMore = rows.length < summary.count;
  const reference = editing ? paymentReference(editing) : null;

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />
        }>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search merchant, note or category"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.search,
            { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Filters${filterCount > 0 ? `, ${filterCount} active` : ''}`}
            onPress={() => setSheetOpen(true)}
            style={[
              styles.filterButton,
              {
                backgroundColor: filterCount > 0 ? theme.accent : theme.surfaceAlt,
                borderColor: filterCount > 0 ? theme.accent : theme.border,
              },
            ]}>
            <Ionicons
              name="options-outline"
              size={16}
              color={filterCount > 0 ? '#FFFFFF' : theme.textMuted}
            />
            <Text
              style={[
                styles.filterButtonLabel,
                { color: filterCount > 0 ? '#FFFFFF' : theme.text },
              ]}>
              Filters{filterCount > 0 ? ` (${filterCount})` : ''}
            </Text>
          </Pressable>

          {chips.map((chip) => (
            <RemovableChip
              key={chip.key}
              label={chip.label}
              onRemove={
                chip.key === 'period' && filters.period === DEFAULT_FILTERS.period
                  ? undefined
                  : () => setFilters(chip.clear(filters))
              }
            />
          ))}
        </ScrollView>

        <View style={[styles.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.rangeLabel, { color: theme.text }]}>{range.label}</Text>
          <View style={styles.totals}>
            <Text style={[styles.totalsText, { color: theme.textMuted }]}>
              {summary.count} {summary.count === 1 ? 'entry' : 'entries'}
            </Text>
            <Text style={[styles.totalsText, { color: theme.debit }]}>
              −{formatMoney(summary.spent)}
            </Text>
            <Text style={[styles.totalsText, { color: theme.credit }]}>
              +{formatMoney(summary.earned)}
            </Text>
            {summary.moved > 0 ? (
              <Text style={[styles.totalsText, { color: theme.textMuted }]}>
                ⇄ {formatMoney(summary.moved)}
              </Text>
            ) : null}
          </View>
        </View>

        {rows.length === 0 ? (
          <EmptyState
            title={`Nothing in ${range.label}`}
            hint={
              filterCount > 0 || search.trim()
                ? 'No transactions match the filters you applied. Widen the period or clear a filter.'
                : 'Confirmed transactions show up here once you approve them in Review.'
            }
          />
        ) : (
          grouped.map((bucket) => (
            <View key={bucket.month}>
              <SectionTitle>{bucket.month}</SectionTitle>
              <Card>
                {bucket.items.map((row, index) => {
                  const isDebit = row.direction === 'debit';
                  return (
                    <Pressable
                      key={row.id}
                      accessibilityRole="button"
                      accessibilityHint="Opens the editor for this transaction"
                      onPress={() => openEditor(row)}
                      style={({ pressed }) => [
                        styles.row,
                        index > 0
                          ? {
                              borderTopColor: theme.border,
                              borderTopWidth: StyleSheet.hairlineWidth,
                            }
                          : null,
                        pressed ? { opacity: 0.6 } : null,
                      ]}>
                      <View style={styles.grow}>
                        <View style={styles.titleLine}>
                          <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                            {displayTitle(row)}
                          </Text>
                          <Badge label={originBadge(row)} />
                        </View>
                        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                          {formatDate(row.occurred_at)} · {row.category}
                          {row.account_name ? ` · ${row.account_name}` : ''}
                        </Text>
                        {row.note ? (
                          <Text
                            style={[styles.rowNote, { color: theme.textMuted }]}
                            numberOfLines={1}>
                            {row.note}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        style={[styles.rowValue, { color: isDebit ? theme.debit : theme.credit }]}>
                        {isDebit ? '−' : '+'}
                        {formatMoney(row.amount_paise)}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                    </Pressable>
                  );
                })}
              </Card>
            </View>
          ))
        )}

        {hasMore ? (
          <Button
            label={`Load more (${summary.count - rows.length} left)`}
            onPress={() => void load(offset + PAGE_SIZE, true)}
          />
        ) : null}
      </ScrollView>

      <FilterSheet
        visible={sheetOpen}
        initial={filters}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />

      <Modal
        visible={editing !== null}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={closeEditor}>
        <View style={styles.backdrop}>
          <Pressable
            style={styles.backdropFill}
            accessibilityLabel="Close editor"
            onPress={closeEditor}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheetWrap}>
            <View
              style={[
                styles.sheet,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}>
              {editing && draft ? (
                <>
                  <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
                    <View style={styles.grow}>
                      <Text style={[styles.sheetTitle, { color: theme.text }]} numberOfLines={1}>
                        {displayTitle({ title: draft.title, merchant: draft.merchant })}
                      </Text>
                      <Text style={[styles.sheetSubtitle, { color: theme.textMuted }]}>
                        {originDescription(editing)}
                        {editing.confidence < 1
                          ? ` · ${Math.round(editing.confidence * 100)}% confident`
                          : ''}
                      </Text>
                    </View>
                    <Badge label={originBadge(editing)} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close"
                      onPress={closeEditor}
                      hitSlop={10}
                      style={styles.closeButton}>
                      <Ionicons name="close" size={22} color={theme.textMuted} />
                    </Pressable>
                  </View>

                  <ScrollView
                    style={styles.sheetScroll}
                    contentContainerStyle={styles.sheetBody}
                    keyboardShouldPersistTaps="handled">
                    <Text style={[styles.label, { color: theme.textMuted }]}>Amount</Text>
                    <TextInput
                      value={draft.amount}
                      onChangeText={(text) => patch({ amount: text })}
                      keyboardType="decimal-pad"
                      style={[
                        styles.input,
                        {
                          color: theme.text,
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    />

                    <Text style={[styles.label, { color: theme.textMuted }]}>Type</Text>
                    <ChipRow
                      options={['Expense', 'Income'] as const}
                      value={draft.direction === 'credit' ? 'Income' : 'Expense'}
                      onChange={(next) => {
                        const direction = next === 'Income' ? 'credit' : 'debit';
                        const allowed = categories.forDirection(direction);
                        patch({
                          direction,
                          category: allowed.includes(draft.category) ? draft.category : allowed[0],
                        });
                      }}
                    />

                    <Text style={[styles.label, { color: theme.textMuted }]}>Title</Text>
                    <TextInput
                      value={draft.title}
                      onChangeText={(text) => patch({ title: text })}
                      placeholder={draft.merchant || 'Unknown'}
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.input,
                        {
                          color: theme.text,
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    />

                    <Text style={[styles.label, { color: theme.textMuted }]}>Merchant</Text>
                    <TextInput
                      value={draft.merchant}
                      onChangeText={(text) => patch({ merchant: text })}
                      placeholder="Unknown"
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.input,
                        {
                          color: theme.text,
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    />

                    <Text style={[styles.label, { color: theme.textMuted }]}>Category</Text>
                    <ChipGrid
                      options={categories.forDirection(draft.direction)}
                      value={draft.category}
                      onChange={(next) => patch({ category: next })}
                    />

                    <Text style={[styles.label, { color: theme.textMuted }]}>Account</Text>
                    <ChipRow
                      options={accounts.map((account) => account.name)}
                      value={accounts.find((account) => account.id === draft.accountId)?.name ?? ''}
                      onChange={(name) => {
                        const match = accounts.find((account) => account.name === name);
                        patch({ accountId: match?.id ?? null });
                      }}
                    />

                    <Text style={[styles.label, { color: theme.textMuted }]}>Date</Text>
                    <Button
                      label={formatDateTime(draft.occurredAt)}
                      onPress={() => setShowPicker(true)}
                    />
                    {showPicker ? (
                      <DateTimePicker
                        value={new Date(draft.occurredAt)}
                        mode="date"
                        display={Platform.OS === 'android' ? 'calendar' : 'default'}
                        onChange={(event, selected) => {
                          setShowPicker(false);
                          if (event.type === 'dismissed' || !selected) return;
                          const previous = new Date(draft.occurredAt);
                          const merged = new Date(
                            selected.getFullYear(),
                            selected.getMonth(),
                            selected.getDate(),
                            previous.getHours(),
                            previous.getMinutes()
                          );
                          patch({ occurredAt: merged.getTime() });
                        }}
                      />
                    ) : null}

                    <Text style={[styles.label, { color: theme.textMuted }]}>Note</Text>
                    <TextInput
                      value={draft.note}
                      onChangeText={(text) => patch({ note: text })}
                      placeholder="Optional"
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.input,
                        {
                          color: theme.text,
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    />

                    {reference ? (
                      <Text style={[styles.meta, { color: theme.textMuted }]} selectable>
                        Bank reference (UTR): {reference}
                      </Text>
                    ) : null}
                    {editing.raw_body ? (
                      <Text style={[styles.raw, { color: theme.textMuted }]}>
                        {editing.raw_body}
                      </Text>
                    ) : null}
                  </ScrollView>

                  <View
                    style={[
                      styles.sheetFooter,
                      {
                        borderTopColor: theme.border,
                        paddingBottom: Math.max(insets.bottom, spacing.md),
                      },
                    ]}>
                    <Button
                      label={saving ? 'Saving…' : 'Save'}
                      tone="primary"
                      disabled={saving}
                      onPress={() => void save()}
                      style={styles.grow}
                    />
                    <Button label="Delete" tone="danger" onPress={remove} />
                  </View>
                </>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xxl },
  search: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
  },
  filterButtonLabel: { fontSize: 13, fontWeight: '700' },
  summaryCard: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rangeLabel: { fontSize: 14, fontWeight: '700' },
  totals: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  totalsText: { fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  rowMeta: { fontSize: 12, marginTop: 2 },
  rowNote: { fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  rowValue: { fontSize: 15, fontWeight: '700' },
  grow: { flex: 1 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  backdropFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { maxHeight: '92%', flexShrink: 1 },
  sheet: {
    flexShrink: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  // Must shrink so the pinned footer stays inside the sheet's max height
  // instead of being pushed past it and clipped by overflow: hidden.
  sheetScroll: { flexShrink: 1 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetSubtitle: { fontSize: 12, marginTop: 2 },
  closeButton: { padding: spacing.xs },
  sheetBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  sheetFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: spacing.lg },
  input: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  meta: { fontSize: 12, marginTop: spacing.lg },
  raw: { fontSize: 11, lineHeight: 16, marginTop: spacing.sm, fontStyle: 'italic' },
});
