import {
  activeChips,
  activeFilterCount,
  DEFAULT_FILTERS,
  rangeOf,
  SOURCE_TO_QUERY,
  type HistoryFilters,
} from './filters';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

const withFilters = (patch: Partial<HistoryFilters>): HistoryFilters => ({
  ...DEFAULT_FILTERS,
  ...patch,
});

console.log('\nActive filter count\n');

const cases: Array<{ label: string; filters: HistoryFilters; expect: number }> = [
  { label: 'defaults', filters: DEFAULT_FILTERS, expect: 0 },
  { label: 'period changed', filters: withFilters({ period: 'Year' }), expect: 1 },
  { label: 'source changed', filters: withFilters({ source: 'PDF' }), expect: 1 },
  { label: 'one category', filters: withFilters({ categories: ['Fuel'] }), expect: 1 },
  { label: 'three categories still counts once',
    filters: withFilters({ categories: ['Fuel', 'Groceries', 'Health'] }), expect: 1 },
  { label: 'period + source + categories',
    filters: withFilters({ period: 'Year', source: 'SMS', categories: ['Fuel'] }), expect: 3 },
  { label: 'explicit Month is still default', filters: withFilters({ period: 'Month' }), expect: 0 },
];

for (const c of cases) {
  const got = activeFilterCount(c.filters);
  check(c.label, got === c.expect, `got ${got}, want ${c.expect}`);
  console.log(`  ${String(got)}  ${c.label}`);
}

console.log('\nActive chips\n');

const defaults = activeChips(DEFAULT_FILTERS);
check('defaults show only the period chip', defaults.length === 1, `${defaults.length}`);
check('period chip is labelled with the range', defaults[0].label === rangeOf(DEFAULT_FILTERS).label);
console.log(`  defaults -> [${defaults.map((c) => c.label).join(', ')}]`);

const busy = withFilters({ period: 'Year', source: 'PDF', categories: ['Fuel', 'Groceries'] });
const busyChips = activeChips(busy);
check('busy filters produce 4 chips', busyChips.length === 4, `${busyChips.length}`);
console.log(`  busy     -> [${busyChips.map((c) => c.label).join(', ')}]`);

console.log('\nRemoving chips\n');

const withoutSource = busyChips.find((c) => c.key === 'source')!.clear(busy);
check('removing source resets it to All', withoutSource.source === 'All');
check('removing source keeps categories', withoutSource.categories.length === 2);
console.log(`  cleared source   -> source=${withoutSource.source} categories=${withoutSource.categories.length}`);

const withoutFuel = busyChips.find((c) => c.key === 'cat:Fuel')!.clear(busy);
check('removing one category keeps the other', withoutFuel.categories.length === 1);
check('the remaining category is Groceries', withoutFuel.categories[0] === 'Groceries', withoutFuel.categories[0]);
console.log(`  cleared Fuel     -> categories=[${withoutFuel.categories.join(', ')}]`);

const withoutPeriod = busyChips.find((c) => c.key === 'period')!.clear(busy);
check('removing period returns to Month', withoutPeriod.period === 'Month');
check('removing period clears custom dates',
  withoutPeriod.customFrom === null && withoutPeriod.customTo === null);
console.log(`  cleared period   -> period=${withoutPeriod.period}`);

check('clearing does not mutate the original', busy.categories.length === 2 && busy.source === 'PDF');

console.log('\nSource mapping to query values\n');
for (const [label, value] of Object.entries(SOURCE_TO_QUERY)) {
  console.log(`  ${label.padEnd(13)} -> ${value}`);
}
check('PDF maps to statement', SOURCE_TO_QUERY.PDF === 'statement');
check('All maps to all', SOURCE_TO_QUERY.All === 'all');

console.log('\nPicking a month\n');

const NOW = new Date(2026, 7, 20, 18, 45, 0);
const SEPTEMBER = new Date(2026, 8, 1).getTime();

const pickedMonth = withFilters({ period: 'Pick month', monthAnchor: SEPTEMBER });
const pickedRange = rangeOf(pickedMonth, NOW);
check('the picked month drives the range', new Date(pickedRange.from!).getMonth() === 8, pickedRange.label);
check('the picked month ends at October', new Date(pickedRange.to!).getMonth() === 9);
check('picking a month counts as one active filter', activeFilterCount(pickedMonth) === 1, String(activeFilterCount(pickedMonth)));
console.log(`  period chip -> "${pickedRange.label}"`);

const monthChip = activeChips(pickedMonth).find((c) => c.key === 'period')!;
check('the chip is labelled with the month', monthChip.label === pickedRange.label, monthChip.label);

const clearedMonth = monthChip.clear(pickedMonth);
check('clearing the chip drops the anchor', clearedMonth.monthAnchor === null);
check('clearing the chip returns to this month', clearedMonth.period === 'Month');
check('clearing leaves no active filters', activeFilterCount(clearedMonth) === 0);

// An anchor left over from an earlier pick must not bend any other period.
const yearWithStaleAnchor = withFilters({ period: 'Year', monthAnchor: SEPTEMBER });
check('a stale anchor does not affect Year', rangeOf(yearWithStaleAnchor, NOW).label === '2026', rangeOf(yearWithStaleAnchor, NOW).label);
check('a stale anchor does not affect Month', rangeOf(withFilters({ monthAnchor: SEPTEMBER }), NOW).label === rangeOf(DEFAULT_FILTERS, NOW).label);

check('defaults pick no month', DEFAULT_FILTERS.monthAnchor === null);

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
