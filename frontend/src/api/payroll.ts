/**
 * Payroll & Salary API client — mirrors the web app's payroll surface.
 *
 * All calculations happen server-side. The mobile app only reads results and
 * triggers workflow actions (calculate / approve / finalize / cancel).
 *
 * Endpoints:
 *   GET/PUT  /payroll/settings
 *   GET/POST /payroll/components
 *   PUT/DELETE /payroll/components/:id
 *   POST     /payroll/components/:id/activate | :id/deactivate
 *   GET/POST /payroll/salary-profiles
 *   GET/POST /payroll/salary-changes
 *   GET      /payroll/tips
 *   GET/POST /payroll/variable-earnings
 *   PUT/DELETE /payroll/variable-earnings/:id
 *   GET/POST /payroll/runs
 *   GET      /payroll/runs/:id
 *   POST     /payroll/runs/:id/{calculate|approve|finalize|cancel|correct}
 *   GET      /payroll/runs/:id/export       (CSV)
 *   GET      /payroll/payslips/:itemId
 *   POST     /payroll/payslips/:itemId/email
 */
import { api } from './client';
import { API_BASE_URL, tokenStore, currentBranchStore } from './client';

export type PayrollSettings = {
  tenant_id: string;
  monthly_hours: number;
  ot_enabled: boolean;
  ot_method: 'fixed_per_hour' | 'basic_hourly';
  ot_multiplier: number;
  ot_rate: number;
  updated_at?: string;
};

export type SalaryComponent = {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  component_type: 'allowance' | 'deduction';
  calc_method: 'fixed' | 'percent_of_basic' | string;
  amount: number;
  percentage: number;
  base_code?: string;
  active: boolean;
  description?: string;
  created_at: string;
  updated_at: string;
};

export type SalaryProfileVersion = {
  id: string;
  tenant_id: string;
  beautician_id: string;
  branch_id: string;
  effective_from: string;
  effective_to?: string | null;
  basic_salary: number;
  components: Array<{ code: string; amount: number }>;
  note?: string;
  created_at: string;
};

export type SalaryHistoryResponse = {
  beautician_id: string;
  versions: SalaryProfileVersion[];
  current: { basic_salary: number; source: string; effective_from: string };
};

export type SalaryChange = {
  id: string;
  beautician_id: string;
  effective_from: string;
  basic_salary: number;
  note?: string;
  created_at: string;
};

export type VariableEarningType =
  | 'performance_incentive'
  | 'festival_bonus'
  | 'other';

export type VariableEarning = {
  id: string;
  tenant_id: string;
  beautician_id: string;
  branch_id: string;
  month: string; // YYYY-MM
  earning_type: string;
  earning_label?: string;
  amount: number;
  note?: string;
  status: 'active' | 'cancelled';
  created_at: string;
  updated_at: string;
};

export type PayrollRun = {
  id: string;
  tenant_id: string;
  branch_id: string;
  month: string;
  status: 'draft' | 'calculated' | 'approved' | 'finalized' | 'cancelled';
  beautician_ids: string[];
  totals: { gross: number; deductions: number; net: number; count: number };
  created_by?: string;
  created_at: string;
  calculated_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  finalized_by?: string | null;
  finalized_at?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  correction_of?: string | null;
};

export type PayrollItem = {
  id: string;
  run_id: string;
  beautician_id: string;
  beautician_name: string;
  employee_id?: string;
  designation?: string;
  phone?: string;
  email?: string;
  branch_id: string;
  month: string;
  currency: string;
  currency_symbol: string;
  earnings: Array<{ code: string; name: string; type: string; amount: number; earning_type?: string }>;
  deductions: Array<{ code: string; name: string; amount: number; reason?: string }>;
  gross: number;
  total_deductions: number;
  net: number;
  advance?: { outstanding: number; recovery_applied: number; carried_forward: number; remaining_balance: number };
  meta?: any;
  status?: string;
};

export type PayslipResponse = {
  item_id: string;
  salon: any;
  branch: any;
  employee: any;
  month: string;
  status: string;
  earnings: PayrollItem['earnings'];
  deductions: PayrollItem['deductions'];
  gross: number;
  total_deductions: number;
  net: number;
  advance?: PayrollItem['advance'];
  meta?: any;
  run: { id: string; status: string; finalized_at?: string };
};

