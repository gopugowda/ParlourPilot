/**
 * HR Phase 1C — Staff self-service API client.
 *
 * The backend derives identity from the JWT — the mobile client MUST NOT send
 * beautician_id / employee_id / branch_id / tenant_id on any of these calls.
 *
 * Endpoint contract (all under /api/hr/self-service):
 *   GET  /me
 *   GET  /leave-types
 *   GET  /leave-balances?year=YYYY
 *   GET  /leave-requests?status=...
 *   GET  /leave-history?year=YYYY
 *   GET  /holidays?year=YYYY
 *   GET  /calendar?month=YYYY-MM
 *   GET  /rh?year=YYYY
 *   POST /leave-requests
 *   POST /leave-requests/{id}/cancel
 *   POST /rh-selection
 *
 * All errors bubble up via `ApiError` from `src/api/client.ts` so screens
 * surface `err.message` (which is the backend's `response.detail`).
 */
import { api } from './client';

// ---- Response shapes -----------------------------------------------------

export type SelfServiceMe = {
  beautician_id: string;
  name: string;
  branch_id: string;
  week_off?: string[];
};

export type LeaveType = {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  allow_half_day: boolean;
  requires_approval: boolean;
  requires_attachment: boolean;
};

export type LeaveBalance = {
  leave_type_id: string;
  leave_type_name: string;
  code: string;
  paid: boolean;
  entitled: number;
  used: number;
  pending: number;
  available: number;
};

export type LeaveBalancesResponse = {
  beautician_id: string;
  year: number;
  balances: LeaveBalance[];
};

export type LeaveDayPart = 'full' | 'first_half' | 'second_half';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type LeaveRequest = {
  id: string;
  beautician_id?: string;
  beautician_name?: string;
  branch_id?: string;
  leave_type_id: string;
  leave_type_name: string;
  leave_type_code: string;
  paid: boolean;
  from_date: string;
  to_date: string;
  day_part: LeaveDayPart;
  days: number;
  reason?: string;
  note?: string;
  leave_year: number;
  status: LeaveStatus;
  requires_approval: boolean;
  submitted_at?: string;
  submitted_by_name?: string;
  decided_by_name?: string;
  decided_at?: string;
  decision_note?: string;
  cancelled_at?: string;
};

export type CalendarDay = {
  date: string;
  status: 'present' | 'paid_leave' | 'unpaid_leave' | 'half_day' | 'public_holiday' | 'restricted_holiday' | 'weekly_off' | null;
  source?: string | null;
  leave_type_code?: string | null;
  pending_leave?: { leave_type_code?: string; day_part?: LeaveDayPart } | null;
  holiday_name?: string | null;
};

export type CalendarResponse = {
  beautician_id: string;
  beautician_name: string;
  month: string;
  days: CalendarDay[];
};

export type Holiday = {
  id: string;
  date: string;
  name: string;
  type?: string;         // 'public' | 'restricted' | ...
  branch_id?: string | null;
};

export type RHResponse = {
  beautician_id: string;
  year: number;
  entitlement: number;
  used: number;
  available: number;
  selections: { id: string; date: string; name: string }[];
  available_holidays: Holiday[];
};

// ---- API surface ---------------------------------------------------------

const P = (path: string) => `/hr/self-service${path}`;

export const hrSelfServiceApi = {
  me: (): Promise<SelfServiceMe> =>
    api(P('/me')),

  leaveTypes: (): Promise<LeaveType[]> =>
    api(P('/leave-types')),

  leaveBalances: (year?: number): Promise<LeaveBalancesResponse> =>
    api(P(`/leave-balances${year ? `?year=${year}` : ''}`)),

  leaveRequests: (status?: LeaveStatus): Promise<{ beautician_id: string; rows: LeaveRequest[] }> =>
    api(P(`/leave-requests${status ? `?status=${status}` : ''}`)),

  leaveHistory: (year?: number): Promise<{ beautician_id: string; rows: LeaveRequest[] }> =>
    api(P(`/leave-history${year ? `?year=${year}` : ''}`)),

  holidays: (year?: number): Promise<Holiday[]> =>
    api(P(`/holidays${year ? `?year=${year}` : ''}`)),

  calendar: (month: string): Promise<CalendarResponse> =>
    api(P(`/calendar?month=${month}`)),

  rh: (year?: number): Promise<RHResponse> =>
    api(P(`/rh${year ? `?year=${year}` : ''}`)),

  createLeaveRequest: (body: {
    leave_type_id: string;
    from_date: string;
    to_date: string;
    day_part: LeaveDayPart;
    reason?: string;
    note?: string;
  }): Promise<LeaveRequest> =>
    api(P('/leave-requests'), { method: 'POST', body }),

  cancelLeaveRequest: (id: string, note?: string): Promise<LeaveRequest> =>
    api(P(`/leave-requests/${id}/cancel`), { method: 'POST', body: { note: note || '' } }),

  selectRestrictedHoliday: (holiday_id: string): Promise<RHResponse> =>
    api(P('/rh-selection'), { method: 'POST', body: { holiday_id } }),
};

// ---- Helpers -------------------------------------------------------------

/** Inclusive calendar-day count between two YYYY-MM-DD strings. */
export function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

/** Given the leave-type + range, produce the number of days that the API will bill us. */
export function computeDays(from: string, to: string, dayPart: LeaveDayPart): number {
  if (dayPart === 'first_half' || dayPart === 'second_half') return 0.5;
  return daysBetween(from, to);
}
