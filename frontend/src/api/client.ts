import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * =============================================================================
 * BACKEND URL RESOLUTION — READ THIS BEFORE TOUCHING
 * =============================================================================
 * The mobile app is a UI mirror of the ParlourPilot web app and MUST consume
 * the shared web-app backend at parlourpilot.com — that is where the HR,
 * Leave, Payroll, Commission, tenant, and MongoDB actually live.
 *
 * The Emergent-hosted pod that serves THIS mobile project
 * (salon-invoice-app.emergent.host) is only a build/serve host for the Expo
 * bundle. Its FastAPI does NOT contain HR / Payroll / Leave routes. If mobile
 * calls it, every HR/Payroll screen returns 404 "Not Found".
 *
 * WHY WE CAN'T RELY ON `__DEV__` ALONE:
 *   Emergent's Publish pipeline runs Expo Go on the phone with a "released"
 *   bundle, but Expo Go itself always sets __DEV__ = true when hosting *any*
 *   remote bundle. That means the previous "if !__DEV__ → parlourpilot.com"
 *   check was silently skipped for the Emergent-published build and the
 *   pipeline-injected `EXPO_PUBLIC_BACKEND_URL=salon-invoice-app.emergent.host`
 *   became the base URL → 404 everywhere.
 *
 * WHY WE CAN'T RELY ON `EXPO_PUBLIC_BACKEND_URL` EITHER:
 *   Emergent Publish force-injects it to the wrong host. That override cannot
 *   be trusted for base-URL resolution.
 *
 * NEW RESOLVER RULE:
 *   1. If `EXPO_PUBLIC_BACKEND_URL_OVERRIDE` is explicitly set → use it.
 *      (Escape hatch used by the developer's local .env for QA against a
 *      specific backend.)
 *   2. If we are inside local-Metro dev (Constants.expoConfig.hostUri is a
 *      LAN / loopback address) → use PREVIEW_BACKEND_URL so QA screenshots
 *      see live data.
 *   3. Everything else (Emergent Publish → Expo Go, EAS release, standalone,
 *      web preview served from the pod) → LOCK to PRODUCTION_BACKEND_URL.
 *
 * This is deterministic, does not depend on __DEV__, and cannot be flipped
 * by any env var that the deploy pipeline might inject downstream.
 * =============================================================================
 */
const PRODUCTION_BACKEND_URL = 'https://parlourpilot.com';
const PREVIEW_BACKEND_URL = 'https://staff-portal-331.preview.emergentagent.com';

/** URL host regexes that are NEVER the ParlourPilot web-app backend and thus
 *  MUST be ignored if injected into any env var. */
const FORBIDDEN_HOST_PATTERNS: RegExp[] = [
  /salon-invoice-app\.emergent\.host/i,
  /salon-invoice-app\.[^/]*emergentagent\.com/i,
];

function isForbidden(u: string): boolean {
  return FORBIDDEN_HOST_PATTERNS.some(re => re.test(u));
}

function resolveBaseUrl(): string {
  // 1) Explicit override in developer .env — always wins.
  const explicitOverride = process.env.EXPO_PUBLIC_BACKEND_URL_OVERRIDE?.trim();
  if (explicitOverride && !isForbidden(explicitOverride)) return explicitOverride;

  // 2) Local Metro dev? Detect via hostUri = LAN / loopback address.
  const hostUri = String(Constants.expoConfig?.hostUri || '');
  const isLocalMetro = /^(192\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)/.test(hostUri);
  if (isLocalMetro) {
    // Honour env only if it's not the forbidden pod URL.
    const envUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
    if (envUrl && !isForbidden(envUrl)) return envUrl;
    return PREVIEW_BACKEND_URL;
  }

  // 3) Anything else — Emergent Publish, EAS release, standalone, hosted web
  //    preview — MUST hit the shared production web-app backend. Ignore any
  //    EXPO_PUBLIC_BACKEND_URL that the deploy pipeline may have injected.
  return PRODUCTION_BACKEND_URL;
}

const BASE_URL = resolveBaseUrl();

// Exported so the Staff Dashboard "Connection diagnostics" alert can show the
// *actual* URL that HTTP requests are using — not a re-derivation that might
// drift from this file's rules.
export const API_BASE_URL = BASE_URL;

const TOKEN_KEY = 'parlourpilot_auth_token';
const USER_KEY = 'parlourpilot_auth_user';
const TENANT_KEY = 'parlourpilot_auth_tenant';
const SUBSCRIPTION_KEY = 'parlourpilot_auth_subscription';

// Web fallback for SecureStore (SecureStore is native-only)
const storage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') {
      try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === 'web') {
      try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch {}
      return;
    }
    return SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string) {
    if (Platform.OS === 'web') {
      try { if (typeof window !== 'undefined') window.localStorage.removeItem(key); } catch {}
      return;
    }
    return SecureStore.deleteItemAsync(key);
  },
};

export const tokenStore = {
  get: () => storage.getItem(TOKEN_KEY),
  set: (t: string) => storage.setItem(TOKEN_KEY, t),
  clear: () => storage.removeItem(TOKEN_KEY),
};

