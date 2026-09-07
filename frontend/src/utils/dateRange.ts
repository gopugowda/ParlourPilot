/**
 * Shared date-range helpers used by Appointments and any other screen
 * that filters by preset (Today / This Week / This Month / All).
 *
 * WHY THIS FILE EXISTS (bug this fixed):
 *   The old mobile logic used a rolling `[now, now+7d)` window for
 *   "This Week", which:
 *     • hid appointments that were LATER this week if today was Mon,
 *     • and included next week's Mon-Tue when today was late in the week.
 *   Similarly there was no "This Month" preset.
 *
 * RULES
 *   • Ranges are always evaluated in the DEVICE'S LOCAL TIMEZONE — the
 *     backend stores ISO datetimes which we let `new Date(iso)` convert.
 *   • Week convention: MONDAY-START (matches the web app).
 *   • Comparisons are HALF-OPEN: `start <= t < endExclusive`. This
 *     avoids double-counting the boundary minute and off-by-one at
 *     midnight.
 *   • For calendar-date-only comparisons (e.g. grouping by day), use
 *     `localDateKey()` which returns "YYYY-MM-DD" of the LOCAL date —
 *     never slice the raw ISO string.
 */

export type RangePreset = 'today' | 'week' | 'month' | 'all';

export type LocalRange = {
  /** Inclusive start of the range in local time. */
  startInclusive: Date;
  /** Exclusive end of the range in local time (first moment AFTER the range). */
  endExclusive: Date;
  /** "YYYY-MM-DD" of `startInclusive` (local). */
  startYmd: string;
  /** "YYYY-MM-DD" of the LAST day inside the range (local, inclusive). */
  endYmd: string;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" using the device's LOCAL calendar. */
export function localDateKey(d: Date | string | number): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Local midnight (00:00:00.000) for the given date. */
function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Monday of the week containing `d` (local time).
 * JS `getDay()`: 0=Sun, 1=Mon … 6=Sat. Shift so Mon=0 … Sun=6.
 */
function startOfLocalWeekMonday(d: Date): Date {
  const s = startOfLocalDay(d);
  const jsDow = s.getDay();
  const monDelta = (jsDow + 6) % 7;   // Mon→0, Tue→1 … Sun→6
  return addDays(s, -monDelta);
}

/** First moment of the month containing `d`. */
function startOfLocalMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  return x;
}

/** First moment of the NEXT month after `d`. */
function startOfNextLocalMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}

/**
 * Resolve a preset to a concrete local half-open range.
 * `now` defaults to `new Date()` — pass in for tests.
 *
 * `'all'` returns a very wide window that covers everything.
 */
export function resolveRange(preset: RangePreset, now: Date = new Date()): LocalRange {
  let startInclusive: Date;
  let endExclusive: Date;

  switch (preset) {
    case 'today': {
      startInclusive = startOfLocalDay(now);
      endExclusive = addDays(startInclusive, 1);
      break;
    }
    case 'week': {
      startInclusive = startOfLocalWeekMonday(now);
      // The following Monday 00:00 (i.e. right after Sunday 23:59:59).
      endExclusive = addDays(startInclusive, 7);
      break;
    }
    case 'month': {
      startInclusive = startOfLocalMonth(now);
      endExclusive = startOfNextLocalMonth(now);
      break;
    }
    case 'all':
    default: {
      startInclusive = new Date(1970, 0, 1);
      endExclusive = new Date(9999, 11, 31);
      break;
    }
  }

  // The last inclusive local date is endExclusive - 1 day.
  const lastInclusive = addDays(endExclusive, -1);

  return {
    startInclusive,
    endExclusive,
    startYmd: localDateKey(startInclusive),
    endYmd: localDateKey(lastInclusive),
  };
}

/** Does the appointment fall inside the preset range (local, half-open)? */
export function isInRange(iso: string | null | undefined, range: LocalRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= range.startInclusive.getTime() && t < range.endExclusive.getTime();
}
