/**
 * Shared helpers for the GPS-gated attendance flow.
 *
 * The backend is the source of truth for gating decisions — mobile just
 *   1) captures a fresh GPS fix (maximumAge: 0),
 *   2) posts to /attendance/action,
 *   3) shows any friendly error the backend returns.
 *
 * Owners/admins are never geofenced (server-side rule).
 */
import * as Location from 'expo-location';
import { Alert, Linking } from 'react-native';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { api } from '@/src/api/client';

// Extend dayjs with UTC support so we can safely convert backend UTC → user local time.
dayjs.extend(utc);

/**
 * Robustly parse a backend timestamp into a dayjs object (local time).
 *
 * Why this exists: the FastAPI backend emits `datetime.now(timezone.utc).isoformat()`
 * → e.g. `2026-08-24T13:22:00.123456+00:00`. React Native's Hermes engine returns
 * `Invalid Date` on strings with **6-digit microseconds** on some Android builds.
 * We normalize by trimming to millisecond precision and coercing the `Z` variant.
 *
 * Returns null if the input is falsy or unparseable — callers should defend against it.
 */
export function parseTimestamp(iso?: string | number | null): dayjs.Dayjs | null {
  if (iso == null) return null;
  if (typeof iso === 'number') {
    const d = dayjs(iso);
    return d.isValid() ? d : null;
  }
  const raw = String(iso).trim();
  if (!raw) return null;
  // Trim microseconds to milliseconds: `.123456` → `.123`.
  const normalized = raw
    .replace(/(\.\d{3})\d+/, '$1')     // 6-digit → 3-digit fractional seconds
    .replace(/Z$/, '+00:00');          // Z → explicit UTC offset (RFC 3339)
  const d = dayjs(normalized);
  if (d.isValid()) return d;
  // Fallback: treat as UTC without offset (older serialisers).
  const d2 = dayjs.utc(normalized);
  return d2.isValid() ? d2.local() : null;
}

/** Milliseconds since epoch for a backend timestamp, or null if unparseable. */
export function parseTimestampMs(iso?: string | number | null): number | null {
  const d = parseTimestamp(iso);
  return d ? d.valueOf() : null;
}

/** Format a backend timestamp as local 12-hour clock (e.g. '01:30 PM'). Returns '—' on failure. */
export function fmtLocalTime(iso?: string | number | null): string {
  const d = parseTimestamp(iso);
  return d ? d.format('hh:mm A') : '—';
}

/** Format a backend timestamp as local weekday + short 12-hour time (used in Upcoming lists). */
export function fmtLocalDayTime(iso?: string | number | null): string {
  const d = parseTimestamp(iso);
  return d ? d.format('ddd, MMM D · hh:mm A') : '—';
}

export type AttendanceAction = 'check_in' | 'check_out' | 'break_start' | 'break_end';

export type AttendanceConfig = {
  branch_id?: string;
  branch_name?: string;
  latitude?: number | null;
  longitude?: number | null;
  /**
   * Owner-configurable per-branch geo-fence.
   * NEVER hard-code a fallback radius on the client — always read the
   * backend value. When `geo_fencing_enabled` (aka `gating_active`) is
   * false, or latitude/longitude are null, distance checks are skipped
   * entirely.
   */
  geo_fencing_enabled?: boolean;
  check_in_radius_m?: number;
  check_out_radius_m?: number;
  /** Alias of `check_out_radius_m` kept for old-client compatibility. */
  auto_logout_radius_m?: number;
  gating_active?: boolean;
  work_start?: string;             // "HH:MM"
  work_end?: string;               // "HH:MM"
  role?: string;
};

/** Read the effective check-out radius (works with both new + legacy responses). */
export function effectiveCheckOutRadius(cfg: AttendanceConfig | null | undefined): number | null {
  if (!cfg) return null;
  const v = cfg.check_out_radius_m ?? cfg.auto_logout_radius_m;
  return typeof v === 'number' ? v : null;
}

/** Read the effective check-in radius; null when backend didn't send one. */
export function effectiveCheckInRadius(cfg: AttendanceConfig | null | undefined): number | null {
  return typeof cfg?.check_in_radius_m === 'number' ? cfg.check_in_radius_m : null;
}

