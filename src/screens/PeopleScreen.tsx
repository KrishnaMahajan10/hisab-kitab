import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, Card, EmptyState, SectionTitle } from '../components/ui';
import {
  createPerson,
  deletePerson,
  listAllSplits,
  listPeople,
  renamePerson,
  setPersonArchived,
  settleUpWith,
  type Person,
  type SplitRecord,
} from '../db/repo';
import { outstandingBalances, totalOutstanding } from '../splits';
import { formatMoney, spacing, useTheme } from '../theme';

export default function PeopleScreen({
  onChanged,
  onBack,
}: {
  onChanged: () => void;
  onBack: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();

  const [people, setPeople] = useState<Person[]>([]);
  const [splits, setSplits] = useState<SplitRecord[]>([]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [peopleRows, splitRows] = await Promise.all([listPeople(db), listAllSplits(db)]);
    setPeople(peopleRows);
    setSplits(splitRows);
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  const balances = useMemo(() => {
    const rows = outstandingBalances(
      splits.map((split) => ({
        personId: split.personId,
        amountPaise: split.amountPaise,
        direction: split.direction,
        settled: split.settled,
      }))
    );
    return new Map(rows.map((row) => [row.personId, row.netPaise]));
  }, [splits]);

  const totals = useMemo(
    () =>
      totalOutstanding(
        splits.map((split) => ({
          personId: split.personId,
          amountPaise: split.amountPaise,
          direction: split.direction,
          settled: split.settled,
        }))
      ),
    [splits]
  );

  const save = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      if (editing) await renamePerson(db, editing.id, name);
      else await createPerson(db, name);
      setEditing(null);
      setNewName('');
      await load();
      onChanged();
    } catch {
      Alert.alert('Already there', `You already have someone called "${name}".`);
    } finally {
      setBusy(false);
    }
  };

  // Alert.prompt is iOS only, so renaming happens in the field above rather
  // than in a dialog that would never appear on Android.
  const startRename = (person: Person) => {
    setEditing(person);
    setNewName(person.name);
  };

  const cancelRename = () => {
    setEditing(null);
    setNewName('');
  };

  /**
   * Settling marks every outstanding share with this person as paid. It does not
   * create a transaction: the repayment usually arrives as its own SMS, and
   * inventing a second entry for it would double-count the money.
   */
  const settle = (person: Person) => {
    const net = balances.get(person.id) ?? 0;
    if (net === 0) return;

    const owesYou = net > 0;
    Alert.alert(
      owesYou ? `${person.name} paid you back?` : `You paid ${person.name} back?`,
      `${formatMoney(Math.abs(net))} will be marked as settled. Your spending totals do not change — that money was already counted as ${owesYou ? 'lent out' : 'your share'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark settled',
          onPress: () => {
            void (async () => {
              await settleUpWith(db, person.id);
              await load();
              onChanged();
            })();
          },
        },
      ]
    );
  };

  const remove = (person: Person) => {
    Alert.alert('Remove this person?', `"${person.name}" and their share of past payments.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Hide',
        onPress: () => {
          void (async () => {
            await setPersonArchived(db, person.id, !person.archived);
            await load();
          })();
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deletePerson(db, person.id);
              await load();
              onChanged();
            } catch (error) {
              Alert.alert(
                'Not yet',
                String(error instanceof Error ? error.message : error)
              );
            }
          })();
        },
      },
    ]);
  };

  const renderPerson = (person: Person, index: number) => {
    const net = balances.get(person.id) ?? 0;
    return (
      <View
        key={person.id}
        style={[
          styles.row,
          index > 0
            ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }
            : null,
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Rename this person"
          onPress={() => startRename(person)}
          style={styles.grow}>
          <Text
            style={[styles.rowTitle, { color: person.archived ? theme.textMuted : theme.text }]}>
            {person.name}
          </Text>
          <Text
            style={[
              styles.rowMeta,
              { color: net === 0 ? theme.textMuted : net > 0 ? theme.credit : theme.debit },
            ]}>
            {net === 0
              ? 'All square'
              : net > 0
                ? `owes you ${formatMoney(net)}`
                : `you owe ${formatMoney(-net)}`}
          </Text>
        </Pressable>
        {person.archived ? <Badge label="HIDDEN" tone="warn" /> : null}
        {net !== 0 ? <Button label="Settle" onPress={() => settle(person)} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove person"
          onPress={() => remove(person)}
          hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={18} color={theme.textMuted} />
        </Pressable>
      </View>
    );
  };

  const active = people.filter((person) => !person.archived);
  const hidden = people.filter((person) => person.archived);

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.container}>
      <View style={styles.pageHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Setup"
          onPress={onBack}
          hitSlop={10}
          style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.pageTitle, { color: theme.text }]}>People</Text>
      </View>

      <Card>
        <View style={styles.totalsRow}>
          <View style={styles.grow}>
            <Text style={[styles.label, { color: theme.textMuted }]}>Owed to you</Text>
            <Text style={[styles.total, { color: theme.credit }]}>
              {formatMoney(totals.owedToMe)}
            </Text>
          </View>
          <View style={styles.grow}>
            <Text style={[styles.label, { color: theme.textMuted }]}>You owe</Text>
            <Text style={[styles.total, { color: theme.debit }]}>{formatMoney(totals.iOwe)}</Text>
          </View>
        </View>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          Split a payment from its entry in History, and whatever you fronted for someone shows up
          here instead of counting as your spending.
        </Text>
      </Card>

      <SectionTitle>{editing ? `Rename ${editing.name}` : 'Add someone'}</SectionTitle>
      <Card>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="Rahul"
          placeholderTextColor={theme.textMuted}
          onSubmitEditing={() => void save()}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />
        <View style={styles.buttonRow}>
          {editing ? <Button label="Cancel" onPress={cancelRename} style={styles.grow} /> : null}
          <Button
            label={editing ? 'Save name' : 'Add'}
            tone="primary"
            onPress={() => void save()}
            disabled={busy || !newName.trim()}
            style={styles.grow}
          />
        </View>
      </Card>

      <SectionTitle>Everyone</SectionTitle>
      {active.length === 0 ? (
        <EmptyState
          title="Nobody yet"
          hint="Add the people you share bills with, then split a payment in History."
        />
      ) : (
        <Card>{active.map(renderPerson)}</Card>
      )}

      {hidden.length > 0 ? (
        <>
          <SectionTitle>Hidden</SectionTitle>
          <Card>{hidden.map(renderPerson)}</Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xxl },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  pageTitle: { fontSize: 20, fontWeight: '800' },
  backButton: { marginLeft: -spacing.xs },
  totalsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  total: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  spaced: { marginTop: spacing.md },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  grow: { flex: 1 },
  input: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
  },
});
