import { useState } from 'react';
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

import { useCategories } from '../categories';
import { Badge, Button, Card, ChipRow, EmptyState, SectionTitle } from '../components/ui';
import {
  countCategoryUsage,
  createCategory,
  deleteCategory,
  normalizeCategoryName,
  renameCategory,
  setCategoryArchived,
  updateCategoryFlags,
  type CategoryKind,
  type CategoryRecord,
} from '../db/repo';
import { spacing, useTheme } from '../theme';

const KIND_OPTIONS = ['Expense', 'Income', 'Both'] as const;
type KindOption = (typeof KIND_OPTIONS)[number];

const TO_KIND: Record<KindOption, CategoryKind> = {
  Expense: 'expense',
  Income: 'income',
  Both: 'both',
};

const FROM_KIND: Record<CategoryKind, KindOption> = {
  expense: 'Expense',
  income: 'Income',
  both: 'Both',
};

type Draft = {
  id: number | null;
  name: string;
  kind: KindOption;
  moneyMoved: boolean;
};

export default function CategoriesScreen({
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

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await categories.reload();
    onChanged();
  };

  const save = async () => {
    if (!draft) return;

    const name = normalizeCategoryName(draft.name);
    if (!name) {
      Alert.alert('Give it a name', 'A category needs a name.');
      return;
    }

    const clash = categories.all.find(
      (category) => category.name.toLowerCase() === name.toLowerCase() && category.id !== draft.id
    );
    if (clash) {
      Alert.alert('Already exists', `You already have a category called "${clash.name}".`);
      return;
    }

    setBusy(true);
    try {
      if (draft.id === null) {
        await createCategory(db, {
          name,
          kind: TO_KIND[draft.kind],
          moneyMoved: draft.moneyMoved,
        });
      } else {
        // The rename runs first: the flags update would otherwise be applied to
        // a row whose name the transactions no longer agree with.
        const moved = await renameCategory(db, draft.id, name);
        await updateCategoryFlags(db, draft.id, {
          kind: TO_KIND[draft.kind],
          moneyMoved: draft.moneyMoved,
        });
        if (moved.transactions > 0 || moved.rules > 0) {
          Alert.alert(
            'Renamed',
            `${moved.transactions} transactions and ${moved.rules} rules now use "${name}".`
          );
        }
      }
      setDraft(null);
      await refresh();
    } catch (error) {
      Alert.alert('Could not save', String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  const toggleArchived = async (category: CategoryRecord) => {
    await setCategoryArchived(db, category.id, !category.archived);
    await refresh();
  };

  /**
   * Deleting is offered only when nothing points at the category. Otherwise
   * hiding is the honest option: the transactions already filed under it keep
   * that name whatever this table says.
   */
  const remove = async (category: CategoryRecord) => {
    const usage = await countCategoryUsage(db, category.name);
    if (usage.transactions > 0 || usage.rules > 0) {
      Alert.alert(
        'Still in use',
        `"${category.name}" is used by ${usage.transactions} transactions and ${usage.rules} rules. Hide it instead — it will disappear from the pickers but those entries keep their category.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Hide it', onPress: () => void toggleArchived(category) },
        ]
      );
      return;
    }

    Alert.alert('Delete this category?', `"${category.name}" is not used by anything.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteCategory(db, category.id);
              await refresh();
            } catch (error) {
              Alert.alert('Could not delete', String(error));
            }
          })();
        },
      },
    ]);
  };

  const active = categories.all.filter((category) => !category.archived);
  const hidden = categories.all.filter((category) => category.archived);

  const renderRow = (category: CategoryRecord, index: number) => (
    <View
      key={category.id}
      style={[
        styles.row,
        index > 0
          ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }
          : null,
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Edit this category"
        onPress={() =>
          setDraft({
            id: category.id,
            name: category.name,
            kind: FROM_KIND[category.kind],
            moneyMoved: category.moneyMoved,
          })
        }
        style={styles.grow}>
        <Text
          style={[
            styles.rowTitle,
            { color: category.archived ? theme.textMuted : theme.text },
          ]}>
          {category.name}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          {FROM_KIND[category.kind]}
          {category.moneyMoved ? ' · not counted as spending' : ''}
          {category.builtin ? ' · built in' : ''}
        </Text>
      </Pressable>
      {category.archived ? <Badge label="HIDDEN" tone="warn" /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={category.archived ? 'Show category' : 'Hide category'}
        onPress={() => void toggleArchived(category)}
        hitSlop={8}>
        <Ionicons
          name={category.archived ? 'eye-outline' : 'eye-off-outline'}
          size={18}
          color={theme.textMuted}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete category"
        onPress={() => void remove(category)}
        hitSlop={8}>
        <Ionicons name="trash-outline" size={18} color={theme.textMuted} />
      </Pressable>
    </View>
  );

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
          <Text style={[styles.pageTitle, { color: theme.text }]}>Categories</Text>
        </View>

        <Card>
          <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
            Add your own categories, rename any of them, or hide the ones you never use. Renaming
            one updates every transaction and rule that uses it.
          </Text>
          <Button
            label="New category"
            tone="primary"
            onPress={() => setDraft({ id: null, name: '', kind: 'Expense', moneyMoved: false })}
            disabled={busy}
            style={styles.spaced}
          />
        </Card>

        <SectionTitle>In use ({active.length})</SectionTitle>
        <Card>{active.map(renderRow)}</Card>

        <SectionTitle>Hidden</SectionTitle>
        {hidden.length === 0 ? (
          <EmptyState
            title="Nothing hidden"
            hint="Hiding a category keeps old transactions but drops it from the pickers."
          />
        ) : (
          <Card>{hidden.map(renderRow)}</Card>
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
                    {draft.id === null ? 'New category' : 'Edit category'}
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
                  <Text style={[styles.label, { color: theme.textMuted }]}>Name</Text>
                  <TextInput
                    value={draft.name}
                    onChangeText={(text) =>
                      setDraft((previous) => (previous ? { ...previous, name: text } : previous))
                    }
                    placeholder="Chai & snacks"
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

                  <Text style={[styles.label, { color: theme.textMuted }]}>Shows up for</Text>
                  <ChipRow
                    options={KIND_OPTIONS}
                    value={draft.kind}
                    onChange={(next) =>
                      setDraft((previous) => (previous ? { ...previous, kind: next } : previous))
                    }
                  />

                  <View style={styles.switchRow}>
                    <View style={styles.grow}>
                      <Text style={[styles.rowTitle, { color: theme.text }]}>
                        Money moved, not spent
                      </Text>
                      <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                        Keep it out of your spending and income totals — for transfers between your
                        own accounts, card payments and cash withdrawals.
                      </Text>
                    </View>
                    <Switch
                      value={draft.moneyMoved}
                      onValueChange={(next) =>
                        setDraft((previous) =>
                          previous ? { ...previous, moneyMoved: next } : previous
                        )
                      }
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
                    label="Save"
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  spaced: { marginTop: spacing.md },
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
    gap: spacing.md,
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
