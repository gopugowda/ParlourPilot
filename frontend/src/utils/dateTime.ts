/**
 * Central date/time formatters — the ONLY place the mobile UI decides
 * how to render a timestamp for the user.
 *
 * All outputs are 12-hour with AM/PM (matches web app + Indian
 * business convention). Stored ISO datetimes on the server are
 * NEVER modified — we always accept ISO input and convert to LOCAL
 * time for display.
 *
 *   fmtTime12('2026-09-10T13:30:00')      → '01:30 PM'
 *   fmtDateTime12('2026-09-10T13:30:00')  → '10 Sep, 01:30 PM'
 *   fmtDate('2026-09-10T13:30:00')        → '10 Sep'
 *   fmtLongDateTime12(...)                → '10 Sep 2026, 01:30 PM'
 *
 * Edge cases:
 *   - null / undefined / empty  → '—'
 *   - unparseable string        → '—'
 *   - midnight (00:00 → 12:00 AM); noon (12:00 → 12:00 PM)
 */

const MISSING = '—';

function toDate(iso: string | number | null | undefined): Date | null {
  if (iso == null || iso === '') return null;
  // Normalize microseconds → milliseconds so Hermes/older Android engines
  // don't return `Invalid Date` on 6-digit fractional seconds.
  const raw = typeof iso === 'string'
    ? iso.replace(/(\.\d{3})\d+/, '$1').replace(/Z$/, '+00:00')
    : iso;
  const d = new Date(raw as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 12-hour clock: '01:30 PM' / '12:00 AM' / '12:00 PM'. */
export function fmtTime12(iso: string | number | null | undefined): string {
  const d = toDate(iso);
  if (!d) return MISSING;
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** '10 Sep, 01:30 PM' — day + short month + 12-hour time. */
export function fmtDateTime12(iso: string | number | null | undefined): string {
  const d = toDate(iso);
  if (!d) return MISSING;
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

/** '10 Sep 2026, 01:30 PM' — full year variant (for receipts / audits). */
export function fmtLongDateTime12(iso: string | number | null | undefined): string {
  const d = toDate(iso);
  if (!d) return MISSING;
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

/** '10 Sep' — date only (no time appended). */
export function fmtDate(iso: string | number | null | undefined): string {
  const d = toDate(iso);
  if (!d) return MISSING;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** 'Wed, 10 Sep' — weekday + date only. */
export function fmtWeekdayDate(iso: string | number | null | undefined): string {
  const d = toDate(iso);
  if (!d) return MISSING;
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** 'Wed, 10 Sep · 01:30 PM' — used in upcoming lists. */
export function fmtWeekdayDateTime12(iso: string | number | null | undefined): string {
  const d = toDate(iso);
  if (!d) return MISSING;
  const date = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date} · ${time}`;
}
