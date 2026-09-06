/**
 * Time / duration formatters.
 *
 * `hm(1.5)`   → "1h 30m"
 * `hm(11.98)` → "11h 59m"   (0.98 × 60 = 58.8 → rounds to 59)
 * `hm(0.24)`  → "0h 14m"    (0.24 × 60 = 14.4 → rounds to 14)
 * `hm(0)`     → "0h 0m"
 * `hm(null)`  → "0h 0m"
 * `hm(2)`     → "2h 0m"
 *
 * Rules:
 *   • Minutes are rounded to the nearest whole number.
 *   • Negative values are clamped to zero (a payroll hour count is
 *     never meaningfully negative on the client).
 *   • Overflow: if rounding lifts minutes to 60, we carry the hour.
 *
 * We deliberately keep the "0h" prefix even for very short spans so
 * grid layouts stay stable (matches the web app).
 */
export function hm(hoursDecimal: number | null | undefined): string {
  if (hoursDecimal == null || Number.isNaN(hoursDecimal) || hoursDecimal <= 0) {
    return '0h 0m';
  }
  const totalMinutes = Math.round(hoursDecimal * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Same as `hm()` but returns null-ish empty string when the value is
 * zero. Useful for badges/pills that should disappear entirely when
 * there is no overtime (matches web app parity).
 */
export function hmOrHide(hoursDecimal: number | null | undefined): string {
  if (hoursDecimal == null || Number.isNaN(hoursDecimal) || hoursDecimal <= 0) return '';
  return hm(hoursDecimal);
}

/**
 * Live-shift formatter: milliseconds → "Xh Ym".
 *
 * Used by the running "Worked today / Shift duration" timer on the
 * staff dashboard so it stays in the same units as payroll & reports.
 */
export function hmFromMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '0h 0m';
  return hm(ms / 3_600_000);
}
