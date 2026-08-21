import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';

import HisabCapture from './modules/hisab-capture';
import { DATABASE_NAME, migrate } from './src/db/schema';
import { countPending } from './src/db/repo';
import HomeScreen from './src/screens/HomeScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import AddScreen from './src/screens/AddScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SetupScreen from './src/screens/SetupScreen';
import { CategoriesProvider } from './src/categories';
import { drainCaptures } from './src/sync';
import { spacing, useTheme } from './src/theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type TabKey = 'home' | 'review' | 'add' | 'history' | 'setup';

type IoniconName = keyof typeof Ionicons.glyphMap;

const TABS: Array<{
  key: TabKey;
  label: string;
  icon: IoniconName;
  iconActive: IoniconName;
}> = [
  { key: 'home', label: 'Home', icon: 'pie-chart-outline', iconActive: 'pie-chart' },
  { key: 'review', label: 'Review', icon: 'checkmark-done-outline', iconActive: 'checkmark-done' },
  { key: 'add', label: 'Add', icon: 'add-circle-outline', iconActive: 'add-circle' },
  { key: 'history', label: 'History', icon: 'time-outline', iconActive: 'time' },
  { key: 'setup', label: 'Setup', icon: 'settings-outline', iconActive: 'settings' },
];

function Shell() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('home');
  const [refreshToken, setRefreshToken] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  const bump = useCallback(() => setRefreshToken((value) => value + 1), []);

  const syncAndCount = useCallback(async () => {
    await drainCaptures(db);
    setPendingCount(await countPending(db));
  }, [db]);

  useEffect(() => {
    void syncAndCount();
  }, [syncAndCount, refreshToken]);

  useEffect(() => {
    const subscription = HisabCapture.addListener('onCapture', () => {
      void syncAndCount().then(bump);
    });
    return () => subscription.remove();
  }, [syncAndCount, bump]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        HisabCapture.clearCaptureNotification();
        void syncAndCount().then(bump);
      }
    });
    return () => subscription.remove();
  }, [syncAndCount, bump]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={styles.content}>
        {tab === 'home' ? <HomeScreen refreshToken={refreshToken} onChanged={bump} /> : null}
        {tab === 'review' ? <ReviewScreen onChanged={bump} /> : null}
        {tab === 'add' ? <AddScreen onChanged={bump} /> : null}
        {tab === 'history' ? (
          <HistoryScreen refreshToken={refreshToken} onChanged={bump} />
        ) : null}
        {tab === 'setup' ? <SetupScreen onChanged={bump} /> : null}
      </View>

      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            paddingBottom: Math.max(insets.bottom, spacing.sm),
          },
        ]}>
        {TABS.map((entry) => {
          const active = entry.key === tab;
          const showBadge = entry.key === 'review' && pendingCount > 0;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(entry.key)}
              style={styles.tab}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name={active ? entry.iconActive : entry.icon}
                  size={23}
                  color={active ? theme.accent : theme.textMuted}
                />
                {showBadge ? (
                  <View style={[styles.dot, { backgroundColor: theme.debit }]}>
                    <Text style={styles.dotText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  { color: active ? theme.accent : theme.textMuted },
                ]}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate}>
        <CategoriesProvider>
          <Shell />
        </CategoriesProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: 3,
  },
  iconWrap: { width: 40, height: 24, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 11, fontWeight: '700' },
  dot: {
    position: 'absolute',
    top: -4,
    right: 2,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dotText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
});
