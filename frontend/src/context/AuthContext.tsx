import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  authApi, tenantApi, tokenStore, userStore, tenantStore, subscriptionStore,
  currentBranchStore,
  setSubscriptionExpiredListener, setUnauthorizedListener,
} from '../api/client';
import { setCurrencySymbol, CURRENCY_CHOICES, applyBrandColor, colors as themeColors, contrastText } from '../theme';

export type User = {
  id: string;
  tenant_id: string | null;
  branch_id?: string | null;
  name: string;
  email: string;
  role: 'admin' | 'owner' | 'staff' | 'platform_admin' | 'platform_staff' | 'super_admin';
  is_owner?: boolean;
  permissions?: Partial<Record<PermissionKey, boolean>>;
};

/** 11 permission keys. Owner (is_owner: true) is ALWAYS full-access. */
export const PERMISSION_KEYS = [
  'new_bill', 'bills', 'appointments', 'stock', 'expenses', 'cash_closing',
  'members', 'attendance', 'services', 'reports', 'multi_branch',
] as const;
export type PermissionKey = typeof PERMISSION_KEYS[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  new_bill: 'New Bill',
  bills: 'Bill History',
  appointments: 'Appointments',
  stock: 'Stock / Inventory',
  expenses: 'Expenses',
  cash_closing: 'Cash Closing',
  members: 'Members',
  attendance: 'Attendance (admin)',
  services: 'Services / price list',
  reports: 'Dashboard & Reports',
  multi_branch: 'Multi-branch switcher',
};

export type Branch = {
  id: string;
  tenant_id: string;
  name: string;
  address?: string;
  city?: string;
  is_head?: boolean;
  active?: boolean;
  invoice_prefix?: string;
  logo?: string | null;
  phone?: string;
  email?: string;
  tax_enabled?: boolean;
  tax_number?: string;
  tax_percentage?: number;
  receipt_header?: string;
  receipt_footer?: string;
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
  currency_symbol?: string;
  brand_color?: string;
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
  status: 'trialing' | 'active' | 'expired' | 'suspended' | 'cancelled' | 'platform_admin' | 'platform_staff';
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
  plan_tier?: 'starter' | 'growth';
};

type AuthCtx = {
  user: User | null;
  tenant: Tenant | null;
  subscription: Subscription | null;
  branches: Branch[];
  currentBranchId: string | null;
  loading: boolean;
  /** True once a login/signup/me response has been applied. Consumers should
   * gate any permission-derived UI on this — while false, `can()` returns
   * false for everything except owner/owner-role (Default Restricted). */
  permissionsReady: boolean;
  subscriptionExpired: boolean;
  brandColor: string;
  brandTextColor: string;
  themeRev: number;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => Promise<void>;
  refreshTenant: () => Promise<void>;
  refreshBranches: () => Promise<void>;
  selectBranch: (branchId: string | null) => Promise<void>;
  clearSubscriptionExpired: () => void;
  /** Check if the current user has a permission. Owner + admin always true.
   * When `permissionsReady` is false OR the backend didn't send a permissions
   * object, we default to **false** (restricted) — see `permissionsReady`. */
  can: (key: PermissionKey) => boolean;
  /** First tab the user has access to, for landing redirects. */
  firstAccessibleRoute: () => string;
};

