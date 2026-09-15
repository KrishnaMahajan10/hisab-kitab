import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  PermissionsAndroid,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

import HisabCapture from '../../modules/hisab-capture';
import { Badge, Button, Card, ChipRow, SectionTitle } from '../components/ui';
import {
  accountStandings,
  balanceStanding,
  createAccount,
  deleteBalanceSnapshot,
  listAccounts,
  recordBalanceSnapshot,
  type Account,
  type AccountKind,
  type AccountStanding,
  type BalanceStanding,
} from '../db/repo';
import {
  applyBackup,
  backupToDrive,
  buildBackup,
  connect as connectDrive,
  disconnect as disconnectDrive,
  isConfigured as isDriveConfigured,
  isConnected as isDriveConnected,
  lastDriveBackupAt,
  parseBackup,
  restoreLatestFromDrive,
} from '../backup';
import { importStatementFile, STATEMENT_MIME_TYPES } from '../import/statement';
import CategoriesScreen from './CategoriesScreen';
import PeopleScreen from './PeopleScreen';
import RulesScreen from './RulesScreen';
import { backfillSince } from '../sync';
import { parseBalanceInput, readingTakenAt } from '../balance';
import { periodRange } from '../period';
import { MAX_CYCLE_START_DAY, usePreferences } from '../preferences';
import { brand, formatDate, formatDateTime, formatMoney, spacing, useTheme } from '../theme';

const DAY_MS = 24 * 60 * 60 * 1000;

const ACCOUNT_KINDS: readonly AccountKind[] = [
  'credit_card',
  'debit_card',
  'upi',
  'cash',
  'bank',
];

