/**
 * Attendance Correction API — client-side wrapper for the backend workflow
 * shipped with the shared ParlourPilot backend. Every call is protected by
 * the standard Bearer token; admin-side endpoints are branch-scoped via
 * the same X-Branch-Id header the rest of the admin screens use (handled
 * transparently by `api()`).
 *
 * IMPORTANT — TIME HANDLING
 *   • Punch timestamps are full ISO 8601 strings.
 *   • When the user picks a time for a given YYYY-MM-DD, build the ISO
 *     from a LOCAL Date so it round-trips to the displayed time:
 *       localDateToIso('2026-09-03', 9, 0) →
 *         new Date(2026, 8, 3, 9, 0, 0, 0).toISOString()
 *   • Read the local hours/minutes off a parsed ISO with
 *     `readLocalHM(iso)`; parse safely by truncating microseconds.
 *   • date / attendance_date fields are plain YYYY-MM-DD.
 */
import { api } from './client';

// ---------- Types ---------------------------------------------------------

export type SelfHistoryRow = {
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  status: 'present' | 'incomplete' | 'absent';
  corrected: boolean;
  correction: null | {
    id: string;
    status: 'pending' | 'approved' | 'rejected' | 'cancelled';
    requested_clock_in: string | null;
    requested_clock_out: string | null;
    reason?: string;
    rejection_reason?: string;
    reviewed_by_name?: string;
  };
};
export type SelfHistoryResponse = {
  linked: boolean;
  beautician_id: string | null;
  rows: SelfHistoryRow[];
};

export type CorrectionRequest = {
  id: string;
  beautician_id?: string;
  beautician_name?: string;
  attendance_date: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  current_clock_in?: string | null;
  current_clock_out?: string | null;
  requested_clock_in?: string | null;
  requested_clock_out?: string | null;
  applied_clock_in?: string | null;
  applied_clock_out?: string | null;
  reason?: string;
  employee_note?: string;
  rejection_reason?: string;
  reviewed_by_name?: string;
  created_at?: string;
  reviewed_at?: string;
};

// ---------- Time helpers --------------------------------------------------

/** Parse ISO safely (truncate microseconds → milliseconds). */
export const safeParseISO = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const clean = s.replace(/(\.\d{3})\d+/, '$1');
  const d = new Date(clean);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Read local hours/minutes from an ISO for pre-filling a time picker. */
export const readLocalHM = (iso: string | null | undefined): { hh: number; mm: number } | null => {
  const d = safeParseISO(iso);
  if (!d) return null;
  return { hh: d.getHours(), mm: d.getMinutes() };
};

/** Build a full ISO from a YYYY-MM-DD + local hh:mm (round-trips to display). */
export const localDateToIso = (ymd: string, hh: number, mm: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).toISOString();
};

/** Format an ISO in the device's local timezone as "9:00 AM". */
export const fmtLocalTimeISO = (iso: string | null | undefined): string => {
  const d = safeParseISO(iso || '');
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

// ---------- Endpoints -----------------------------------------------------

export const attendanceApi = {
  // === Staff self-service ===
  selfHistory: (days = 30) =>
    api<SelfHistoryResponse>(`/attendance/self/history?days=${days}`),

  submitSelfCorrection: (body: {
    attendance_date: string;
    requested_clock_in: string | null;
    requested_clock_out: string | null;
    reason: string;
    employee_note?: string;
  }) =>
    api<CorrectionRequest>('/attendance/self/corrections', { method: 'POST', body }),

  selfCorrections: () =>
    api<{ rows: CorrectionRequest[] }>('/attendance/self/corrections'),

  cancelSelfCorrection: (id: string) =>
    api<CorrectionRequest>(`/attendance/self/corrections/${id}/cancel`, { method: 'POST' }),

  // === Owner / Admin review ===
  listCorrections: (status?: 'pending' | 'approved' | 'rejected' | 'cancelled') => {
    const q = status ? `?status=${status}` : '';
    return api<{ rows: CorrectionRequest[] }>(`/attendance/corrections${q}`);
  },

  approveCorrection: (id: string) =>
    api<CorrectionRequest>(`/attendance/corrections/${id}/approve`, { method: 'POST' }),

  rejectCorrection: (id: string, rejection_reason: string) =>
    api<CorrectionRequest>(`/attendance/corrections/${id}/reject`, {
      method: 'POST',
      body: { rejection_reason },
    }),

  directEdit: (body: {
    beautician_id: string;
    date: string;
    clock_in: string | null;
    clock_out: string | null;
    reason: string;
  }) =>
    api<CorrectionRequest>('/attendance/direct-edit', { method: 'POST', body }),

  audit: (params: { beautician_id?: string; date?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.beautician_id) q.set('beautician_id', params.beautician_id);
    if (params.date) q.set('date', params.date);
    const qs = q.toString();
    return api<{ rows: any[] }>(`/attendance/audit${qs ? `?${qs}` : ''}`);
  },
};
