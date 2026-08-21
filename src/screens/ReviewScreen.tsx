import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { Badge, Button, Card, ChipGrid, ChipRow, EmptyState } from '../components/ui';
import { useCategories } from '../categories';
import { SplitPicker } from '../components/SplitPicker';
import { sharesTotal, type Shares } from '../splits';
import {
  confirmTransaction,
  deleteAllPending,
  deleteTransaction,
  learnRule,
  listAccounts,
  listPeople,
  listSplitsForTransaction,
  replaceSplits,
  listPending,
  type Account,
  type Person,
  type TransactionWithAccount,
} from '../db/repo';
import { displayTitle, originBadge } from '../labels';
import { ruleKeyFor } from '../parse/categorize';
import { drainCaptures } from '../sync';
import { formatDateTime, formatMoney, spacing, useTheme } from '../theme';

function orderWithSelectedFirst(options: readonly string[], selected: string): string[] {
  if (!options.includes(selected)) return [selected, ...options];
  return [selected, ...options.filter((entry) => entry !== selected)];
}

type Draft = {
  category: string;
  accountId: number | null;
  shares: Shares;
  title: string;
  merchant: string;
  note: string;
  expanded: boolean;
};

export default function ReviewScreen({ onChanged }: { onChanged: () => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const categories = useCategories();
  const [pending, setPending] = useState<TransactionWithAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [rows, accountRows, peopleRows] = await Promise.all([
      listPending(db),
      listAccounts(db),
      listPeople(db),
    ]);
    setPending(rows);
    setAccounts(accountRows);
    setPeople(peopleRows.filter((person) => !person.archived));

    // A split made before confirming has to survive a refresh, so it is read
    // back rather than reset to empty.
    const stored = new Map<number, Shares>();
    for (const row of rows) {
      const splits = await listSplitsForTransaction(db, row.id);
      if (splits.length === 0) continue;
      const shares: Shares = {};
      for (const split of splits) {
        if (split.direction === 'owed_to_me') shares[split.personId] = split.amountPaise;
      }
      stored.set(row.id, shares);
    }
    setDrafts((previous) => {
      const next: Record<number, Draft> = {};
      for (const row of rows) {
        next[row.id] =
          previous[row.id] ?? {
            category: row.category,
            accountId: row.account_id,
            shares: stored.get(row.id) ?? {},
            title: row.title ?? '',
            merchant: row.merchant ?? '',
            note: row.note ?? '',
            expanded: false,
          };
      }
      return next;
    });
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await drainCaptures(db);
    await load();
    onChanged();
    setRefreshing(false);
  }, [db, load, onChanged]);

  const patchDraft = (id: number, patch: Partial<Draft>) =>
    setDrafts((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));

  const confirm = async (row: TransactionWithAccount) => {
    const draft = drafts[row.id];
    if (!draft) return;

    // Splits are written before the row leaves the queue, so confirming never
    // loses a share that was set here.
    await replaceSplits(
      db,
      row.id,
      Object.entries(draft.shares).map(([personId, amountPaise]) => ({
        personId: Number(personId),
        amountPaise,
        direction: 'owed_to_me' as const,
      }))
    );
    const merchant = draft.merchant.trim() || null;
    await confirmTransaction(db, row.id, {
      accountId: draft.accountId,
      category: draft.category,
      amountPaise: row.amount_paise,
      direction: row.direction,
      title: draft.title.trim() || null,
      merchant,
      note: draft.note.trim() || null,
    });

    if (draft.category !== row.category) {
      const key = ruleKeyFor(merchant);
      if (key) await learnRule(db, key, draft.category);
    }

    await load();
    onChanged();
  };

  const confirmAll = async () => {
    for (const row of pending) {
      const draft = drafts[row.id];
      if (!draft) continue;
      await replaceSplits(
        db,
        row.id,
        Object.entries(draft.shares).map(([personId, amountPaise]) => ({
          personId: Number(personId),
          amountPaise,
          direction: 'owed_to_me' as const,
        }))
      );
      await confirmTransaction(db, row.id, {
        accountId: draft.accountId,
        category: draft.category,
        amountPaise: row.amount_paise,
        direction: row.direction,
        title: draft.title.trim() || null,
        merchant: draft.merchant.trim() || null,
        note: draft.note.trim() || null,
      });
    }
    await load();
    onChanged();
  };

  /**
   * Clearing the queue throws away captured transactions, so it names the
   * number and asks. Nothing here is recoverable — the native capture queue
   * has already been drained by this point.
   */
  const discardAll = () => {
    Alert.alert(
      `Discard all ${pending.length}?`,
      'These transactions will not be recorded, and re-scanning will not bring them back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Discard ${pending.length}`,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteAllPending(db);
              await load();
              onChanged();
            })();
          },
        },
      ]
    );
  };

  const discard = async (id: number) => {
    await deleteTransaction(db, id);
    await load();
    onChanged();
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />
      }>
      {pending.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          hint="Pull down to scan for new bank SMS and payment notifications."
        />
      ) : (
        <>
          <View style={styles.headerRow}>
            <Text style={[styles.count, { color: theme.text }]}>
              {pending.length} to review
            </Text>
            <View style={styles.bulkRow}>
              <Button label="Discard all" tone="danger" onPress={discardAll} />
              <Button label="Confirm all" tone="primary" onPress={confirmAll} />
            </View>
          </View>

          {pending.map((row) => {
            const draft = drafts[row.id];
            if (!draft) return null;
            const isDebit = row.direction === 'debit';
            const lowConfidence = row.confidence < 0.7;

            return (
              <Card key={row.id}>
                <View style={styles.topRow}>
                  <Text
                    style={[
                      styles.amount,
                      { color: isDebit ? theme.debit : theme.credit },
                    ]}>
                    {isDebit ? '−' : '+'}
                    {formatMoney(row.amount_paise)}
                  </Text>
                  <View style={styles.badges}>
                    {sharesTotal(draft.shares) > 0 ? (
                      <Badge label="SPLIT" tone="muted" />
                    ) : null}
                    <Badge label={originBadge(row)} />
                    {lowConfidence ? <Badge label="CHECK" tone="warn" /> : null}
                  </View>
                </View>

                <Text style={[styles.merchant, { color: theme.text }]}>
                  {displayTitle(
                    { title: draft.title, merchant: draft.merchant },
                    'Unknown merchant'
                  )}
                </Text>
                <Text style={[styles.meta, { color: theme.textMuted }]}>
                  {formatDateTime(row.occurred_at)}
                  {row.account_name ? ` · ${row.account_name}` : ' · no account'}
                </Text>

                <ChipRow
                  options={orderWithSelectedFirst(
                    categories.forDirection(row.direction),
                    draft.category
                  )}
                  value={draft.category}
                  onChange={(next) => patchDraft(row.id, { category: next })}
                />

                {draft.expanded ? (
                  <View style={styles.expanded}>
                    <Text style={[styles.label, { color: theme.textMuted }]}>All categories</Text>
                    <ChipGrid
                      options={categories.forDirection(row.direction)}
                      value={draft.category}
                      onChange={(next) => patchDraft(row.id, { category: next })}
                    />

                    <Text style={[styles.label, { color: theme.textMuted }]}>Title</Text>
                    <TextInput
                      value={draft.title}
                      onChangeText={(text) => patchDraft(row.id, { title: text })}
                      placeholder={draft.merchant || 'Name this transaction'}
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
                      onChangeText={(text) => patchDraft(row.id, { merchant: text })}
                      placeholder="Merchant name"
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

                    {row.direction === 'debit' ? (
                      <SplitPicker
                        people={people}
                        shares={draft.shares}
                        amountPaise={row.amount_paise}
                        onChange={(next) => patchDraft(row.id, { shares: next })}
                      />
                    ) : null}

                    <Text style={[styles.label, { color: theme.textMuted }]}>Account</Text>
                    <ChipRow
                      options={accounts.map((account) => account.name)}
                      value={
                        accounts.find((account) => account.id === draft.accountId)?.name ??
                        accounts[0]?.name ??
                        ''
                      }
                      onChange={(name) => {
                        const match = accounts.find((account) => account.name === name);
                        patchDraft(row.id, { accountId: match?.id ?? null });
                      }}
                    />

                    <Text style={[styles.label, { color: theme.textMuted }]}>Note</Text>
                    <TextInput
                      value={draft.note}
                      onChangeText={(text) => patchDraft(row.id, { note: text })}
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

                    <Text style={[styles.raw, { color: theme.textMuted }]}>{row.raw_body}</Text>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <Button
                    label="Confirm"
                    tone="primary"
                    onPress={() => void confirm(row)}
                    style={styles.grow}
                  />
                  <Button
                    label={draft.expanded ? 'Done' : 'Edit'}
                    onPress={() => patchDraft(row.id, { expanded: !draft.expanded })}
                  />
                  <Button label="Discard" tone="danger" onPress={() => void discard(row.id)} />
                </View>
              </Card>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  count: { fontSize: 17, fontWeight: '700' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amount: { fontSize: 24, fontWeight: '700' },
  badges: { flexDirection: 'row', gap: spacing.xs },
  merchant: { fontSize: 16, fontWeight: '600', marginTop: spacing.sm },
  bulkRow: { flexDirection: 'row', gap: spacing.sm },
  meta: { fontSize: 12, marginTop: 2, marginBottom: spacing.sm },
  expanded: { gap: spacing.xs, marginTop: spacing.md },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: spacing.sm },
  input: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 15,
  },
  raw: { fontSize: 11, lineHeight: 16, marginTop: spacing.md, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  grow: { flex: 1 },
});
