import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

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
  opts: { method?: string; body?: any; auth?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await tokenStore.get();
    if (token) headers['Authorization'] = `Bearer ${token}`;
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
  signup: (data: { business_name: string; owner_name: string; email: string; password: string; phone?: string; city?: string; country?: string }) =>
    api('/tenants/signup', { method: 'POST', body: data, auth: false }),
  getMine: () => api('/tenants/me'),
  updateMine: (data: any) => api('/tenants/me', { method: 'PUT', body: data }),
  subscription: () => api('/tenants/me/subscription'),
};

export const platformApi = {
  tenants: () => api('/platform/tenants'),
  stats: () => api('/platform/stats'),
  updateTenant: (tid: string, data: any) => api(`/platform/tenants/${tid}`, { method: 'PUT', body: data }),
  setSubscription: (tid: string, data: any) => api(`/platform/tenants/${tid}/subscription`, { method: 'POST', body: data }),
};
