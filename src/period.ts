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
export function periodRange(
  period: Period,
  now: Date,
  customFrom: number | null,
  customTo: number | null,
  monthAnchor: number | null = null
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
      const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      return { from, to, label: monthLabel(now) };
    }
    case 'Pick month': {
      // No month chosen yet reads as the current one, so the range is never
      // empty while the picker is still untouched.
      const anchor = monthAnchor === null ? now : new Date(monthAnchor);
      const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1).getTime();
      const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1).getTime();
      return { from, to, label: monthLabel(anchor) };
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
