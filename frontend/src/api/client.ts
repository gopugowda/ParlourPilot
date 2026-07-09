import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const TOKEN_KEY = 'glowup_auth_token';
const USER_KEY = 'glowup_auth_user';

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
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
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
};
