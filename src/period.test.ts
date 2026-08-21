import { periodRange, recentMonths } from './period';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

const fmt = (ms: number | null) =>
  ms === null ? 'null' : new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// Thursday 20 Aug 2026, 18:45 local
const NOW = new Date(2026, 7, 20, 18, 45, 0);

console.log('\nPeriod ranges from Thu 20 Aug 2026 18:45\n');

for (const period of ['Day', 'Week', 'Month', 'Year', 'All'] as const) {
  const r = periodRange(period, NOW, null, null);
  console.log(`  ${period.padEnd(6)} ${fmt(r.from)}  ->  ${fmt(r.to)}   "${r.label}"`);
}

const day = periodRange('Day', NOW, null, null);
check('day starts at midnight', new Date(day.from!).getHours() === 0);
check('day is exactly 24h', day.to! - day.from! === 24 * 3600 * 1000, `${day.to! - day.from!}`);
check('day contains now', NOW.getTime() >= day.from! && NOW.getTime() < day.to!);

const week = periodRange('Week', NOW, null, null);
check('week starts Monday', new Date(week.from!).getDay() === 1, `day ${new Date(week.from!).getDay()}`);
check('week is 7 days', week.to! - week.from! === 7 * 24 * 3600 * 1000);
check('week contains now', NOW.getTime() >= week.from! && NOW.getTime() < week.to!);
check('week starts 17 Aug', new Date(week.from!).getDate() === 17, `${new Date(week.from!).getDate()}`);

const month = periodRange('Month', NOW, null, null);
check('month starts on the 1st', new Date(month.from!).getDate() === 1);
check('month ends 1 Sep', new Date(month.to!).getMonth() === 8 && new Date(month.to!).getDate() === 1);
check('month label', month.label.includes('August'), month.label);

const year = periodRange('Year', NOW, null, null);
check('year starts 1 Jan 2026', new Date(year.from!).getMonth() === 0 && new Date(year.from!).getDate() === 1);
check('year ends 1 Jan 2027', new Date(year.to!).getFullYear() === 2027);
check('year label', year.label === '2026', year.label);

const all = periodRange('All', NOW, null, null);
check('all is unbounded', all.from === null && all.to === null);

console.log('\nCustom range\n');

const custom = periodRange('Custom', NOW, new Date(2026, 6, 21, 9, 30).getTime(), new Date(2026, 7, 20, 23, 10).getTime());
console.log(`  ${fmt(custom.from)}  ->  ${fmt(custom.to)}   "${custom.label}"`);
check('custom from is midnight of 21 Jul', new Date(custom.from!).getDate() === 21 && new Date(custom.from!).getHours() === 0);
check('custom to is midnight after 20 Aug', new Date(custom.to!).getDate() === 21 && new Date(custom.to!).getMonth() === 7);
check('custom includes a txn late on the end day',
  new Date(2026, 7, 20, 23, 59).getTime() < custom.to!);

const reversed = periodRange('Custom', NOW, new Date(2026, 7, 20).getTime(), new Date(2026, 6, 21).getTime());
check('reversed custom dates are normalised', reversed.from! < reversed.to!);
check('reversed spans the same window', reversed.from === custom.from && reversed.to === custom.to,
  `${fmt(reversed.from)} ${fmt(reversed.to)}`);

const emptyCustom = periodRange('Custom', NOW, null, null);
check('custom with no dates defaults to a 30 day window',
  emptyCustom.to! - emptyCustom.from! === 30 * 24 * 3600 * 1000,
  `${(emptyCustom.to! - emptyCustom.from!) / (24 * 3600 * 1000)} days`);

console.log('\nBoundary: a midnight transaction belongs to one period only\n');

const midnight = new Date(2026, 7, 20, 0, 0, 0).getTime();
const yesterday = periodRange('Day', new Date(2026, 7, 19, 12, 0), null, null);
check('midnight 20 Aug excluded from 19 Aug', midnight >= yesterday.to!);
check('midnight 20 Aug included in 20 Aug', midnight >= day.from! && midnight < day.to!);
console.log(`  19 Aug range ends ${fmt(yesterday.to)} (exclusive)`);
console.log(`  20 Aug range starts ${fmt(day.from)} (inclusive)`);

console.log('\nPick month\n');

const september = periodRange('Pick month', NOW, null, null, new Date(2026, 8, 1).getTime());
console.log(`  ${fmt(september.from)}  ->  ${fmt(september.to)}   "${september.label}"`);
check('september starts 1 Sep', new Date(september.from!).getMonth() === 8 && new Date(september.from!).getDate() === 1);
check('september ends 1 Oct', new Date(september.to!).getMonth() === 9 && new Date(september.to!).getDate() === 1);
check('september label names the month', september.label.includes('September'), september.label);
check('september is 30 days', september.to! - september.from! === 30 * 24 * 3600 * 1000);

// An anchor taken mid-month must still select the whole month.
const midMonth = periodRange('Pick month', NOW, null, null, new Date(2026, 8, 17, 22, 30).getTime());
check('a mid-month anchor snaps to the whole month', midMonth.from === september.from && midMonth.to === september.to);

const february = periodRange('Pick month', NOW, null, null, new Date(2024, 1, 1).getTime());
check('leap February is 29 days', february.to! - february.from! === 29 * 24 * 3600 * 1000, `${(february.to! - february.from!) / (24 * 3600 * 1000)}`);

const december = periodRange('Pick month', NOW, null, null, new Date(2025, 11, 1).getTime());
check('december rolls into the next year', new Date(december.to!).getFullYear() === 2026 && new Date(december.to!).getMonth() === 0);