export const payrollApi = {
  // ---- Settings ----
  getSettings: (): Promise<PayrollSettings> => api('/payroll/settings'),
  saveSettings: (body: Partial<PayrollSettings>): Promise<PayrollSettings> =>
    api('/payroll/settings', { method: 'PUT', body }),

  // ---- Components (Salary Structure) ----
  listComponents: (): Promise<SalaryComponent[]> => api('/payroll/components'),
  createComponent: (body: Partial<SalaryComponent>): Promise<SalaryComponent> =>
    api('/payroll/components', { method: 'POST', body }),
  updateComponent: (id: string, body: Partial<SalaryComponent>): Promise<SalaryComponent> =>
    api(`/payroll/components/${id}`, { method: 'PUT', body }),
  deleteComponent: (id: string): Promise<any> =>
    api(`/payroll/components/${id}`, { method: 'DELETE' }),
  activateComponent: (id: string): Promise<any> =>
    api(`/payroll/components/${id}/activate`, { method: 'POST' }),
  deactivateComponent: (id: string): Promise<any> =>
    api(`/payroll/components/${id}/deactivate`, { method: 'POST' }),

  // ---- Salary Profiles (per employee) ----
  salaryHistory: (beautician_id: string): Promise<SalaryHistoryResponse> =>
    api(`/payroll/salary-profiles?beautician_id=${beautician_id}`),
  createSalaryProfile: (body: {
    beautician_id: string;
    effective_from: string;
    basic_salary: number;
    components?: Array<{ code: string; amount: number }>;
    note?: string;
  }): Promise<SalaryProfileVersion> =>
    api('/payroll/salary-profiles', { method: 'POST', body }),
  salaryChanges: (beautician_id: string): Promise<{ changes: SalaryChange[]; count: number }> =>
    api(`/payroll/salary-changes?beautician_id=${beautician_id}`),
  addSalaryChange: (body: { beautician_id: string; effective_from: string; basic_salary: number; note?: string }): Promise<SalaryChange> =>
    api('/payroll/salary-changes', { method: 'POST', body }),

  // ---- Tips ----
  tips: (month: string): Promise<{ month: string; note: string; rows: any[] }> =>
    api(`/payroll/tips?month=${month}`),
  saveTips: (body: { month: string; beautician_id: string; amount: number }): Promise<any> =>
    api('/payroll/tips', { method: 'POST', body }),

  // ---- Variable Earnings ----
  listVariableEarnings: (params?: { beautician_id?: string; month?: string; status?: string }): Promise<VariableEarning[]> => {
    const p = new URLSearchParams();
    if (params?.beautician_id) p.set('beautician_id', params.beautician_id);
    if (params?.month) p.set('month', params.month);
    if (params?.status) p.set('status', params.status);
    const q = p.toString();
    return api(`/payroll/variable-earnings${q ? `?${q}` : ''}`);
  },
  createVariableEarning: (body: {
    beautician_id: string; month: string; earning_type: string; amount: number; note?: string;
  }): Promise<VariableEarning> =>
    api('/payroll/variable-earnings', { method: 'POST', body }),
  updateVariableEarning: (id: string, body: Partial<VariableEarning>): Promise<VariableEarning> =>
    api(`/payroll/variable-earnings/${id}`, { method: 'PUT', body }),
  deleteVariableEarning: (id: string): Promise<any> =>
    api(`/payroll/variable-earnings/${id}`, { method: 'DELETE' }),

  // ---- Payroll Runs ----
  listRuns: (params?: { month?: string; status?: string }): Promise<PayrollRun[]> => {
    const p = new URLSearchParams();
    if (params?.month) p.set('month', params.month);
    if (params?.status) p.set('status', params.status);
    const q = p.toString();
    return api(`/payroll/runs${q ? `?${q}` : ''}`);
  },
  createRun: (body: { month: string; beautician_ids?: string[] }): Promise<PayrollRun> =>
    api('/payroll/runs', { method: 'POST', body }),
  runDetail: (id: string): Promise<{ run: PayrollRun; items: PayrollItem[] }> =>
    api(`/payroll/runs/${id}`),
  calculateRun: (id: string): Promise<any> =>
    api(`/payroll/runs/${id}/calculate`, { method: 'POST' }),
  approveRun: (id: string): Promise<any> =>
    api(`/payroll/runs/${id}/approve`, { method: 'POST' }),
  finalizeRun: (id: string): Promise<any> =>
    api(`/payroll/runs/${id}/finalize`, { method: 'POST' }),
  cancelRun: (id: string, reason?: string): Promise<any> =>
    api(`/payroll/runs/${id}/cancel`, { method: 'POST', body: { reason: reason || '' } }),
  correctRun: (id: string): Promise<PayrollRun> =>
    api(`/payroll/runs/${id}/correct`, { method: 'POST' }),

  // ---- Payslip ----
  payslip: (itemId: string): Promise<PayslipResponse> =>
    api(`/payroll/payslips/${itemId}`),
  emailPayslip: (itemId: string, email?: string): Promise<any> =>
    api(`/payroll/payslips/${itemId}/email`, { method: 'POST', body: { email: email || '' } }),

  // ---- CSV Export (raw text; uses fetch directly to preserve BOM/UTF-8) ----
  exportRunCsv: async (runId: string): Promise<string> => {
    const token = await tokenStore.get();
    const bid = await currentBranchStore.get();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (bid) headers['X-Branch-Id'] = bid;
    const res = await fetch(`${API_BASE_URL}/api/payroll/runs/${runId}/export`, { headers });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.text();
  },
};

// ---- Helpers -----------------------------------------------------------

export const VARIABLE_EARNING_TYPES: { value: string; label: string }[] = [
  { value: 'performance_incentive', label: 'Performance Incentive' },
  { value: 'festival_bonus', label: 'Festival Bonus' },
  { value: 'other', label: 'Other' },
];

export const RUN_STATUS_COLOR: Record<string, { bg: string; fg: string; label: string }> = {
  draft:      { bg: '#EEE',    fg: '#6B6862', label: 'Draft' },
  calculated: { bg: '#FFF6E0', fg: '#B8860B', label: 'Calculated' },
  approved:   { bg: '#DEE9FA', fg: '#2A63B5', label: 'Approved' },
  finalized:  { bg: '#DDF3E4', fg: '#2F855A', label: 'Finalized' },
  cancelled:  { bg: '#FDECEC', fg: '#BA5454', label: 'Cancelled' },
};
