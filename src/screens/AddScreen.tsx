import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { Button, Card, ChipGrid, ChipRow, SectionTitle } from '../components/ui';
import { useCategories } from '../categories';
import { insertTransaction, listAccounts, type Account } from '../db/repo';
import { spacing, useTheme } from '../theme';

const QUICK_AMOUNTS = [20, 50, 100, 200, 500];

const ENTRY_KINDS = ['Expense', 'Income'] as const;
type EntryKind = (typeof ENTRY_KINDS)[number];

export default function AddScreen({ onChanged }: { onChanged: () => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const categories = useCategories();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('Food & Dining');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [entryKind, setEntryKind] = useState<EntryKind>('Expense');

  const direction: 'debit' | 'credit' = entryKind === 'Income' ? 'credit' : 'debit';
  const categoryOptions = categories.forDirection(direction);

  const changeEntryKind = (next: EntryKind) => {
    setEntryKind(next);
    setCategory(next === 'Income' ? 'Salary' : 'Food & Dining');
  };

  const load = useCallback(async () => {
    const rows = await listAccounts(db);
    setAccounts(rows);
    setAccountId((current) => {
      if (current !== null && rows.some((row) => row.id === current)) return current;
      return rows.find((row) => row.kind === 'cash')?.id ?? rows[0]?.id ?? null;
    });
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsedPaise = (() => {
    const value = Number.parseFloat(amount.replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
  })();

  const save = async () => {
    if (parsedPaise === null) {
      Alert.alert('Enter an amount', 'Amount must be a number greater than zero.');
      return;
    }

    const now = Date.now();
    await insertTransaction(db, {
      accountId,
      amountPaise: parsedPaise,
      direction,
      // A hand-typed name is a title, not a parsed merchant: nothing here came
      // from a bank message, so there is no merchant to record.
      title: title.trim() || null,
      merchant: null,
      category,
      occurredAt: now,
      source: 'manual',
      status: 'confirmed',
      confidence: 1,
      dedupKey: `manual|${now}|${parsedPaise}|${Math.random().toString(36).slice(2, 10)}`,
    });

    setAmount('');
    setTitle('');
    onChanged();
    Alert.alert('Saved', 'Transaction added.');
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={styles.container}>
      <SectionTitle>Amount</SectionTitle>
      <Card>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.textMuted}
          style={[styles.amountInput, { color: theme.text }]}
        />
        <View style={styles.quickRow}>
          {QUICK_AMOUNTS.map((value) => (
            <Button
              key={value}
              label={`₹${value}`}
              onPress={() => setAmount(String(value))}
              style={styles.quickButton}
            />
          ))}
        </View>
      </Card>

      <SectionTitle>Type</SectionTitle>
      <ChipRow options={ENTRY_KINDS} value={entryKind} onChange={changeEntryKind} />

      <SectionTitle>Category</SectionTitle>
      <ChipGrid options={categoryOptions} value={category} onChange={setCategory} />

      <SectionTitle>Account</SectionTitle>
      <ChipRow
        options={accounts.map((account) => account.name)}
        value={accounts.find((account) => account.id === accountId)?.name ?? ''}
        onChange={(name) => {
          const match = accounts.find((account) => account.name === name);
          setAccountId(match?.id ?? null);
        }}
      />

      <SectionTitle>{entryKind === 'Income' ? 'Received from' : 'Spent on'}</SectionTitle>
      <Card>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={entryKind === 'Income' ? 'Salary, refund, gift…' : 'Tea, auto, vegetables…'}
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />
      </Card>

      <Button
        label={entryKind === 'Income' ? 'Save income' : 'Save expense'}
        tone="primary"
        onPress={() => void save()}
        style={styles.save}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xxl },
  amountInput: { fontSize: 38, fontWeight: '800', paddingVertical: spacing.sm },
  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  quickButton: { flexGrow: 1, minWidth: 62 },
  input: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 16,
  },
  save: { marginTop: spacing.xl },
});
