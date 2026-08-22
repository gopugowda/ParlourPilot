/**
 * useAttendanceAutoLogout
 *
 * While a STAFF-role user is logged in, poll GPS every 2 minutes. If:
 *   - the branch has GPS gating active (branch has coords),
 *   - the staffer has a `work_end` set on their profile,
 *   - "now" is past `work_end` (today, local),
 *   - AND the staffer is > auto_logout_radius_m from the branch,
 * → automatically POST /attendance/action { check_out } and log out.
 *
 * Owners/admins and staff with no work_end are exempt.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getFreshLocation, loadConfig, postAction, haversine, hhmmToDate } from '@/src/utils/attendance';

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
        if (!cfg.gating_active) return;
        const wEnd = hhmmToDate(cfg.work_end);
        if (!wEnd) return;
        if (Date.now() < wEnd.getTime()) return;   // still within shift

        const loc = await getFreshLocation();
        if (!loc || cfg.latitude == null || cfg.longitude == null) return;
        const dist = haversine(loc.coords.latitude, loc.coords.longitude, cfg.latitude, cfg.longitude);
        const radius = cfg.auto_logout_radius_m || 1000;
        if (dist <= radius) return;

        // Trigger auto check-out then logout.
        await postAction('check_out', loc).catch(() => {});
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
