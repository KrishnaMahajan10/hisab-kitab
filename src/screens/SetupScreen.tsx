import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

import HisabCapture from '../../modules/hisab-capture';
import { Badge, Button, Card, ChipRow, SectionTitle } from '../components/ui';
import {
  createAccount,
  listAccounts,
  type Account,
  type AccountKind,
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
import RulesScreen from './RulesScreen';
import { backfillLastDays } from '../sync';
import { formatMoney, spacing, useTheme } from '../theme';

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

  const refreshStatus = useCallback(async () => {
    setAccounts(await listAccounts(db));
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

  const requestSms = async () => {
    if (Platform.OS !== 'android') return;
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    await refreshStatus();
  };

  const requestNotifications = async () => {
    await Notifications.requestPermissionsAsync();
    await Notifications.setNotificationChannelAsync('hisab_capture', {
      name: 'Transactions to review',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  };

  const runBackfill = async (days: number) => {
    if (!smsGranted) {
      Alert.alert('SMS access needed', 'Grant SMS permission first.');
      return;
    }
    setBusy(true);
    const result = await backfillLastDays(db, days);
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
    try {
      await createAccount(db, {
        name: trimmed,
        kind,
        last4: digits.length === 4 ? digits : null,
      });
    } catch {
      Alert.alert('Already exists', 'An account with those last 4 digits already exists.');
      return;
    }
    setName('');
    setLast4('');
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
        </Text>
        <View style={styles.buttonRow}>
          <Button
            label="Last 30 days"
            onPress={() => void runBackfill(30)}
            disabled={busy}
            style={styles.grow}
          />
          <Button
            label="Last 90 days"
            onPress={() => void runBackfill(90)}
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
        {accounts.map((account) => (
          <View key={account.id} style={styles.statusRow}>
            <View style={styles.grow}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>{account.name}</Text>
              <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                {account.kind.replace('_', ' ')}
                {account.last4 ? ` · ••${account.last4}` : ''}
              </Text>
            </View>
            <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
              {formatMoney(account.opening_balance)}
            </Text>
          </View>
        ))}
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
        <Button
          label="Add account"
          tone="primary"
          onPress={() => void addAccount()}
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
});
