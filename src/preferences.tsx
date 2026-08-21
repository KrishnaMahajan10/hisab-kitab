import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { getSetting, setSetting } from './db/repo';
import { DEFAULT_CYCLE_START_DAY } from './period';

export const CYCLE_START_DAY_KEY = 'cycle.startDay';

/**
 * A cycle can start on any day from the 1st to the 28th. Days beyond that would
 * not exist in February, and a cycle that silently moves is worse than one you
 * cannot set.
 */
export const MAX_CYCLE_START_DAY = 28;

export function normalizeCycleStartDay(value: unknown): number {
  const day = Math.trunc(Number(value));
  if (!Number.isFinite(day) || day < 1 || day > MAX_CYCLE_START_DAY) {
    return DEFAULT_CYCLE_START_DAY;
  }
  return day;
}

type PreferencesValue = {
  cycleStartDay: number;
  setCycleStartDay: (day: number) => Promise<void>;
  ready: boolean;
};

const PreferencesContext = createContext<PreferencesValue>({
  cycleStartDay: DEFAULT_CYCLE_START_DAY,
  setCycleStartDay: async () => {},
  ready: false,
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [cycleStartDay, setDay] = useState(DEFAULT_CYCLE_START_DAY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      setDay(normalizeCycleStartDay(await getSetting(db, CYCLE_START_DAY_KEY)));
      setReady(true);
    })();
  }, [db]);

  const persist = useCallback(
    async (day: number) => {
      const clean = normalizeCycleStartDay(day);
      await setSetting(db, CYCLE_START_DAY_KEY, String(clean));
      setDay(clean);
    },
    [db]
  );

  const value = useMemo<PreferencesValue>(
    () => ({ cycleStartDay, setCycleStartDay: persist, ready }),
    [cycleStartDay, persist, ready]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  return useContext(PreferencesContext);
}
