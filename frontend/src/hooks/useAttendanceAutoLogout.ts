/**
 * useAttendanceAutoLogout — intelligent auto check-out for staff.
 *
 * Fires ONLY when ALL of the following are true:
 *
 *   (1) WORK-HOURS CHECK: `Date.now()` is past the staffer's `work_end`.
 *       If we're still within the shift → stay checked in (Test 1).
 *
 *   (2) DISTANCE CHECK: current GPS is farther than `check_out_radius_m`
 *       from the branch coordinates. Backend-driven, no fallback.
 *
 *   (3) OVERTIME SUPPORT: if the staffer is still INSIDE the check-out
 *       radius after work hours ended → do NOT log them out. Let them
 *       stay checked in for manual overtime (Test 2).
 *
 * When all three conditions are met (Test 3), we POST
 * `/attendance/action` with `{ check_out, auto: true }` — the `auto`
 * flag tells the backend to accept the punch despite being outside the
 * radius — and then trigger `onAutoLogout()` so the app returns to the
 * sign-in screen.
 *
 * Extra gates:
 *   • Runs only for role === 'staff'.
 *   • Skips while the app is backgrounded (battery + false-trigger safety).
 *   • Skips entirely when the branch's `geo_fencing_enabled` toggle is OFF.
 *   • Backend is the sole source of truth — no radius or distance is
 *     ever hard-coded on the client.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  getFreshLocation, loadConfig, postAction, haversine, hhmmToDate,
  effectiveCheckOutRadius, isGatingActive,
} from '@/src/utils/attendance';

type Opts = {
  role?: string | null;
  onAutoLogout: () => void;
  intervalMs?: number;   // default 2 min
};

export function useAttendanceAutoLogout({ role, onAutoLogout, intervalMs = 120_000 }: Opts) {
  const timerRef = useRef<any>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    // Only run for staff role.
    if (role !== 'staff') return;

    const check = async () => {
      if (stopped.current) return;
      // Skip when app is not active (saves battery + false triggers).
      if (AppState.currentState !== 'active') return;
      try {
        // Ask the backend first — if geo-fencing is OFF for this branch
        // we do nothing at all (no GPS fix, no distance calc, no punch).
        const cfg = await loadConfig();
        if (!isGatingActive(cfg)) return;

        // ── (1) WORK-HOURS CHECK ────────────────────────────────────
        // Test 1: staff moves away DURING work hours → stay logged in.
        const wEnd = hhmmToDate(cfg.work_end);
        if (!wEnd) return;                          // no shift defined
        if (Date.now() < wEnd.getTime()) return;    // still within shift

        // Backend-driven check-out radius. Never hard-code a fallback:
        // if the backend didn't return a radius we treat this as
        // "unknown" and skip auto-logout.
        const radius = effectiveCheckOutRadius(cfg);
        if (typeof radius !== 'number' || radius <= 0) return;

        const loc = await getFreshLocation();
        if (!loc || cfg.latitude == null || cfg.longitude == null) return;

        // ── (2)+(3) DISTANCE CHECK / OVERTIME SUPPORT ───────────────
        // Test 2: staff stays AT the salon after hours → stay logged
        // in (manual overtime). We only trigger when the staffer has
        // clearly drifted beyond the branch's check-out radius.
        const dist = haversine(loc.coords.latitude, loc.coords.longitude, cfg.latitude, cfg.longitude);
        if (dist <= radius) return;

        // Test 3: staff moves AWAY after hours → auto check-out + logout.
        // `auto: true` bypasses the manual out-of-radius rejection.
        await postAction('check_out', loc, { auto: true }).catch(() => {});
        stopped.current = true;
        try { onAutoLogout(); } catch {}
      } catch { /* silent — best effort background check */ }
    };

    // First check after 15s so we don't spam on app boot.
    const first = setTimeout(check, 15_000);
    timerRef.current = setInterval(check, intervalMs);
    return () => {
      stopped.current = true;
      clearTimeout(first);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [role, intervalMs, onAutoLogout]);
}
