import { StyleSheet, Text, View } from 'react-native';

import { sharesTotal, toggleSharePerson, type Shares } from '../splits';
import { formatMoney, spacing, useTheme } from '../theme';
import { ChipGridMulti } from './ui';

export type SplitPeople = ReadonlyArray<{ id: number; name: string }>;


/**
 * The "shared with" control used on every screen that can record an expense, so
 * splitting works the same way wherever a payment is entered or reviewed.
 */
export function SplitPicker({
  people,
  shares,
  amountPaise,
  onChange,
}: {
  people: SplitPeople;
  shares: Shares;
  amountPaise: number;
  onChange: (next: Shares) => void;
}) {
  const theme = useTheme();
  const owed = sharesTotal(shares);
  const count = Object.keys(shares).length;
  const mine = Math.max(0, amountPaise - owed);

  return (
    <View>
      <Text style={[styles.label, { color: theme.textMuted }]}>Shared with</Text>
      {people.length === 0 ? (
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          Add people in Setup → Shared payments to split a payment with them.
        </Text>
      ) : (
        <>
          <ChipGridMulti
            options={people.map((person) => person.name)}
            selected={people.filter((person) => person.id in shares).map((person) => person.name)}
            onToggle={(name) => {
              const person = people.find((entry) => entry.name === name);
              if (person) onChange(toggleSharePerson(shares, person.id, amountPaise));
            }}
          />
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            {count === 0
              ? 'Not shared — the whole amount counts as your spending.'
              : `Split ${count + 1} ways. They owe ${formatMoney(owed)}, your share is ${formatMoney(mine)}.`}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: spacing.md },
  meta: { fontSize: 12, marginTop: spacing.xs, lineHeight: 17 },
});