export default function SetupScreen({ onChanged }: { onChanged: () => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { cycleStartDay, setCycleStartDay } = usePreferences();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [smsGranted, setSmsGranted] = useState(false);
  const [notifAccess, setNotifAccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('credit_card');
  const [last4, setLast4] = useState('');
  const [pdfPassword, setPdfPassword] = useState('');
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveLastBackup, setDriveLastBackup] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [cycleDraft, setCycleDraft] = useState('');
  const [standing, setStanding] = useState<BalanceStanding | null>(null);
  const [balanceDraft, setBalanceDraft] = useState('');
  const [balanceDate, setBalanceDate] = useState(() => new Date());
  const [balancePicker, setBalancePicker] = useState(false);
  const [accountBalanceDraft, setAccountBalanceDraft] = useState('');
  const [accountStands, setAccountStands] = useState<AccountStanding[]>([]);
  const [editingAccount, setEditingAccount] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const refreshStatus = useCallback(async () => {
    setAccounts(await listAccounts(db));
    setStanding(await balanceStanding(db));
    setAccountStands(await accountStandings(db));
    setDriveConnected(await isDriveConnected());
    setDriveLastBackup(await lastDriveBackupAt(db));
    try {
      setSmsGranted(HisabCapture.hasSmsPermission());
      setNotifAccess(HisabCapture.isNotificationAccessGranted());
    } catch {
      setSmsGranted(false);
      setNotifAccess(false);
    }
  }, [db]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    setCycleDraft(String(cycleStartDay));
  }, [cycleStartDay]);

  /**
   * Android stops showing the prompt once it has been denied twice, and on
   * Android 13+ it refuses outright for apps installed outside the Play Store
   * until restricted settings are unblocked. Either way the request returns
   * quietly, so without this the button looks broken. Send the user to the one
   * screen where the permission can still be granted.
   */
  const requestSms = async () => {
    if (Platform.OS !== 'android') return;

    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    await refreshStatus();

    const outcomes = Object.values(result);
    if (outcomes.every((outcome) => outcome === 'granted')) return;

    const blocked = outcomes.some((outcome) => outcome === 'never_ask_again');
    Alert.alert(
      blocked ? 'Android is blocking this' : 'SMS access not granted',
      blocked
        ? 'Android will not ask again, so it has to be turned on by hand:\n\n' +
            '1. Open app settings below\n' +
            '2. Tap Permissions, then SMS, then Allow\n\n' +
            'If SMS is greyed out, tap the three dots at the top of the app info ' +
            'screen and choose "Allow restricted settings" first. Android does this ' +
            'to apps installed outside the Play Store.'
        : 'Without SMS access, transactions can only be captured from payment app notifications.',
      blocked
        ? [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open app settings', onPress: () => void Linking.openSettings() },
          ]
        : [{ text: 'OK' }]
    );
  };

  // The cycle the current setting produces, so the effect of the number is
  // visible before it is trusted with the totals — and so the importer can line
  // its scan up with the same boundary the totals use.
  const cycleRange = useMemo(
    () => periodRange('Month', new Date(), null, null, null, cycleStartDay),
    [cycleStartDay]
  );

  // 'Month' always resolves to a bounded range; the null is only there for All.
  const cycleStart = cycleRange.from ?? Date.now();

  const cycleHint =
    cycleStartDay === 1
      ? `Calendar month — currently ${cycleRange.label}`
      : `This month runs ${cycleRange.label}`;

  const saveCycleDay = async () => {
    const day = Number.parseInt(cycleDraft, 10);
    if (!Number.isFinite(day) || day < 1 || day > MAX_CYCLE_START_DAY) {
      Alert.alert(
        'Pick a day between 1 and ' + MAX_CYCLE_START_DAY,
        'Later days are not offered because they do not exist in February, and a cycle that ' +
          'silently moves month to month would make your totals hard to trust.'
      );
      setCycleDraft(String(cycleStartDay));
      return;
    }
    if (day === cycleStartDay) return;
    await setCycleStartDay(day);
    onChanged();
  };

  const balanceIsToday = useMemo(() => {
    const today = new Date();
    return (
      balanceDate.getFullYear() === today.getFullYear() &&
      balanceDate.getMonth() === today.getMonth() &&
      balanceDate.getDate() === today.getDate()
    );
  }, [balanceDate]);

  // Resolved on every render rather than pinned when the date was picked, so a
  // reading saved as "today" is stamped with the moment Save was pressed.
  const readingAt = readingTakenAt(balanceDate, new Date());

  const balanceHint = balanceIsToday
    ? 'Anything you already paid today is part of the figure you just read, so it is not taken off again. Only what comes in after this counts.'
    : `Everything from the start of ${formatDate(readingAt)} counts against this reading.`;

  const saveBalance = async () => {
    const amountPaise = parseBalanceInput(balanceDraft);
    if (amountPaise === null) {
      Alert.alert(
        'Enter a balance',
        'Type what you have as a number, like 45000. Leave out the rupee sign.'
      );
      return;
    }

    setBusy(true);
    try {
      await recordBalanceSnapshot(db, {
        amountPaise,
        asOf: readingTakenAt(balanceDate, new Date()),
      });
      setBalanceDraft('');
      setBalanceDate(new Date());
      await refreshStatus();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Removing the latest reading falls back to the one before it, and the running
   * balance re-applies everything since that older moment. That is the intended
   * way out of a mistyped figure, so it is worth spelling out before it happens.
   */
  const confirmClearBalance = () => {
    if (!standing) return;
    Alert.alert(
      'Remove this reading?',
      'The balance goes back to whatever you said before it, or disappears if this was your first.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteBalanceSnapshot(db, standing.snapshot.id);
              await refreshStatus();
              onChanged();
            })();
          },
        },
      ]
    );
  };

  const requestNotifications = async () => {
    await Notifications.requestPermissionsAsync();
    await Notifications.setNotificationChannelAsync('hisab_capture', {
      name: 'Transactions to review',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  };

  const runBackfill = async (since: number) => {
    if (!smsGranted) {
      Alert.alert('SMS access needed', 'Grant SMS permission first.');
      return;
    }
    setBusy(true);
    const result = await backfillSince(db, since);
    setBusy(false);
    onChanged();
    Alert.alert(
      'Import finished',
      `${result.imported} transactions queued for review. ${result.skipped} skipped as duplicates or unreadable.`
    );
  };

  const importStatement = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: STATEMENT_MIME_TYPES,
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];

    setBusy(true);
    const password = pdfPassword.trim() || null;
    const outcome = await importStatementFile(db, asset.uri, asset.name ?? null, password);
    setBusy(false);

    if (outcome.status === 'ok') {
      setPdfPassword('');
      onChanged();
      const parts = [`${outcome.imported} transactions queued for review.`];
      if (outcome.replaced > 0) {
        parts.push(
          `${outcome.replaced} replaced an SMS entry with the same transaction ID, so those review requests are gone.`
        );
      }
      if (outcome.duplicates > 0) {
        parts.push(`${outcome.duplicates} skipped as already recorded.`);
      }
      if (outcome.unparsed > 0) parts.push(`${outcome.unparsed} lines could not be read.`);
      Alert.alert('Statement imported', parts.join(' '));
      return;
    }

    if (outcome.status === 'needs-password') {
      Alert.alert(
        'Password needed',
        'This PDF is protected. Type the password in the field above, then pick the file again.'
      );
      return;
    }

    if (outcome.status === 'unsupported') {
      Alert.alert(
        'Statement not recognised',
        outcome.preview.slice(0, 400)
      );
      return;
    }

    Alert.alert('Import failed', outcome.message);
  };

  /**
   * Cash is seeded on first run and a "Card ••1234" is created the moment a bank
   * message names one, so neither ever passes through the add form. Without this
   * those accounts could never be given a balance at all.
   */
  const startEditingAccount = (entry: AccountStanding) => {
    setEditingAccount(entry.account.id);
    setEditDraft(entry.balance === null ? '' : String(entry.balance / 100));
  };

  const saveAccountBalance = async (accountId: number) => {
    const amountPaise = parseBalanceInput(editDraft);
    if (amountPaise === null) {
      Alert.alert(
        'Enter a balance',
        'Type what is in this account right now, like 45000. Type 0 if it is empty.'
      );
      return;
    }

    // A fresh reading rather than an edit of the old one: what the account held
    // last month is still true of last month, and the row is worth keeping.
    await recordBalanceSnapshot(db, { accountId, amountPaise, asOf: Date.now() });
    setEditingAccount(null);
    setEditDraft('');
    await refreshStatus();
    onChanged();
  };

  const addAccount = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Give the account a name.');
      return;
    }
    const digits = last4.replace(/\D/g, '');
    if (digits.length > 0 && digits.length !== 4) {
      Alert.alert('Invalid last 4', 'Enter exactly 4 digits, or leave it blank.');
      return;
    }
    // An account added by hand has to start with a balance, or it can never say
    // anything useful: with no reading there is nothing for its payments to move.
    // Type 0 for an account that really is empty.
    const openingPaise = parseBalanceInput(accountBalanceDraft);
    if (openingPaise === null) {
      Alert.alert(
        'Balance required',
        'Enter what is in this account right now, as a number like 45000. Type 0 if it is empty.'
      );
      return;
    }

    let accountId: number;
    try {
      accountId = await createAccount(db, {
        name: trimmed,
        kind,
        last4: digits.length === 4 ? digits : null,
      });
    } catch {
      Alert.alert('Already exists', 'An account with those last 4 digits already exists.');
      return;
    }

    await recordBalanceSnapshot(db, {
      accountId,
      amountPaise: openingPaise,
      asOf: Date.now(),
    });

    setName('');
    setLast4('');
    setAccountBalanceDraft('');
    await refreshStatus();
    onChanged();
  };

  const exportBackup = async () => {
    setBusy(true);
    try {
      const payload = await buildBackup(db);

      const stamp = new Date().toISOString().slice(0, 10);
      const file = new File(Paths.cache, `hisab-backup-${stamp}.json`);
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(payload, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Save Hisab backup to Drive',
        });
      } else {
        Alert.alert('Backup written', file.uri);
      }
    } catch (error) {
      Alert.alert('Export failed', String(error));
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    Alert.alert(
      'Replace all data?',
      'Restoring a backup deletes every transaction and account currently in the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                const raw = await new File(picked.assets[0].uri).text();
                await applyBackup(db, parseBackup(raw));

                await refreshStatus();
                onChanged();
                Alert.alert('Restored', 'Backup imported successfully.');
              } catch (error) {
                Alert.alert('Import failed', String(error));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ]
    );
  };

  const toggleDrive = async () => {
    setBusy(true);
    try {
      if (driveConnected) {
        await disconnectDrive();
      } else if (!(await connectDrive())) {
        return;
      }
      await refreshStatus();
    } catch (error) {
      Alert.alert('Google Drive', String(error));
    } finally {
      setBusy(false);
    }
  };

  const backupNow = async () => {
    setBusy(true);
    try {
      const uploaded = await backupToDrive(db);
      await refreshStatus();
      Alert.alert('Backed up', `Saved ${uploaded.name} to Google Drive.`);
    } catch (error) {
      Alert.alert('Backup failed', String(error));
    } finally {
      setBusy(false);
    }
  };

  const restoreFromDrive = () => {
    Alert.alert(
      'Replace all data?',
      'Restoring the latest Drive backup deletes every transaction and account currently in the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                const restored = await restoreLatestFromDrive(db);
                await refreshStatus();
                onChanged();
                Alert.alert('Restored', `Loaded ${restored.name} from Google Drive.`);
              } catch (error) {
                Alert.alert('Restore failed', String(error));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ]
    );
  };

  if (showRules) {
    return <RulesScreen onChanged={onChanged} onBack={() => setShowRules(false)} />;
  }

  if (showPeople) {
    return <PeopleScreen onChanged={onChanged} onBack={() => setShowPeople(false)} />;
  }

  if (showCategories) {
    return (
      <CategoriesScreen onChanged={onChanged} onBack={() => setShowCategories(false)} />
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={styles.container}>
      <SectionTitle>Automatic capture</SectionTitle>
      <Card>
        <View style={styles.statusRow}>
          <View style={styles.grow}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>Bank SMS</Text>
            <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
              Reads transaction SMS from your banks
            </Text>
          </View>
          <Badge label={smsGranted ? 'ON' : 'OFF'} tone={smsGranted ? 'muted' : 'warn'} />
        </View>
        {!smsGranted ? (
          <Button label="Grant SMS access" tone="primary" onPress={() => void requestSms()} />
        ) : null}

        <View style={[styles.statusRow, styles.spaced]}>
          <View style={styles.grow}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>Payment app notifications</Text>
            <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
              GPay, PhonePe, Paytm, CRED and others
            </Text>
          </View>
          <Badge label={notifAccess ? 'ON' : 'OFF'} tone={notifAccess ? 'muted' : 'warn'} />
        </View>
        <Button
          label={notifAccess ? 'Manage notification access' : 'Enable notification access'}
          tone={notifAccess ? 'default' : 'primary'}
          onPress={() => {
            HisabCapture.openNotificationAccessSettings();
          }}
        />

        <Button
          label="Allow reminder notifications"
          onPress={() => void requestNotifications()}
          style={styles.spaced}
        />
      </Card>

      <SectionTitle>Import history</SectionTitle>
      <Card>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          Scan SMS already on this phone and queue anything that looks like a transaction.
          Anything already captured is skipped, so scanning twice costs nothing.
        </Text>
        <Button
          label={`This cycle — since ${formatDate(cycleStart)}`}
          tone="primary"
          onPress={() => void runBackfill(cycleStart)}
          disabled={busy}
          style={styles.spaced}
        />
        <View style={styles.buttonRow}>
          <Button
            label="Last 30 days"
            onPress={() => void runBackfill(Date.now() - 30 * DAY_MS)}
            disabled={busy}
            style={styles.grow}
          />
          <Button
            label="Last 90 days"
            onPress={() => void runBackfill(Date.now() - 90 * DAY_MS)}
            disabled={busy}
            style={styles.grow}
          />
        </View>
      </Card>

      <SectionTitle>Import a statement</SectionTitle>
      <Card>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          Pick a bank or wallet statement: a PhonePe PDF, or an .xls or CSV export from your
          bank. Every payment in it is parsed and queued for review. Anything already captured
          from SMS or notifications is skipped, so nothing is counted twice.
        </Text>
        <Text style={[styles.label, { color: theme.textMuted }]}>PDF password (if protected)</Text>
        <TextInput
          value={pdfPassword}
          onChangeText={setPdfPassword}
          placeholder="Leave blank if not protected"
          placeholderTextColor={theme.textMuted}
          autoCapitalize="characters"
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />
        <Button
          label="Choose statement file"
          tone="primary"
          onPress={() => void importStatement()}
          disabled={busy}
          style={styles.spaced}
        />
      </Card>

      <SectionTitle>Accounts</SectionTitle>
      <Card>
        {accountStands.map((entry) => (
          <View key={entry.account.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Set the balance of ${entry.account.name}`}
              onPress={() => startEditingAccount(entry)}
              style={styles.statusRow}>
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>
                  {entry.account.name}
                </Text>
                <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                  {entry.account.kind.replace('_', ' ')}
                  {entry.account.last4 ? ` · ••${entry.account.last4}` : ''}
                </Text>
              </View>
              {/* A balance nobody has set is unknown, not zero — saying ₹0.00
                  here would be the app inventing a number it was never told. */}
              <Text
                style={[
                  entry.balance === null ? styles.rowMeta : styles.rowTitle,
                  { color: entry.balance === null ? theme.warn : theme.text },
                ]}>
                {entry.balance === null
                  ? 'Set balance'
                  : `${entry.balance < 0 ? '−' : ''}${formatMoney(entry.balance)}`}
              </Text>
            </Pressable>

            {editingAccount === entry.account.id ? (
              <View style={styles.spaced}>
                <TextInput
                  value={editDraft}
                  onChangeText={setEditDraft}
                  keyboardType="decimal-pad"
                  autoFocus
                  placeholder="45000 — type 0 if it is empty"
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
                <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                  Read as of now. Everything tagged with this account moves it from here on.
                </Text>
                <View style={styles.buttonRow}>
                  <Button
                    label="Cancel"
                    onPress={() => setEditingAccount(null)}
                    style={styles.grow}
                  />
                  <Button
                    label="Save balance"
                    tone="primary"
                    onPress={() => void saveAccountBalance(entry.account.id)}
                    style={styles.grow}
                  />
                </View>
              </View>
            ) : null}
          </View>
        ))}
        {accountStands.length === 0 ? (
          <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
            No accounts yet. One is created automatically the first time a bank message names a
            card you have not added.
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text style={[styles.label, { color: theme.textMuted }]}>New account name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="HDFC Millennia"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />
        <Text style={[styles.label, { color: theme.textMuted }]}>Type</Text>
        <ChipRow options={ACCOUNT_KINDS} value={kind} onChange={setKind} />
        <Text style={[styles.label, { color: theme.textMuted }]}>Last 4 digits (optional)</Text>
        <TextInput
          value={last4}
          onChangeText={setLast4}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="1234"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />
        <Text style={[styles.label, { color: theme.textMuted }]}>Balance now</Text>
        <TextInput
          value={accountBalanceDraft}
          onChangeText={setAccountBalanceDraft}
          keyboardType="decimal-pad"
          placeholder="45000 — type 0 if it is empty"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          Taken as of now, and every payment tagged with this account moves it from here on. A
          bank SMS has to name the card for that to happen automatically — UPI and wallet alerts
          usually do not, so set the account by hand in Review when it matters.
        </Text>
        <Button
          label="Add account"
          tone="primary"
          onPress={() => void addAccount()}
          style={styles.spaced}
        />
      </Card>

      <SectionTitle>Shared payments</SectionTitle>
      <Card>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          When you pay for a group, split the payment in History and only your share counts as
          spending. This page shows who still owes you, and what you owe.
        </Text>
        <Button
          label="People"
          onPress={() => setShowPeople(true)}
          style={styles.spaced}
        />
      </Card>

      <SectionTitle>Balance</SectionTitle>
      <Card>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          Hisab only ever sees money moving, so it cannot know what you actually
          have until you say so once. Put in what you have right now and every
          payment captured after this moment is applied on top, so the Home screen
          can show what your balance should be and you can tally it against your
          bank app.
        </Text>

        {standing ? (
          <View style={[styles.statusRow, styles.spaced]}>
            <View style={styles.grow}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>
                {standing.balance < 0 ? '−' : ''}
                {formatMoney(standing.balance)} now
              </Text>
              <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                Reading of {formatMoney(standing.snapshot.amount_paise)} taken{' '}
                {formatDateTime(standing.snapshot.as_of)}
              </Text>
            </View>
            <Button
              label="Remove"
              tone="danger"
              onPress={confirmClearBalance}
              disabled={busy}
            />
          </View>
        ) : null}

        <Text style={[styles.label, { color: theme.textMuted }]}>
          {standing ? 'New reading' : 'What you have now'}
        </Text>
        <TextInput
          value={balanceDraft}
          onChangeText={setBalanceDraft}
          keyboardType="decimal-pad"
          placeholder="45000"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />

        <Text style={[styles.label, { color: theme.textMuted }]}>As of</Text>
        <Button
          label={balanceIsToday ? 'Today' : formatDate(readingAt)}
          onPress={() => setBalancePicker(true)}
          style={styles.spaced}
        />
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{balanceHint}</Text>

        <Button
          label={standing ? 'Save new reading' : 'Save balance'}
          tone="primary"
          onPress={() => void saveBalance()}
          disabled={busy}
          style={styles.spaced}
        />

        {balancePicker ? (
          <DateTimePicker
            value={balanceDate}
            mode="date"
            maximumDate={new Date()}
            display={Platform.OS === 'android' ? 'calendar' : 'default'}
            onChange={(event, selected) => {
              setBalancePicker(false);
              if (event.type === 'dismissed' || !selected) return;
              setBalanceDate(selected);
            }}
          />
        ) : null}
      </Card>

      <SectionTitle>Monthly cycle</SectionTitle>
      <Card>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          If your money arrives on a particular day, set it here and every monthly total will
          follow that cycle instead of the calendar month. Salary on the 7th means a month runs
          from the 7th to the 6th.
        </Text>
        <Text style={[styles.label, { color: theme.textMuted }]}>
          Month starts on day (1–{MAX_CYCLE_START_DAY})
        </Text>
        <TextInput
          value={cycleDraft}
          onChangeText={setCycleDraft}
          onBlur={() => void saveCycleDay()}
          keyboardType="number-pad"
          maxLength={2}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{cycleHint}</Text>
        <Button
          label="Save cycle"
          onPress={() => void saveCycleDay()}
          disabled={busy}
          style={styles.spaced}
        />
      </Card>

      <SectionTitle>Categories</SectionTitle>
      <Card>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          Add or rename your own categories, and write rules for how transactions get sorted
          into them.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            label="Categories"
            onPress={() => setShowCategories(true)}
            style={styles.grow}
          />
          <Button
            label="Rules"
            onPress={() => setShowRules(true)}
            style={styles.grow}
          />
        </View>
      </Card>

      <SectionTitle>Google Drive backup</SectionTitle>
      <Card>
        <View style={styles.statusRow}>
          <View style={styles.grow}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>Google Drive</Text>
            <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
              {!isDriveConfigured()
                ? 'Not available in this build'
                : driveLastBackup
                  ? `Last backup ${new Date(driveLastBackup).toLocaleString()}`
                  : 'Backups are stored in a private folder only Hisab can read'}
            </Text>
          </View>
          <Badge
            label={driveConnected ? 'ON' : 'OFF'}
            tone={driveConnected ? 'muted' : 'warn'}
          />
        </View>
        <Button
          label={driveConnected ? 'Disconnect Google Drive' : 'Connect Google Drive'}
          tone={driveConnected ? 'default' : 'primary'}
          onPress={() => void toggleDrive()}
          disabled={busy || !isDriveConfigured()}
        />
        {driveConnected ? (
          <View style={styles.buttonRow}>
            <Button
              label="Back up now"
              onPress={() => void backupNow()}
              disabled={busy}
              style={styles.grow}
            />
            <Button
              label="Restore latest"
              tone="danger"
              onPress={restoreFromDrive}
              disabled={busy}
              style={styles.grow}
            />
          </View>
        ) : null}
      </Card>

      <SectionTitle>Backup to a file</SectionTitle>
      <Card>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          Export writes a JSON file you can save or share anywhere.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            label="Export"
            onPress={() => void exportBackup()}
            disabled={busy}
            style={styles.grow}
          />
          <Button
            label="Restore"
            tone="danger"
            onPress={() => void importBackup()}
            disabled={busy}
            style={styles.grow}
          />
        </View>
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card>
        <View style={styles.aboutRow}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.aboutIcon}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.grow}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>{brand.name}</Text>
            <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
              {brand.tagline}. Everything stays on this phone.
            </Text>
            <Text style={[styles.aboutCredit, { color: theme.textMuted }]}>
              Designed &amp; implemented by{' '}
              <Text style={{ color: theme.text, fontWeight: '700' }}>{brand.author}</Text>
            </Text>
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  spaced: { marginTop: spacing.md },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: spacing.md },
  input: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  grow: { flex: 1 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  aboutIcon: { width: 56, height: 56, borderRadius: 13 },
  aboutCredit: { fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
});