const Ctx = createContext<AuthCtx>({} as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranchId, setCurrentBranchIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionExpired, setSubscriptionExpired] = useState(false);
  // Guards permission-derived UI. True only after login/signup/me applied.
  const [permissionsReady, setPermissionsReady] = useState(false);

  // Register listeners for global API events
  useEffect(() => {
    setSubscriptionExpiredListener(() => setSubscriptionExpired(true));
    setUnauthorizedListener(async () => {
      await tokenStore.clear();
      await userStore.clear();
      await tenantStore.clear();
      await subscriptionStore.clear();
      await currentBranchStore.clear();
      setUser(null); setTenant(null); setSubscription(null); setBranches([]); setCurrentBranchIdState(null);
      setPermissionsReady(false);
    });
  }, []);

  const applyTenantCurrency = (t: Tenant | null) => {
    if (!t) { setCurrencySymbol('₹', 'en-IN'); return; }
    if (t.currency_symbol) { setCurrencySymbol(t.currency_symbol); return; }
    const code = (t.currency || 'INR').toUpperCase();
    const choice = CURRENCY_CHOICES.find(c => c.code === code);
    setCurrencySymbol(choice?.symbol || '₹', choice?.locale);
  };

  const applyTenantBrand = (t: Tenant | null) => {
    // Reset to default red if tenant has no brand color set.
    applyBrandColor(t?.brand_color || '#C42032');
    // bump revision so consumers using useBrand() re-render
    setThemeRev(r => r + 1);
  };

  // Bumped whenever brand color changes so consumers re-render with new inline colors.
  const [themeRev, setThemeRev] = useState(0);

  const applyLoginResponse = async (res: any) => {
    const u = res.user;
    setUser(u);
    await userStore.set(u);
    if (res.tenant) { setTenant(res.tenant); await tenantStore.set(res.tenant); applyTenantCurrency(res.tenant); applyTenantBrand(res.tenant); }
    else { setTenant(null); await tenantStore.clear(); }
    if (res.subscription) {
      setSubscription(res.subscription);
      await subscriptionStore.set(res.subscription);
      if (['expired','suspended','cancelled'].includes(res.subscription.status)) setSubscriptionExpired(true);
      else setSubscriptionExpired(false);
    } else {
      // Platform accounts have no tenant/subscription — ensure the expired-flag never leaks
      // between account switches (e.g. sign out of an expired tenant → sign in as platform_admin).
      setSubscription(null);
      setSubscriptionExpired(false);
    }
    const brs: Branch[] = res.branches || [];
    setBranches(brs);
    // Default branch selection at login (mirrors the shared backend rule):
    //   • Owner OR (Admin WITH multi_branch permission) → NO branch header
    //     ⇒ backend returns tenant-wide aggregate ("Total Branch Revenue").
    //   • Admin WITHOUT multi_branch OR any staff role → LOCKED to their
    //     assigned branch (single-branch tenants naturally land here).
    //   • Any explicit branch previously picked by the user is preserved.
    const perms = (u?.permissions || {}) as Partial<Record<PermissionKey, boolean>>;
    const isOwnerRoleForBranch = !!u?.is_owner || u?.role === 'owner';
    // A user has multi_branch access when the flag is explicitly true; if the
    // permissions object is missing entirely (legacy accounts) we treat multi
    // as ON so we don't over-restrict.
    const hasMultiBranch = isOwnerRoleForBranch || perms.multi_branch === true || !u?.permissions;
    const seesAggregate = isOwnerRoleForBranch || (u?.role === 'admin' && hasMultiBranch);

    const previouslyPicked = await currentBranchStore.get();
    let bid: string | null = null;
    if (previouslyPicked && previouslyPicked !== '__all__') {
      // Reuse a valid prior selection (e.g. user picked a branch last session).
      const stillExists = brs.some(b => b.id === previouslyPicked);
      bid = stillExists ? previouslyPicked : null;
    }
    if (bid === null && !seesAggregate) {
      // Locked users (staff or single-branch admin) → their assigned branch,
      // falling back to head/first branch if none is set.
      bid = u?.branch_id || brs.find(b => b.is_head)?.id || brs[0]?.id || null;
    }
    // Otherwise leave bid = null → the backend defaults to tenant-wide aggregate.
    if (bid) {
      setCurrentBranchIdState(bid);
      await currentBranchStore.set(bid);
    } else {
      setCurrentBranchIdState(null);
      await currentBranchStore.clear();
    }

    // Mark permissions ready. Owner/owner-role bypass permissions checks entirely,
    // so they are always ready. For other roles, if the backend included a
    // `permissions` object we're good; otherwise we schedule a background /auth/me
    // hydration so the UI never gets stuck on the loading skeleton.
    const isOwnerRole = !!u?.is_owner || u?.role === 'owner';
    const hasPermsInResponse = u?.permissions !== undefined && u?.permissions !== null;
    if (isOwnerRole || hasPermsInResponse) {
      setPermissionsReady(true);
    } else {
      // Safety net: fetch again — if the server responds with permissions we flip
      // ready=true; otherwise we still flip ready=true so we don't spin forever
      // (in that pathological case, `can()` will simply return false and the user
      // will see the Default Restricted UI, which is safer than open access).
      setPermissionsReady(false);
      (async () => {
        try {
          const res: any = await authApi.me();
          if (res?.user) {
            setUser(res.user);
            await userStore.set(res.user);
          }
        } catch {}
        setPermissionsReady(true);
      })();
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const token = await tokenStore.get();
        if (token) {
          try {
            const res: any = await authApi.me();
            await applyLoginResponse(res);
          } catch {
            await tokenStore.clear();
            await userStore.clear();
            await tenantStore.clear();
            await subscriptionStore.clear();
            await currentBranchStore.clear();
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
    await applyLoginResponse(res);
  }, []);

  const signup = useCallback(async (data: SignupData) => {
    const res: any = await tenantApi.signup(data);
    await tokenStore.set(res.token);
    await applyLoginResponse(res);
  }, []);

  const logout = useCallback(async () => {
    await tokenStore.clear();
    await userStore.clear();
    await tenantStore.clear();
    await subscriptionStore.clear();
    await currentBranchStore.clear();
    setUser(null);
    setTenant(null);
    setSubscription(null);
    setBranches([]);
    setCurrentBranchIdState(null);
    setSubscriptionExpired(false);
    setPermissionsReady(false);
  }, []);

  const refreshTenant = useCallback(async () => {
    try {
      const res: any = await tenantApi.getMine();
      if (res.tenant) { setTenant(res.tenant); await tenantStore.set(res.tenant); applyTenantCurrency(res.tenant); applyTenantBrand(res.tenant); }
      if (res.subscription) {
        setSubscription(res.subscription);
        await subscriptionStore.set(res.subscription);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshBranches = useCallback(async () => {
    try {
      const res: any = await authApi.me();
      if (res.branches) setBranches(res.branches);
    } catch {}
  }, []);

  // Auto-refresh tenant + branches when app comes back to foreground.
  // Ensures logo / branding / branch changes done on the web app propagate to mobile.
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      const prev = appState.current;
      appState.current = next;
      if (prev.match(/inactive|background/) && next === 'active') {
        try {
          const token = await tokenStore.get();
          if (!token) return;
          // Full refresh: user (perms may change) + tenant + subscription + branches
          const res: any = await authApi.me().catch(() => null);
          if (res?.user) {
            setUser(res.user);
            await userStore.set(res.user);
          }
          if (res?.tenant) {
            setTenant(res.tenant);
            await tenantStore.set(res.tenant);
            applyTenantCurrency(res.tenant);
            applyTenantBrand(res.tenant);
          }
          if (res?.branches) setBranches(res.branches);
          if (res?.subscription) {
            setSubscription(res.subscription);
            await subscriptionStore.set(res.subscription);
          }
        } catch {}
      }
    });
    return () => sub.remove();
  }, []);

  const selectBranch = useCallback(async (branchId: string | null) => {
    if (branchId) await currentBranchStore.set(branchId);
    else await currentBranchStore.set('__all__');  // Sentinel: owner viewing aggregate
    setCurrentBranchIdState(branchId);
  }, []);

  const clearSubscriptionExpired = useCallback(() => setSubscriptionExpired(false), []);

  // ---- Permissions helper ----
  // Rules (in order):
  //   1) No user           → false (login required first)
  //   2) Owner / owner-role → true (always full access — no gating)
  //   3) Not yet ready     → false (Default Restricted while permissions load)
  //   4) No permissions obj → false (server didn't send perms; deny by default)
  //   5) Explicit flag     → !!user.permissions[key]
  const can = useCallback((key: PermissionKey): boolean => {
    if (!user) return false;
    if (user.is_owner || user.role === 'owner') return true;
    if (!permissionsReady) return false;
    if (!user.permissions) return false;
    return !!user.permissions[key];
  }, [user, permissionsReady]);

  const firstAccessibleRoute = useCallback((): string => {
    if (!user) return '/login';
    // Staff-role non-owners land on the Staff Dashboard (rendered inside /(tabs)/index).
    if (user.role === 'staff' && !user.is_owner) return '/(tabs)';
    // Owner / Admin — ALWAYS land on Dashboard regardless of the `reports`
    // permission (which now only unlocks financial KPIs, not the tab).
    if (user.is_owner || user.role === 'owner' || user.role === 'admin') return '/(tabs)';
    const perms = user.permissions || {};
    // Landing preference order for any remaining edge roles.
    if (perms.reports) return '/(tabs)';
    if (perms.new_bill) return '/(tabs)/new-bill';
    if (perms.bills) return '/(tabs)/history';
    if (perms.appointments) return '/manage/appointments';
    if (perms.expenses) return '/(tabs)/expenses';
    if (perms.members) return '/manage/members';
    if (perms.services) return '/manage/services';
    if (perms.stock) return '/manage/stock';
    if (perms.cash_closing) return '/manage/cash-closing';
    if (perms.attendance) return '/manage/attendance-report';
    // Everyone can punch their own attendance
    return '/manage/attendance';
  }, [user]);

  // Derived brand colors reflect the latest applied theme
  const brandColor = themeColors.brandPrimary;
  const brandTextColor = contrastText(brandColor);

  return (
    <Ctx.Provider value={{ user, tenant, subscription, branches, currentBranchId, loading, permissionsReady, subscriptionExpired, brandColor, brandTextColor, themeRev, login, signup, logout, refreshTenant, refreshBranches, selectBranch, clearSubscriptionExpired, can, firstAccessibleRoute }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
/** Convenience hook returning the tenant's brand color and its auto-contrast text color. */
export const useBrand = () => {
  const { brandColor, brandTextColor, themeRev } = useContext(Ctx);
  return { brandColor, brandTextColor, themeRev };
};
