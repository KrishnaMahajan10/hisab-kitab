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

import { listCategories, type CategoryRecord } from './db/repo';

/**
 * The live category list. Categories used to be constants in the code; now they
 * live in a table the user edits, so every picker reads them from here and every
 * edit refreshes all of them at once.
 */
type CategoriesValue = {
  all: CategoryRecord[];
  forDirection: (direction: 'debit' | 'credit') => string[];
  names: string[];
  isMoneyMoved: (name: string) => boolean;
  reload: () => Promise<void>;
};

const FALLBACK: CategoriesValue = {
  all: [],
  forDirection: () => ['Other'],
  names: ['Other'],
  isMoneyMoved: () => false,
  reload: async () => {},
};

const CategoriesContext = createContext<CategoriesValue>(FALLBACK);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [all, setAll] = useState<CategoryRecord[]>([]);

  const reload = useCallback(async () => {
    setAll(await listCategories(db));
  }, [db]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<CategoriesValue>(() => {
    const active = all.filter((category) => !category.archived);
    const moved = new Set(all.filter((c) => c.moneyMoved).map((c) => c.name));

    const forDirection = (direction: 'debit' | 'credit'): string[] => {
      const wanted = direction === 'credit' ? 'income' : 'expense';
      const matching = active
        .filter((category) => category.kind === wanted || category.kind === 'both')
        .map((category) => category.name);
      // A picker with nothing in it would be a dead end, so there is always a
      // last resort.
      return matching.length > 0 ? matching : ['Other'];
    };

    return {
      all,
      forDirection,
      names: active.length > 0 ? active.map((category) => category.name) : ['Other'],
      isMoneyMoved: (name: string) => moved.has(name),
      reload,
    };
  }, [all, reload]);

  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
}

export function useCategories(): CategoriesValue {
  return useContext(CategoriesContext);
}
