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
import { api } from '@/src/api/client';

export type AttendanceAction = 'check_in' | 'check_out' | 'break_start' | 'break_end';

export type AttendanceConfig = {
  branch_id?: string;
  branch_name?: string;
  latitude?: number | null;
  longitude?: number | null;
  check_in_radius_m?: number;      // 100
  auto_logout_radius_m?: number;   // 1000
  gating_active?: boolean;
  work_start?: string;             // "HH:MM"
  work_end?: string;               // "HH:MM"
  role?: string;
};

export type MyTodayEntry = {
  status: 'in' | 'out' | 'break';
  logs: Array<{
    id?: string; action: AttendanceAction; timestamp: string;
    latitude?: number; longitude?: number;
    distance_m?: number; within_geofence?: boolean;
  }>;
};

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

/** Post an attendance action with the freshest GPS. */
export async function postAction(
  action: AttendanceAction,
  loc: Location.LocationObject | null,
): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
  const body: any = { action };
  if (loc) {
    body.latitude = loc.coords.latitude;
    body.longitude = loc.coords.longitude;
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