const unpicked = periodRange('Pick month', NOW, null, null, null);
const thisMonth = periodRange('Month', NOW, null, null);
check('no month picked falls back to this month', unpicked.from === thisMonth.from && unpicked.to === thisMonth.to);

check('a september txn is inside september', new Date(2026, 8, 30, 23, 59).getTime() < september.to!);
check('an october txn is outside september', new Date(2026, 9, 1, 0, 0).getTime() >= september.to!);

console.log('\nMonth options offered by the picker\n');

const months = recentMonths(NOW, 12);
check('twelve months are offered', months.length === 12, String(months.length));
check('newest first', months[0].label.includes('August') && months[0].label.includes('2026'), months[0].label);
check('oldest is twelve back', months[11].label.includes('September') && months[11].label.includes('2025'), months[11].label);
check('anchors are the 1st at midnight', months.every((m) => {
  const d = new Date(m.anchor);
  return d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0;
}));
check('anchors are strictly descending', months.every((m, i) => i === 0 || m.anchor < months[i - 1].anchor));
check('short labels are unique', new Set(months.map((m) => m.short)).size === 12);
check('every anchor round-trips to its own month', months.every((m) => periodRange('Pick month', NOW, null, null, m.anchor).label === m.label));
console.log('  ' + months.map((m) => m.short).join('  '));

console.log('\nCustom monthly cycle — salary on the 7th\n');

const cyc = (nowDate: Date, day: number, anchor: number | null = null) =>
  periodRange(anchor === null ? 'Month' : 'Pick month', nowDate, null, null, anchor, day);

const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 20 Aug is after the 7th, so it belongs to the cycle that began 7 Aug.
const after = cyc(new Date(2026, 7, 20), 7);
check('a date after the cycle day starts this month', ymd(after.from!) === '2026-08-07', ymd(after.from!));
check('and ends on the next cycle day', ymd(after.to!) === '2026-09-07', ymd(after.to!));
console.log(`  20 Aug, cycle 7  ->  ${ymd(after.from!)} to ${ymd(after.to!)}   "${after.label}"`);

// 3 Aug is before the 7th, so it still belongs to the cycle that began 7 Jul.
const before = cyc(new Date(2026, 7, 3), 7);
check('a date before the cycle day starts last month', ymd(before.from!) === '2026-07-07', ymd(before.from!));
check('and ends on this month cycle day', ymd(before.to!) === '2026-08-07', ymd(before.to!));
console.log(`  3 Aug, cycle 7   ->  ${ymd(before.from!)} to ${ymd(before.to!)}   "${before.label}"`);

// The cycle day itself opens a new cycle rather than closing the old one.
const onDay = cyc(new Date(2026, 7, 7), 7);
check('the cycle day starts the new cycle', ymd(onDay.from!) === '2026-08-07', ymd(onDay.from!));

// Every day belongs to exactly one cycle, with no gap and no overlap.
check('one cycle ends exactly where the next begins', before.to === after.from);
check('a salary paid on the 7th lands in the cycle it opens',
  new Date(2026, 7, 7, 9, 30).getTime() >= after.from! && new Date(2026, 7, 7, 9, 30).getTime() < after.to!);
check('the 6th belongs to the previous cycle',
  new Date(2026, 7, 6, 23, 59).getTime() < after.from!);

console.log('\nCycle days that do not exist in every month\n');

// A cycle set to the 31st has to land somewhere in February.
const feb = cyc(new Date(2026, 1, 15), 31);
check('a 31st cycle clamps to the last day of February', ymd(feb.from!) === '2026-01-31', ymd(feb.from!));
check('and to the last day of the next short month', ymd(feb.to!) === '2026-02-28', ymd(feb.to!));
console.log(`  15 Feb, cycle 31 ->  ${ymd(feb.from!)} to ${ymd(feb.to!)}`);

const leapFeb = cyc(new Date(2024, 2, 15), 30);
check('a leap February clamps to the 29th', ymd(leapFeb.from!) === '2024-02-29', ymd(leapFeb.from!));

// December to January must cross the year correctly.
const decemberCycle = cyc(new Date(2025, 11, 20), 7);
check('a December cycle ends in the next year', ymd(decemberCycle.to!) === '2026-01-07', ymd(decemberCycle.to!));

console.log('\nA cycle of 1 is still a calendar month\n');

const calendar = cyc(new Date(2026, 7, 20), 1);
const plainMonth = periodRange('Month', new Date(2026, 7, 20), null, null);
check('day 1 matches the calendar month', calendar.from === plainMonth.from && calendar.to === plainMonth.to);
check('day 1 keeps the plain month label', calendar.label === plainMonth.label, calendar.label);
check('a cycle label shows its real span', after.label.includes('Aug') && after.label.includes('Sept'), after.label);

console.log('\nPicking a month follows the cycle too\n');

const septemberCycle = cyc(new Date(2026, 7, 20), 7, new Date(2026, 8, 1).getTime());
check('picking September starts on 7 Sep', ymd(septemberCycle.from!) === '2026-09-07', ymd(septemberCycle.from!));
check('and ends on 7 Oct', ymd(septemberCycle.to!) === '2026-10-07', ymd(septemberCycle.to!));
// The anchor names a month, so a mid-month anchor picks the same cycle.
const midAnchor = cyc(new Date(2026, 7, 20), 7, new Date(2026, 8, 22).getTime());
check('a mid-month anchor picks the same cycle', midAnchor.from === septemberCycle.from);

// Day, week and year are calendar facts and must ignore the cycle entirely.
for (const period of ['Day', 'Week', 'Year', 'All'] as const) {
  const plain = periodRange(period, NOW, null, null);
  const withCycle = periodRange(period, NOW, null, null, null, 7);
  check(`${period} ignores the cycle`, plain.from === withCycle.from && plain.to === withCycle.to);
}

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
