export const PERIODS = ['Day', 'Week', 'Month', 'Pick month', 'Year', 'All', 'Custom'] as const;
export type Period = (typeof PERIODS)[number];

export type Range = {
  from: number | null;
  to: number | null;
  label: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export type MonthOption = { anchor: number; label: string; short: string };

/**
 * The months offered by the month picker, newest first. Anchored to the 1st at
 * midnight so the value is a stable identity for the month rather than a
 * timestamp that drifts with the time of day it was chosen.
 */
export function recentMonths(now: Date, count = 12): MonthOption[] {
  const months: MonthOption[] = [];
  for (let back = 0; back < count; back += 1) {
    const first = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push({
      anchor: first.getTime(),
      label: monthLabel(first),
      short: first.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    });
  }
  return months;
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Ranges are half-open [from, to) so a transaction at exactly midnight belongs
 * to one period only and never both.
 */
export const DEFAULT_CYCLE_START_DAY = 1;

/**
 * A cycle day past the end of a short month falls on its last day: a cycle set
 * to the 31st runs to 28 February rather than skipping the month.
 */
function clampDay(year: number, month: number, day: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(Math.trunc(day), 1), daysInMonth);
}

function cycleStartOn(year: number, month: number, startDay: number): Date {
  // Normalise first, so month -1 or 12 resolves to the right year.
  const normalized = new Date(year, month, 1);
  return new Date(
    normalized.getFullYear(),
    normalized.getMonth(),
    clampDay(normalized.getFullYear(), normalized.getMonth(), startDay)
  );
}

/**
 * The cycle containing `now`. With a start day of 7, the 3rd of March belongs to
 * the cycle that began on 7 February — a salary paid on the 7th should be spent
 * against the month it arrived in, not split across two calendar months.
 */
function cycleAround(now: Date, startDay: number): { from: Date; to: Date } {
  const thisMonth = cycleStartOn(now.getFullYear(), now.getMonth(), startDay);
  const from =
    startOfDay(now).getTime() >= thisMonth.getTime()
      ? thisMonth
      : cycleStartOn(now.getFullYear(), now.getMonth() - 1, startDay);
  return { from, to: cycleStartOn(from.getFullYear(), from.getMonth() + 1, startDay) };
}

/** The cycle that starts in the month the anchor falls in. */
function cycleForMonth(anchor: Date, startDay: number): { from: Date; to: Date } {
  const from = cycleStartOn(anchor.getFullYear(), anchor.getMonth(), startDay);
  return { from, to: cycleStartOn(from.getFullYear(), from.getMonth() + 1, startDay) };
}

/**
 * A cycle that starts on the 1st is just a calendar month, so it keeps the plain
 * month name. Any other start day has to show its real span, or "September"
 * would be a lie about which days are counted.
 */
function cycleLabel(from: Date, to: Date, startDay: number): string {
  if (startDay === 1) return monthLabel(from);
  return `${shortDate(from.getTime())} – ${shortDate(to.getTime() - DAY_MS)}`;
}

export function periodRange(
  period: Period,
  now: Date,
  customFrom: number | null,
  customTo: number | null,
  monthAnchor: number | null = null,
  cycleStartDay: number = DEFAULT_CYCLE_START_DAY
): Range {
  const today = startOfDay(now);

  switch (period) {
    case 'Day': {
      const from = today.getTime();
      return {
        from,
        to: from + DAY_MS,
        label: now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' }),
      };
    }
    case 'Week': {
      // Week starts Monday: getDay() is 0 for Sunday, so shift by 6.
      const daysSinceMonday = (today.getDay() + 6) % 7;
      const from = today.getTime() - daysSinceMonday * DAY_MS;
      const to = from + 7 * DAY_MS;
      return { from, to, label: `${shortDate(from)} – ${shortDate(to - DAY_MS)}` };
    }
    case 'Month': {
      const cycle = cycleAround(now, cycleStartDay);
      return {
        from: cycle.from.getTime(),
        to: cycle.to.getTime(),
        label: cycleLabel(cycle.from, cycle.to, cycleStartDay),
      };
    }
    case 'Pick month': {
      // No month chosen yet reads as the current one, so the range is never
      // empty while the picker is still untouched.
      const cycle =
        monthAnchor === null
          ? cycleAround(now, cycleStartDay)
          : cycleForMonth(new Date(monthAnchor), cycleStartDay);
      return {
        from: cycle.from.getTime(),
        to: cycle.to.getTime(),
        label: cycleLabel(cycle.from, cycle.to, cycleStartDay),
      };
    }
    case 'Year': {
      const from = new Date(now.getFullYear(), 0, 1).getTime();
      const to = new Date(now.getFullYear() + 1, 0, 1).getTime();
      return { from, to, label: String(now.getFullYear()) };
    }
    case 'Custom': {
      if (customFrom === null || customTo === null) {
        const to = today.getTime() + DAY_MS;
        const from = to - 30 * DAY_MS;
        return { from, to, label: `${shortDate(from)} – ${shortDate(to - DAY_MS)}` };
      }
      const from = startOfDay(new Date(Math.min(customFrom, customTo))).getTime();
      const toStart = startOfDay(new Date(Math.max(customFrom, customTo))).getTime();
      return {
        from,
        to: toStart + DAY_MS,
        label: `${shortDate(from)} – ${shortDate(toStart)}`,
      };
    }
    case 'All':
    default:
      return { from: null, to: null, label: 'All time' };
  }
}
