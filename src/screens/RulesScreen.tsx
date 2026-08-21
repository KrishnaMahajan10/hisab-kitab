import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, Card, ChipGrid, ChipRow, EmptyState, SectionTitle } from '../components/ui';
import {
  applyRulesToExisting,
  createRule,
  deleteRule,
  listRules,
  setRuleEnabled,
  updateRule,
  type RuleInput,
} from '../db/repo';
import { useCategories } from '../categories';
import {
  MATCH_TYPES,
  RULE_FIELDS,
  type CategoryRule,
  type MatchType,
  type RuleField,
} from '../parse/categorize';
import { formatMoney, spacing, useTheme } from '../theme';

const FIELD_LABELS: Record<RuleField, string> = {
  any: 'Anywhere',
  merchant: 'Merchant',
  title: 'Title',
  note: 'Note',
};

const MATCH_LABELS: Record<MatchType, string> = {
  contains: 'contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  equals: 'is exactly',
  regex: 'matches regex',
};

const DIRECTION_OPTIONS = ['Both', 'Expense', 'Income'] as const;
type DirectionOption = (typeof DIRECTION_OPTIONS)[number];

type Draft = {
  id: number | null;
  pattern: string;
  category: string;
  field: RuleField;
  matchType: MatchType;
  direction: DirectionOption;
  min: string;
  max: string;
  priority: string;
  enabled: boolean;
};

function blankDraft(): Draft {
  return {
    id: null,
    pattern: '',
    category: 'Food & Dining',
    field: 'any',
    matchType: 'contains',
    direction: 'Both',
    min: '',
    max: '',
    priority: '50',
    enabled: true,
  };
}

function toDraft(rule: CategoryRule): Draft {
  return {
    id: rule.id,
    pattern: rule.pattern,
    category: rule.category,
    field: rule.field,
    matchType: rule.matchType,
    direction: rule.direction === null ? 'Both' : rule.direction === 'credit' ? 'Income' : 'Expense',
    min: rule.minPaise === null ? '' : (rule.minPaise / 100).toString(),
    max: rule.maxPaise === null ? '' : (rule.maxPaise / 100).toString(),
    priority: String(rule.priority),
    enabled: rule.enabled,
  };
}