export const userStore = {
  get: async () => {
    const raw = await storage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set: (u: any) => storage.setItem(USER_KEY, JSON.stringify(u)),
  clear: () => storage.removeItem(USER_KEY),
};

export const tenantStore = {
  get: async () => {
    const raw = await storage.getItem(TENANT_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set: (t: any) => storage.setItem(TENANT_KEY, JSON.stringify(t)),
  clear: () => storage.removeItem(TENANT_KEY),
};

export const subscriptionStore = {
  get: async () => {
    const raw = await storage.getItem(SUBSCRIPTION_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set: (s: any) => storage.setItem(SUBSCRIPTION_KEY, JSON.stringify(s)),
  clear: () => storage.removeItem(SUBSCRIPTION_KEY),
};

// Current branch selector (owner can switch, staff is pinned)
const BRANCH_KEY = 'parlourpilot_current_branch_id';
export const currentBranchStore = {
  get: () => storage.getItem(BRANCH_KEY),
  set: (b: string) => storage.setItem(BRANCH_KEY, b),
  clear: () => storage.removeItem(BRANCH_KEY),
};

// Global listener for subscription-expired responses (402)
let subscriptionExpiredListener: (() => void) | null = null;
export function setSubscriptionExpiredListener(fn: () => void) {
  subscriptionExpiredListener = fn;
}

// Global listener for unauthorized responses (401) - triggers logout
let unauthorizedListener: (() => void) | null = null;
export function setUnauthorizedListener(fn: () => void) {
  unauthorizedListener = fn;
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean; branchId?: string | null } = {}
): Promise<T> {
  const { method = 'GET', body, auth = true, branchId } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await tokenStore.get();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Include current branch header if set (opt-in via branchId param or global store)
    const bid = branchId !== undefined ? branchId : await currentBranchStore.get();
    if (bid) headers['X-Branch-Id'] = bid;
  }
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    const message = typeof msg === 'string' ? msg : JSON.stringify(msg);

    if (res.status === 401 && auth) {
      if (unauthorizedListener) unauthorizedListener();
    }
    if (res.status === 402) {
      if (subscriptionExpiredListener) subscriptionExpiredListener();
    }
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

export const authApi = {
  login: (email: string, password: string) => api('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => api('/auth/me'),
  register: (data: { name: string; email: string; password: string; role: 'admin' | 'staff' }) =>
    api('/auth/register', { method: 'POST', body: data }),
  users: () => api('/auth/users'),
  seed: () => api('/seed', { method: 'POST', auth: false }),
  deleteOwnAccount: () => api('/auth/me', { method: 'DELETE' }),
  // Apple 5.1.1(v) — in-app business-account deletion. Owner-only. See
  // backend route in routes/auth.py::delete_account for exact behaviour.
  deleteBusinessAccount: (data: { password: string; confirm_text: string }) =>
    api<{ ok: boolean; summary?: any; message?: string }>(
      '/auth/delete-account',
      { method: 'POST', body: data },
    ),
};

export const tenantApi = {
  signup: (data: { business_name: string; owner_name: string; email: string; password: string; phone?: string; city?: string; country?: string; plan_tier?: 'starter' | 'growth' }) =>
    api('/tenants/signup', { method: 'POST', body: data, auth: false }),
  getMine: () => api('/tenants/me'),
  updateMine: (data: any) => api('/tenants/me', { method: 'PUT', body: data }),
  subscription: () => api('/tenants/me/subscription'),
  plans: () => api('/subscription/plans', { auth: false }),
  // Razorpay tenant renewal (INR only; server returns amount in paise)
  createOrder: (data: { plan: 'monthly' | 'yearly' }) =>
    api('/tenants/checkout/order', { method: 'POST', body: data }),
  verifyPayment: (data: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) =>
    api('/tenants/checkout/verify', { method: 'POST', body: data }),
  downgrade: () => api('/billing/downgrade', { method: 'POST' }),
  cancelDowngrade: () => api('/billing/downgrade/cancel', { method: 'POST' }),
  cancelSubscription: () => api('/tenants/me/subscription/cancel', { method: 'POST' }),
  resumeSubscription: () => api('/tenants/me/subscription/resume', { method: 'POST' }),
};

export const branchApi = {
  list: () => api('/branches'),
  create: (data: any) => api('/branches', { method: 'POST', body: data }),
  update: (bid: string, data: any) => api(`/branches/${bid}`, { method: 'PUT', body: data }),
  remove: (bid: string) => api(`/branches/${bid}`, { method: 'DELETE' }),
  // Legacy mock checkout (kept for backwards compatibility)
  checkout: (data: { plan: 'monthly' | 'yearly'; branch: any; amount_inr?: number; display_amount?: number; display_currency?: string; payment_reference?: string }) =>
    api('/branches/checkout', { method: 'POST', body: data }),
  // NEW: Razorpay flow
  createOrder: (data: { plan: 'monthly' | 'yearly'; branch: any; display_amount?: number; display_currency?: string }) =>
    api('/branches/checkout/order', { method: 'POST', body: data }),
  verifyPayment: (data: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) =>
    api('/branches/checkout/verify', { method: 'POST', body: data }),
  pricing: () => api('/pricing'),
};

/** Unified billing endpoint (shared prod backend) — INR-only. */
export const billingApi = {
  entitlements: () => api('/billing/entitlements'),
  createOrder: (data: { kind: 'growth' | 'extra_branch'; plan: 'monthly' | 'yearly' }) =>
    api('/billing/checkout/order', { method: 'POST', body: data }),
  verifyPayment: (data: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) =>
    api('/billing/checkout/verify', { method: 'POST', body: data }),
  history: () => api('/billing/history'),
  ackReceipt: (rid: string) => api(`/billing/receipts/${rid}/ack`, { method: 'POST' }),
};

export const paymentsApi = {
  config: () => api('/payments/config'),
};

export const appointmentApi = {
  list: (params?: { date_from?: string; date_to?: string; status?: string; beautician_id?: string; limit?: number }) => {
    const q = params ? '?' + Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&') : '';
    return api(`/appointments${q}`);
  },
  create: (data: any) => api('/appointments', { method: 'POST', body: data }),
  update: (aid: string, data: any) => api(`/appointments/${aid}`, { method: 'PUT', body: data }),
  remove: (aid: string) => api(`/appointments/${aid}`, { method: 'DELETE' }),
  stats: () => api('/appointments/stats'),
  /**
   * Send a booking-confirmation notification for an existing appointment.
   * Reuses the shared web+mobile backend endpoint — DO NOT build a mobile-
   * specific notifier. The backend is the single source of truth.
   *
   *   channels: ("whatsapp" | "email")[]  — at least one required
   *
   * Backend behaviour (existing):
   *   • Re-fetches the appointment under tenant/branch scope (404 if not found).
   *   • Returns a `wa.me` URL with status `opened_pending` for WhatsApp —
   *     the mobile client must open that URL and let the staff tap Send
   *     manually. We NEVER claim WhatsApp was delivered.
   *   • For email, actually sends via the shared email infra and returns
   *     the real result (`sent` / error message).
   */
  sendConfirmation: (aid: string, channels: Array<'whatsapp' | 'email'>) =>
    api(`/appointments/${aid}/send-confirmation`, { method: 'POST', body: { channels } }),
};

export const platformApi = {
  tenants: () => api('/platform/tenants'),
  stats: () => api('/platform/stats'),
  updateTenant: (tid: string, data: any) => api(`/platform/tenants/${tid}`, { method: 'PUT', body: data }),
  setSubscription: (tid: string, data: any) => api(`/platform/tenants/${tid}/subscription`, { method: 'POST', body: data }),
  resetPassword: (tid: string, data: { user_id?: string; email?: string; new_password: string }) =>
    api(`/platform/tenants/${tid}/reset-password`, { method: 'POST', body: data }),
  listTenantUsers: (tid: string) => api(`/platform/tenants/${tid}/users`),
  // New: detailed view + delete + CSV export
  tenantDetail: (tid: string) => api(`/platform/tenants/${tid}/detail`),
  /**
   * PERMANENT tenant deletion — high-risk, super-admin only.
   * Server re-validates both fields: `confirm_name` must equal
   * tenant.business_name and `confirm_phrase` must equal the
   * literal string "DELETE PERMANENTLY". Never call this without the
   * two-step modal in the UI.
   */
  deleteTenant: (tid: string, body: { confirm_name: string; confirm_phrase: string; reason?: string }) =>
    api(`/platform/tenants/${tid}`, { method: 'DELETE', body }),
  /**
   * Reversible tenant lifecycle: suspend (deactivate) or restore.
   * `action: 'suspend'` requires `confirm_name` matching business_name.
   * `action: 'restore'` needs no extra confirmation. Both are idempotent.
   */
  tenantStatus: (tid: string, body: { action: 'suspend' | 'restore'; confirm_name?: string; reason?: string }) =>
    api(`/platform/tenants/${tid}/status`, { method: 'POST', body }),
  /** Read-only audit trail for a tenant's lifecycle actions. */
  tenantAudit: (tid: string) => api<{ rows: { action: string; admin_email?: string; reason?: string; at: string }[] }>(`/platform/tenants/${tid}/audit`),
  exportCsv: () => api('/platform/tenants/export'),
  // Platform user management (admin only for mutations)
  listPlatformUsers: () => api('/platform/users'),
  createPlatformUser: (data: { name: string; email: string; password: string; role: 'platform_admin' | 'platform_staff' }) =>
    api('/platform/users', { method: 'POST', body: data }),
  updatePlatformUser: (uid: string, data: { name?: string; role?: 'platform_admin' | 'platform_staff'; is_active?: boolean }) =>
    api(`/platform/users/${uid}`, { method: 'PUT', body: data }),
  deletePlatformUser: (uid: string) => api(`/platform/users/${uid}`, { method: 'DELETE' }),
  resetPlatformUserPassword: (uid: string, new_password: string) =>
    api(`/platform/users/${uid}/reset-password`, { method: 'POST', body: { new_password } }),
};
