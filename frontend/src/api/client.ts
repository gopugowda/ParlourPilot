import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * =============================================================================
 * BACKEND URL RESOLUTION — READ THIS BEFORE TOUCHING
 * =============================================================================
 * Every deployed build MUST hit the shared production backend at
 *   https://parlourpilot.com
 * because that is where the web app and its MongoDB tenant live. If mobile hits
 * a different backend, it sees a *different* database (empty / stale data,
 * "Profile not linked", etc.).
 *
 * We use React Native's compile-time `__DEV__` global as the switch:
 *   • `__DEV__ === true`  → local dev via `expo start` (Metro sets this)
 *                            → use `.env` value (or the preview URL fallback)
 *   • `__DEV__ === false` → any published / release build (Emergent Publish,
 *                            EAS release, standalone) → **always** production URL
 *
 * Why not env vars? Emergent's Publish pipeline force-injects
 * `EXPO_PUBLIC_BACKEND_URL=https://salon-invoice-app.emergent.host` (this
 * project's K8s host), which is the *wrong* backend for our use-case. Any
 * env-var-based resolver would be silently overridden every publish. `__DEV__`
 * is baked in by Metro during bundle-time and cannot be flipped by an env var,
 * so it's tamper-proof.
 *
 * If you ever *want* a release build to hit preview instead, use the escape
 * hatch `EXPO_PUBLIC_BACKEND_URL_OVERRIDE=<url>` before building — it takes
 * precedence over everything else.
 * =============================================================================
 */
const PRODUCTION_BACKEND_URL = 'https://parlourpilot.com';
const PREVIEW_BACKEND_URL = 'https://staff-portal-331.preview.emergentagent.com';

function resolveBaseUrl(): string {
  // Escape hatch for anyone who genuinely needs a different backend in a build.
  const explicitOverride = process.env.EXPO_PUBLIC_BACKEND_URL_OVERRIDE;
  if (explicitOverride && explicitOverride.trim()) return explicitOverride.trim();

  // Production / released bundle — LOCK to parlourpilot.com. No fallback.
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return PRODUCTION_BACKEND_URL;
  }

  // Dev-only (Metro / expo start) — honour .env, then app.config.ts, then default.
  const runtimeBackend = (Constants.expoConfig?.extra as { backendUrl?: string } | undefined)?.backendUrl;
  const envUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  return runtimeBackend || envUrl || PREVIEW_BACKEND_URL;
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
};

export const tenantApi = {
  signup: (data: { business_name: string; owner_name: string; email: string; password: string; phone?: string; city?: string; country?: string; num_branches?: number; branch_names?: string[] }) =>
    api('/tenants/signup', { method: 'POST', body: data, auth: false }),
  getMine: () => api('/tenants/me'),
  updateMine: (data: any) => api('/tenants/me', { method: 'PUT', body: data }),
  subscription: () => api('/tenants/me/subscription'),
  plans: () => api('/subscription/plans', { auth: false }),
  // Razorpay tenant renewal
  createOrder: (data: { plan: 'monthly' | 'yearly'; display_amount?: number; display_currency?: string }) =>
    api('/tenants/checkout/order', { method: 'POST', body: data }),
  verifyPayment: (data: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) =>
    api('/tenants/checkout/verify', { method: 'POST', body: data }),
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

/** Unified billing endpoint (shared prod backend) — used for Growth upgrade and future add-ons. */
export const billingApi = {
  createOrder: (data: { kind: 'growth' | 'extra_branch'; plan: 'monthly' | 'yearly'; display_currency?: string }) =>
    api('/billing/checkout/order', { method: 'POST', body: data }),
  verifyPayment: (data: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) =>
    api('/billing/checkout/verify', { method: 'POST', body: data }),
  history: () => api('/billing/history'),
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
  deleteTenant: (tid: string) => api(`/platform/tenants/${tid}`, { method: 'DELETE' }),
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