/** Is geo-fencing actually enforced right now? */
export function isGatingActive(cfg: AttendanceConfig | null | undefined): boolean {
  if (!cfg) return false;
  const flag = cfg.geo_fencing_enabled ?? cfg.gating_active;
  if (!flag) return false;
  return typeof cfg.latitude === 'number' && typeof cfg.longitude === 'number';
}

export type MyTodayEntry = {
  status: 'in' | 'out' | 'break';
  logs: Array<{
    id?: string; action: AttendanceAction;
    /** Canonical timestamp field (web ↔ mobile parity). */
    ts?: string;
    /** Legacy alias — backend now dual-writes both. */
    timestamp?: string;
    /** Older aliases some rows may carry. */
    time?: string;
    created_at?: string;
    /** Canonical staff-name field. */
    staff_name?: string;
    /** Legacy aliases. */
    name?: string;
    staffName?: string;
    user_name?: string;
    latitude?: number; longitude?: number;
    distance_m?: number; within_geofence?: boolean;
  }>;
};

/**
 * Pick the best available timestamp from a log row, tolerating both the
 * canonical `ts` key and legacy aliases (`timestamp`, `time`, `created_at`).
 * This matches the backend's `_normalize_log` fallback order and stays
 * defensive for any row the migration hasn't touched yet.
 */
export function pickLogTimestamp(row: {
  ts?: string; timestamp?: string; time?: string; created_at?: string;
} | null | undefined): string | undefined {
  if (!row) return undefined;
  return row.ts || row.timestamp || row.time || row.created_at || undefined;
}

/**
 * Pick the best available staff-name from a log row, tolerating canonical
 * `staff_name` + legacy `name`/`staffName`/`user_name`.
 */
export function pickLogStaffName(row: {
  staff_name?: string; name?: string; staffName?: string; user_name?: string;
} | null | undefined): string | undefined {
  if (!row) return undefined;
  return row.staff_name || row.name || row.staffName || row.user_name || undefined;
}

/**
 * Ask for location permission (contextual) and return the current fix.
 * Returns null on any error / denial. Caller decides how to surface that.
 */
export async function getFreshLocation(): Promise<Location.LocationObject | null> {
  try {
    let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      status = req.status;
      canAskAgain = req.canAskAgain;
    }
    if (status !== 'granted') {
      if (!canAskAgain) {
        Alert.alert(
          'Location permission required',
          "We need your location to verify you're at the salon before you punch in.",
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
      return null;
    }
    // maximumAge:0 forces a fresh fix — critical for geofence accuracy.
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return loc;
  } catch {
    return null;
  }
}

/**
 * Post an attendance action with the freshest GPS.
 *
 * The optional `auto` flag distinguishes the automatic post-work-hours
 * check-out (which legitimately fires from *outside* the branch radius)
 * from a manual check-out (which is rejected outside the radius). Pass
 * `auto: true` ONLY from the background auto-logout watcher.
 */
export async function postAction(
  action: AttendanceAction,
  loc: Location.LocationObject | null,
  opts: { auto?: boolean } = {},
): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
  const body: any = { action, auto: !!opts.auto };
  if (loc) {
    body.latitude = loc.coords.latitude;
    body.longitude = loc.coords.longitude;
  } else {
    body.latitude = null;
    body.longitude = null;
  }
  try {
    const data = await api('/attendance/action', { method: 'POST', body });
    return { ok: true, data };
  } catch (e: any) {
    const raw = (e?.message || 'Failed').toString();
    return { ok: false, error: raw, status: e?.status };
  }
}

/** Fetch the tenant's attendance config. */
export function loadConfig(): Promise<AttendanceConfig> {
  return api<AttendanceConfig>('/attendance/config').catch(() => ({} as AttendanceConfig));
}

/** Fetch today's punch log for the logged-in staffer. */
export function loadMyToday(): Promise<MyTodayEntry> {
  return api<MyTodayEntry>('/attendance/me/today').catch(() => ({ status: 'out', logs: [] } as MyTodayEntry));
}

/** Haversine distance in meters. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/** Parse "HH:MM" today to a local Date. */
export function hhmmToDate(hhmm?: string | null): Date | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
