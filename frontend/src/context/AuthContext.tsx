import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  authApi, tenantApi, tokenStore, userStore, tenantStore, subscriptionStore,
  setSubscriptionExpiredListener, setUnauthorizedListener,
} from '../api/client';

export type User = {
  id: string;
  tenant_id: string | null;
  name: string;
  email: string;
  role: 'admin' | 'owner' | 'staff' | 'platform_admin';
};

export type Tenant = {
  id: string;
  business_name: string;
  slug: string;
  logo?: string | null;
  owner_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  currency?: string;
  timezone?: string;
  tax_enabled?: boolean;
  tax_number?: string;
  tax_percentage?: number;
  invoice_prefix?: string;
  receipt_header?: string;
  receipt_footer?: string;
  website?: string;
  member_discount_pct?: number;
  member_min_price?: number;
  subscription_plan?: string;
  subscription_status?: string;
  is_active?: boolean;
};

export type Subscription = {
  status: 'trialing' | 'active' | 'expired' | 'suspended' | 'cancelled' | 'platform_admin';
  days_left?: number | null;
  trial_end_date?: string | null;
  subscription_end_date?: string | null;
  subscription_plan?: string;
};

type SignupData = {
  business_name: string;
  owner_name: string;
  email: string;
  password: string;
  phone?: string;
  city?: string;
};

type AuthCtx = {
  user: User | null;
  tenant: Tenant | null;
  subscription: Subscription | null;
  loading: boolean;
  subscriptionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => Promise<void>;
  refreshTenant: () => Promise<void>;
  clearSubscriptionExpired: () => void;
};

const Ctx = createContext<AuthCtx>({} as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionExpired, setSubscriptionExpired] = useState(false);

  // Register listeners for global API events
  useEffect(() => {
    setSubscriptionExpiredListener(() => setSubscriptionExpired(true));
    setUnauthorizedListener(async () => {
      await tokenStore.clear();
      await userStore.clear();
      await tenantStore.clear();
      await subscriptionStore.clear();
      setUser(null); setTenant(null); setSubscription(null);
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = await tokenStore.get();
        if (token) {
          try {
            const res: any = await authApi.me();
            const u = res.user || res;
            setUser(u);
            if (res.tenant) { setTenant(res.tenant); await tenantStore.set(res.tenant); }
            if (res.subscription) {
              setSubscription(res.subscription);
              await subscriptionStore.set(res.subscription);
              if (res.subscription.status === 'expired' || res.subscription.status === 'suspended' || res.subscription.status === 'cancelled') {
                setSubscriptionExpired(true);
              }
            }
          } catch {
            await tokenStore.clear();
            await userStore.clear();
            await tenantStore.clear();
            await subscriptionStore.clear();
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res: any = await authApi.login(email, password);
    await tokenStore.set(res.token);
    await userStore.set(res.user);
    setUser(res.user);
    if (res.tenant) { setTenant(res.tenant); await tenantStore.set(res.tenant); }
    else { setTenant(null); await tenantStore.clear(); }
    if (res.subscription) {
      setSubscription(res.subscription);
      await subscriptionStore.set(res.subscription);
      if (res.subscription.status === 'expired' || res.subscription.status === 'suspended' || res.subscription.status === 'cancelled') {
        setSubscriptionExpired(true);
      } else {
        setSubscriptionExpired(false);
      }
    } else {
      setSubscription(null);
    }
  }, []);

  const signup = useCallback(async (data: SignupData) => {
    const res: any = await tenantApi.signup(data);
    await tokenStore.set(res.token);
    await userStore.set(res.user);
    setUser(res.user);
    if (res.tenant) { setTenant(res.tenant); await tenantStore.set(res.tenant); }
    if (res.subscription) {
      setSubscription(res.subscription);
      await subscriptionStore.set(res.subscription);
    }
    setSubscriptionExpired(false);
  }, []);

  const logout = useCallback(async () => {
    await tokenStore.clear();
    await userStore.clear();
    await tenantStore.clear();
    await subscriptionStore.clear();
    setUser(null);
    setTenant(null);
    setSubscription(null);
    setSubscriptionExpired(false);
  }, []);

  const refreshTenant = useCallback(async () => {
    try {
      const res: any = await tenantApi.getMine();
      if (res.tenant) { setTenant(res.tenant); await tenantStore.set(res.tenant); }
      if (res.subscription) {
        setSubscription(res.subscription);
        await subscriptionStore.set(res.subscription);
      }
    } catch {}
  }, []);

  const clearSubscriptionExpired = useCallback(() => setSubscriptionExpired(false), []);

  return (
    <Ctx.Provider value={{ user, tenant, subscription, loading, subscriptionExpired, login, signup, logout, refreshTenant, clearSubscriptionExpired }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
