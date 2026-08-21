import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { PERIODS, periodRange, recentMonths, type Period, type Range } from '../period';
import { usePreferences } from '../preferences';
import { formatDate, spacing, useTheme } from '../theme';
import { Button, ChipRow } from './ui';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PeriodState = {
  period: Period;
  setPeriod: (next: Period) => void;
  customFrom: number | null;
  setCustomFrom: (next: number) => void;
  customTo: number | null;
  setCustomTo: (next: number) => void;
  monthAnchor: number | null;
  setMonthAnchor: (next: number) => void;
  range: Range;
};

export function usePeriod(initial: Period = 'Month'): PeriodState {
  const { cycleStartDay } = usePreferences();
  const [period, setPeriod] = useState<Period>(initial);
  const [customFrom, setCustomFrom] = useState<number | null>(null);
  const [customTo, setCustomTo] = useState<number | null>(null);
  const [monthAnchor, setMonthAnchor] = useState<number | null>(null);

  const range = useMemo(
    () => periodRange(period, new Date(), customFrom, customTo, monthAnchor, cycleStartDay),
    [period, customFrom, customTo, monthAnchor, cycleStartDay]
  );

  return {
    period,
    setPeriod,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    monthAnchor,
    setMonthAnchor,
    range,
  };
}

export function PeriodFilter({
  state,
  showLabel = true,
}: {
  state: PeriodState;
  showLabel?: boolean;
}) {
  const theme = useTheme();
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const { period, setPeriod, customFrom, customTo, monthAnchor, range } = state;
  const months = useMemo(() => recentMonths(new Date()), []);

  const fallbackFrom = customFrom ?? range.from ?? Date.now();
  const fallbackTo = customTo ?? (range.to ?? Date.now()) - DAY_MS;

  return (
    <View>
      {showLabel ? (
        <Text style={[styles.label, { color: theme.textMuted }]}>Period</Text>
      ) : null}
      <ChipRow options={PERIODS} value={period} onChange={setPeriod} />

      {period === 'Pick month' ? (
        <View style={styles.monthRow}>
          <ChipRow
            options={months.map((month) => month.short)}
            value={
              months.find((month) => month.anchor === monthAnchor)?.short ?? months[0].short
            }
            onChange={(short) => {
              const picked = months.find((month) => month.short === short);
              if (picked) state.setMonthAnchor(picked.anchor);
            }}
          />
        </View>
      ) : null}

      {period === 'Custom' ? (
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
      ) : null}

      {picker ? (
        <DateTimePicker
          value={new Date(picker === 'from' ? fallbackFrom : fallbackTo)}
          mode="date"
          display={Platform.OS === 'android' ? 'calendar' : 'default'}
          onChange={(event, selected) => {
            const which = picker;
            setPicker(null);
            if (event.type === 'dismissed' || !selected || !which) return;
            if (which === 'from') state.setCustomFrom(selected.getTime());
            else state.setCustomTo(selected.getTime());
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  monthRow: { marginTop: spacing.sm },
  rangeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  grow: { flex: 1 },
});
