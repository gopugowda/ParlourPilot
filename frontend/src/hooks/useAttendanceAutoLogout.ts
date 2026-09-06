/**
 * useAttendanceAutoLogout
 *
 * While a STAFF-role user is logged in, poll GPS every 2 minutes. If:
 *   - the branch has geo-fencing enabled (backend `geo_fencing_enabled` /
 *     `gating_active` true AND branch has coords),
 *   - the staffer has a `work_end` set on their profile,
 *   - "now" is past `work_end` (today, local),
 *   - AND the staffer has drifted beyond `check_out_radius_m`
 *     (`auto_logout_radius_m` is an alias for the same value on old
 *     backends — never hard-code a fallback),
 * → automatically POST /attendance/action { check_out, auto: true } and
 *   log out. The `auto: true` flag tells the backend to bypass the
 *   manual check-out gate that would otherwise reject an out-of-radius
 *   punch.
 *
 * Owners/admins and staff with no work_end are exempt. When geo-fencing
 * is OFF or the branch has no coordinates, this hook does NOT auto-log
 * anyone out (there is no radius to compare against).
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
        const cfg = await loadConfig();
        if (!isGatingActive(cfg)) return;
        const wEnd = hhmmToDate(cfg.work_end);
        if (!wEnd) return;
        if (Date.now() < wEnd.getTime()) return;   // still within shift

        const loc = await getFreshLocation();
        if (!loc || cfg.latitude == null || cfg.longitude == null) return;

        // Use the check-out radius as the drift threshold.
        // No hard-coded fallback: if the backend didn't return a radius
        // we treat this as "unknown" and skip auto-logout.
        const radius = effectiveCheckOutRadius(cfg);
        if (typeof radius !== 'number') return;

        const dist = haversine(loc.coords.latitude, loc.coords.longitude, cfg.latitude, cfg.longitude);
        if (dist <= radius) return;

        // Trigger auto check-out then logout — `auto: true` tells the
        // backend to bypass the manual out-of-radius rejection.
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
