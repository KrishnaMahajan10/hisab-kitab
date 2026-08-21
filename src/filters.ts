import { periodRange, type Period, type Range } from './period';

export const SOURCE_FILTERS = ['All', 'SMS', 'Notification', 'PDF', 'Manual'] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];

export const SOURCE_TO_QUERY: Record<
  SourceFilter,
  'all' | 'sms' | 'notification' | 'statement' | 'manual'
> = {
  All: 'all',
  SMS: 'sms',
  Notification: 'notification',
  PDF: 'statement',
  Manual: 'manual',
};

export type HistoryFilters = {
  period: Period;
  customFrom: number | null;
  customTo: number | null;
  monthAnchor: number | null;
  source: SourceFilter;
  categories: string[];
};

export const DEFAULT_FILTERS: HistoryFilters = {
  period: 'Month',
  customFrom: null,
  customTo: null,
  monthAnchor: null,
  source: 'All',
  categories: [],
};

export function rangeOf(
  filters: HistoryFilters,
  now = new Date(),
  cycleStartDay?: number
): Range {
  return periodRange(
    filters.period,
    now,
    filters.customFrom,
    filters.customTo,
    filters.monthAnchor,
    cycleStartDay
  );
}

/**
 * Counts how many filters differ from the default, so the Filters button can
 * show a badge. Period is only "active" when it is not the default Month.
 */
export function activeFilterCount(filters: HistoryFilters): number {
  let count = 0;
  if (filters.period !== DEFAULT_FILTERS.period) count += 1;
  if (filters.source !== 'All') count += 1;
  if (filters.categories.length > 0) count += 1;
  return count;
}

export type ActiveChip = { key: string; label: string; clear: (f: HistoryFilters) => HistoryFilters };

export function activeChips(
  filters: HistoryFilters,
  cycleStartDay?: number
): ActiveChip[] {
  const chips: ActiveChip[] = [];

  chips.push({
    key: 'period',
    label: rangeOf(filters, new Date(), cycleStartDay).label,
    clear: (f) => ({
      ...f,
      period: DEFAULT_FILTERS.period,
      customFrom: null,
      customTo: null,
      monthAnchor: null,
    }),
  });

  if (filters.source !== 'All') {
    chips.push({
      key: 'source',
      label: filters.source,
      clear: (f) => ({ ...f, source: 'All' }),
    });
  }

  for (const category of filters.categories) {
    chips.push({
      key: `cat:${category}`,
      label: category,
      clear: (f) => ({ ...f, categories: f.categories.filter((c) => c !== category) }),
    });
  }

  return chips;
}
