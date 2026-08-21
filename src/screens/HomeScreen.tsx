import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { Card, EmptyState, SectionTitle } from '../components/ui';
import { PeriodFilter, usePeriod } from '../components/PeriodFilter';
import { rangeSummary, type RangeSummary } from '../db/repo';
import { drainCaptures } from '../sync';
import { formatMoney, spacing, useTheme } from '../theme';

export default function HomeScreen({
  refreshToken,
  onChanged,
}: {
  refreshToken: number;
  onChanged: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const periodState = usePeriod('Month');
  const { range } = periodState;

  const [summary, setSummary] = useState<RangeSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setSummary(await rangeSummary(db, range.from, range.to));
  }, [db, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await drainCaptures(db);
    await load();
    onChanged();
    setRefreshing(false);
  }, [db, load, onChanged]);

  const spent = summary?.spent ?? 0;
  const earned = summary?.earned ?? 0;
  const net = earned - spent;
  const moved = summary?.moved ?? 0;
  const count = summary?.count ?? 0;
  const maxCategory = summary?.byCategory[0]?.total ?? 1;
  const isEmpty = count === 0;

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />
      }>
      <PeriodFilter state={periodState} showLabel={false} />

      <Card style={styles.headline}>
        <Text style={[styles.rangeLabel, { color: theme.textMuted }]}>{range.label}</Text>
        <Text style={[styles.label, { color: theme.textMuted }]}>Spent</Text>
        <Text style={[styles.big, { color: theme.text }]}>{formatMoney(spent)}</Text>
        <View style={styles.splitRow}>
          <View style={styles.splitItem}>
            <Text style={[styles.label, { color: theme.textMuted }]}>Received</Text>
            <Text style={[styles.medium, { color: theme.credit }]}>{formatMoney(earned)}</Text>
          </View>
          <View style={styles.splitItem}>
            <Text style={[styles.label, { color: theme.textMuted }]}>Net</Text>
            <Text style={[styles.medium, { color: net >= 0 ? theme.credit : theme.debit }]}>
              {net >= 0 ? '+' : '−'}
              {formatMoney(net)}
            </Text>
          </View>
          <View style={styles.splitItem}>
            <Text style={[styles.label, { color: theme.textMuted }]}>Entries</Text>
            <Text style={[styles.medium, { color: theme.text }]}>{count}</Text>
          </View>
        </View>
        {moved > 0 ? (
          <Text style={[styles.movedNote, { color: theme.textMuted }]}>
            {formatMoney(moved)} moved between your own accounts or to cash — not counted as
            spending
          </Text>
        ) : null}
      </Card>

      {isEmpty ? (
        <EmptyState
          title={`Nothing in ${range.label}`}
          hint="Pick a wider period, confirm items in Review, or import a statement from Setup."
        />
      ) : null}

      {summary && summary.byCategory.length > 0 ? (
        <>
          <SectionTitle>Where it went</SectionTitle>
          <Card>
            {summary.byCategory.map((entry) => (
              <View key={entry.category} style={styles.barRow}>
                <View style={styles.barHeader}>
                  <Text style={[styles.barLabel, { color: theme.text }]}>{entry.category}</Text>
                  <Text style={[styles.barValue, { color: theme.textMuted }]}>
                    {formatMoney(entry.total)}
                  </Text>
                </View>
                <View style={[styles.barTrack, { backgroundColor: theme.surfaceAlt }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        backgroundColor: theme.accent,
                        width: `${Math.max(3, (entry.total / maxCategory) * 100)}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {summary && summary.byAccount.length > 0 ? (
        <>
          <SectionTitle>By account</SectionTitle>
          <Card>
            {summary.byAccount.map((entry, index) => (
              <View key={`${entry.account_name ?? 'none'}-${index}`} style={styles.listRow}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>
                  {entry.account_name ?? 'Unassigned'}
                </Text>
                <Text style={[styles.rowValue, { color: theme.textMuted }]}>
                  {formatMoney(entry.total)}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headline: { marginTop: spacing.md },
  rangeLabel: { fontSize: 13, fontWeight: '700', marginBottom: spacing.sm },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  big: { fontSize: 34, fontWeight: '800', marginTop: spacing.xs },
  movedNote: { fontSize: 11, lineHeight: 16, marginTop: spacing.md },
  medium: { fontSize: 17, fontWeight: '700', marginTop: 2 },
  splitRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg },
  splitItem: { flex: 1 },
  barRow: { marginBottom: spacing.md },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  barLabel: { fontSize: 14, fontWeight: '600' },
  barValue: { fontSize: 13 },
  barTrack: { height: 7, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 999 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowValue: { fontSize: 15, fontWeight: '700' },
});