function rupeesToPaise(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number.parseFloat(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** A one-line summary of what a rule does, in the order it reads. */
function describe(rule: CategoryRule): string {
  const parts = [`${FIELD_LABELS[rule.field]} ${MATCH_LABELS[rule.matchType]} "${rule.pattern}"`];
  if (rule.direction) parts.push(rule.direction === 'credit' ? 'on income' : 'on expenses');
  if (rule.minPaise !== null && rule.maxPaise !== null) {
    parts.push(`between ${formatMoney(rule.minPaise)} and ${formatMoney(rule.maxPaise)}`);
  } else if (rule.minPaise !== null) {
    parts.push(`over ${formatMoney(rule.minPaise)}`);
  } else if (rule.maxPaise !== null) {
    parts.push(`under ${formatMoney(rule.maxPaise)}`);
  }
  return parts.join(' · ');
}

export default function RulesScreen({
  onChanged,
  onBack,
}: {
  onChanged: () => void;
  onBack: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const categories = useCategories();

  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRules(await listRules(db));
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (next: Partial<Draft>) =>
    setDraft((previous) => (previous ? { ...previous, ...next } : previous));

  const categoryOptions = useMemo<readonly string[]>(
    () =>
      draft?.direction === 'Income'
        ? categories.forDirection('credit')
        : draft?.direction === 'Expense'
          ? categories.forDirection('debit')
          : categories.names,
    [draft?.direction, categories]
  );

  const save = async () => {
    if (!draft) return;

    const pattern = draft.pattern.trim();
    if (!pattern) {
      Alert.alert('Add something to match', 'A rule needs a word or pattern to look for.');
      return;
    }

    if (draft.matchType === 'regex') {
      try {
        new RegExp(pattern);
      } catch (error) {
        Alert.alert('That regex is not valid', String(error));
        return;
      }
    }

    const minPaise = rupeesToPaise(draft.min);
    const maxPaise = rupeesToPaise(draft.max);
    if (minPaise !== null && maxPaise !== null && minPaise > maxPaise) {
      Alert.alert('Check the amounts', 'The smallest amount is larger than the largest.');
      return;
    }

    const priority = Number.parseInt(draft.priority, 10);
    const input: RuleInput = {
      pattern,
      category: draft.category,
      field: draft.field,
      matchType: draft.matchType,
      direction:
        draft.direction === 'Both' ? null : draft.direction === 'Income' ? 'credit' : 'debit',
      minPaise,
      maxPaise,
      priority: Number.isFinite(priority) ? priority : 50,
      enabled: draft.enabled,
    };

    setBusy(true);
    if (draft.id === null) await createRule(db, input);
    else await updateRule(db, draft.id, input);
    setBusy(false);

    setDraft(null);
    await load();
  };

  const remove = (rule: CategoryRule) => {
    Alert.alert('Delete this rule?', describe(rule), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteRule(db, rule.id);
            await load();
          })();
        },
      },
    ]);
  };

  const toggle = async (rule: CategoryRule) => {
    await setRuleEnabled(db, rule.id, !rule.enabled);
    await load();
  };

  /**
   * Counted first and applied only on confirmation: re-categorising is not
   * reversible, and the number is the only way to tell a useful rule from one
   * that matches half the history.
   */
  const reapply = async () => {
    setBusy(true);
    const preview = await applyRulesToExisting(db, { includeConfirmed: true, dryRun: true });
    setBusy(false);

    if (preview.changed === 0) {
      Alert.alert(
        'Nothing to change',
        `Checked ${preview.examined} transactions. None of them would move to a different category.`
      );
      return;
    }

    Alert.alert(
      'Re-categorise existing transactions?',
      `${preview.changed} of ${preview.examined} transactions would change category. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Change ${preview.changed}`,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              const applied = await applyRulesToExisting(db, {
                includeConfirmed: true,
                dryRun: false,
              });
              setBusy(false);
              await load();
              onChanged();
              Alert.alert('Done', `${applied.changed} transactions recategorised.`);
            })();
          },
        },
      ]
    );
  };

  const manual = rules.filter((rule) => rule.origin === 'manual');
  const learned = rules.filter((rule) => rule.origin === 'learned');

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={styles.container}>
        <View style={styles.pageHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Setup"
            onPress={onBack}
            hitSlop={10}
            style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <Text style={[styles.pageTitle, { color: theme.text }]}>Category rules</Text>
        </View>

        <Card>
          <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
            Rules decide the category before the built-in keyword list gets a look, so yours always
            win. They run on new transactions as they arrive; use Re-apply to sweep what is already
            here.
          </Text>
          <View style={styles.buttonRow}>
            <Button
              label="New rule"
              tone="primary"
              onPress={() => setDraft(blankDraft())}
              disabled={busy}
              style={styles.grow}
            />
            <Button
              label="Re-apply"
              onPress={() => void reapply()}
              disabled={busy || rules.length === 0}
              style={styles.grow}
            />
          </View>
        </Card>

        <SectionTitle>Your rules</SectionTitle>
        {manual.length === 0 ? (
          <EmptyState
            title="No rules yet"
            hint="Add one to force a category for anything the app keeps getting wrong."
          />
        ) : (
          <Card>
            {manual.map((rule, index) => (
              <View
                key={rule.id}
                style={[
                  styles.ruleRow,
                  index > 0
                    ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }
                    : null,
                ]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Edit this rule"
                  onPress={() => setDraft(toDraft(rule))}
                  style={styles.grow}>
                  <Text
                    style={[
                      styles.rowTitle,
                      { color: rule.enabled ? theme.text : theme.textMuted },
                    ]}>
                    {rule.category}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{describe(rule)}</Text>
                  <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                    priority {rule.priority}
                  </Text>
                </Pressable>
                <Switch value={rule.enabled} onValueChange={() => void toggle(rule)} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete rule"
                  onPress={() => remove(rule)}
                  hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={theme.textMuted} />
                </Pressable>
              </View>
            ))}
          </Card>
        )}

        <SectionTitle>Learned from your corrections</SectionTitle>
        {learned.length === 0 ? (
          <EmptyState
            title="Nothing learned yet"
            hint="Change a category in Review or History and the app remembers it here."
          />
        ) : (
          <Card>
            {learned.map((rule, index) => (
              <View
                key={rule.id}
                style={[
                  styles.ruleRow,
                  index > 0
                    ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }
                    : null,
                ]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Edit this rule"
                  onPress={() => setDraft(toDraft(rule))}
                  style={styles.grow}>
                  <Text
                    style={[
                      styles.rowTitle,
                      { color: rule.enabled ? theme.text : theme.textMuted },
                    ]}>
                    {rule.category}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                    {describe(rule)}
                  </Text>
                </Pressable>
                <Badge label={`${rule.hits}×`} tone="muted" />
                <Switch value={rule.enabled} onValueChange={() => void toggle(rule)} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete rule"
                  onPress={() => remove(rule)}
                  hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={theme.textMuted} />
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      <Modal
        visible={draft !== null}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setDraft(null)}>
        <View style={styles.backdrop}>
          <Pressable
            style={styles.backdropFill}
            accessibilityLabel="Close"
            onPress={() => setDraft(null)}
          />
          <View
            style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {draft ? (
              <>
                <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
                  <Text style={[styles.sheetTitle, { color: theme.text }]}>
                    {draft.id === null ? 'New rule' : 'Edit rule'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    onPress={() => setDraft(null)}
                    hitSlop={10}>
                    <Ionicons name="close" size={22} color={theme.textMuted} />
                  </Pressable>
                </View>

                <ScrollView
                  contentContainerStyle={styles.sheetBody}
                  keyboardShouldPersistTaps="handled">
                  <Text style={[styles.label, { color: theme.textMuted }]}>Look at</Text>
                  <ChipRow
                    options={RULE_FIELDS}
                    value={draft.field}
                    onChange={(next) => patch({ field: next })}
                  />

                  <Text style={[styles.label, { color: theme.textMuted }]}>Which</Text>
                  <ChipRow
                    options={MATCH_TYPES}
                    value={draft.matchType}
                    onChange={(next) => patch({ matchType: next })}
                  />

                  <Text style={[styles.label, { color: theme.textMuted }]}>
                    {draft.matchType === 'regex' ? 'Regular expression' : 'Text to look for'}
                  </Text>
                  <TextInput
                    value={draft.pattern}
                    onChangeText={(text) => patch({ pattern: text })}
                    placeholder={draft.matchType === 'regex' ? 'bharatpe|paytmqr' : 'bharatpe'}
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.input,
                      {
                        color: theme.text,
                        backgroundColor: theme.surfaceAlt,
                        borderColor: theme.border,
                      },
                    ]}
                  />

                  <Text style={[styles.label, { color: theme.textMuted }]}>Applies to</Text>
                  <ChipRow
                    options={DIRECTION_OPTIONS}
                    value={draft.direction}
                    onChange={(next) => {
                      const allowed: readonly string[] =
                        next === 'Income'
                          ? categories.forDirection('credit')
                          : next === 'Expense'
                            ? categories.forDirection('debit')
                            : categories.names;
                      patch({
                        direction: next,
                        category: allowed.includes(draft.category) ? draft.category : allowed[0],
                      });
                    }}
                  />

                  <Text style={[styles.label, { color: theme.textMuted }]}>
                    Amount between (optional, in rupees)
                  </Text>
                  <View style={styles.amountRow}>
                    <TextInput
                      value={draft.min}
                      onChangeText={(text) => patch({ min: text })}
                      keyboardType="decimal-pad"
                      placeholder="no minimum"
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.input,
                        styles.grow,
                        {
                          color: theme.text,
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    />
                    <TextInput
                      value={draft.max}
                      onChangeText={(text) => patch({ max: text })}
                      keyboardType="decimal-pad"
                      placeholder="no maximum"
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.input,
                        styles.grow,
                        {
                          color: theme.text,
                          backgroundColor: theme.surfaceAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    />
                  </View>

                  <Text style={[styles.label, { color: theme.textMuted }]}>Set category to</Text>
                  <ChipGrid
                    options={categoryOptions}
                    value={draft.category}
                    onChange={(next) => patch({ category: next })}
                  />

                  <Text style={[styles.label, { color: theme.textMuted }]}>
                    Priority — lower runs first
                  </Text>
                  <TextInput
                    value={draft.priority}
                    onChangeText={(text) => patch({ priority: text })}
                    keyboardType="number-pad"
                    style={[
                      styles.input,
                      {
                        color: theme.text,
                        backgroundColor: theme.surfaceAlt,
                        borderColor: theme.border,
                      },
                    ]}
                  />

                  <View style={styles.switchRow}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>Enabled</Text>
                    <Switch
                      value={draft.enabled}
                      onValueChange={(next) => patch({ enabled: next })}
                    />
                  </View>
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
                    label="Save rule"
                    tone="primary"
                    onPress={() => void save()}
                    disabled={busy}
                    style={styles.grow}
                  />
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
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
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  amountRow: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: spacing.md },
  input: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  sheetBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
