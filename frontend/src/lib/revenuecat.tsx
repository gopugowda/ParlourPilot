/**
 * RevenueCat client integration for ParlourPilot iOS in-app subscriptions.
 *
 * ARCHITECTURE (see /app/memory/revenuecat.md for the full map):
 *   Apple StoreKit → RevenueCat → this file → /api/billing/revenuecat/sync
 *   → tenant.subscription_provider = "apple" + tenant.apple_* fields
 *   → existing ParlourPilot plan/branch/staff enforcement still applies.
 *
 * KEY RULES (per user directive + integration_expert playbook):
 *   1. AppUser ID = tenant.id (UUIDv4). Never anonymous. Never owner user.id.
 *   2. Purchases.configure() at module scope, called ONCE per app launch.
 *   3. Purchases.logIn(tenant.id) on every auth path (login / signup / restore).
 *      Purchases.logOut() on sign-out.
 *   4. iOS is the ONLY store platform for now. Android/web still use Razorpay.
 *   5. Backend is authoritative for plan enforcement — we do NOT gate features
 *      purely on customerInfo.entitlements.active. The mobile client relays
 *      the CustomerInfo to /api/billing/revenuecat/sync and the backend
 *      re-verifies via RevenueCat REST API before persisting.
 *   6. No introductory offers configured (preserves our 15-day backend trial).
 *   7. Four ParlourPilot products in one Apple subscription group:
 *        com.parlourpilot.app.starter.monthly → plan_starter
 *        com.parlourpilot.app.starter.yearly  → plan_starter
 *        com.parlourpilot.app.growth.monthly  → plan_growth
 *        com.parlourpilot.app.growth.yearly   → plan_growth
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { CustomerInfo, PurchasesPackage, PurchasesOffering } from 'react-native-purchases';

// ---- Env / feature-flag -----------------------------------------------------
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
const TEST_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;

// iOS is the only store platform for ParlourPilot at this stage. On Android
// we keep the existing Razorpay flow; on web (Expo web) Purchases can run
// against RevenueCat Test Store in __DEV__ builds so the paywall preview
// works but real purchases never happen.
export const rcEnabled = Platform.OS === 'ios' || (Platform.OS === 'web' && __DEV__);

function pickApiKey(): string | null {
  if (!IOS_KEY || !ANDROID_KEY || !TEST_KEY) return null;
  if (Platform.OS === 'web' || __DEV__) return TEST_KEY;
  if (Platform.OS === 'ios') return IOS_KEY;
  return null;
}

// ---- Public entitlement / product identifiers -------------------------------
// Set once, referenced everywhere. If we ever rename, we do it in ONE place.
export const ENTITLEMENT_STARTER = 'plan_starter';
export const ENTITLEMENT_GROWTH = 'plan_growth';

export const PRODUCT_IDS = {
  starterMonthly: 'com.parlourpilot.app.starter.monthly',
  starterYearly: 'com.parlourpilot.app.starter.yearly',
  growthMonthly: 'com.parlourpilot.app.growth.monthly',
  growthYearly: 'com.parlourpilot.app.growth.yearly',
} as const;

// ---- Module-scope initialization -------------------------------------------
// Playbook rule: configure() at module scope, outside any component, called
// EXACTLY once per app launch. NEVER pass appUserID here — that comes later
// via Purchases.logIn(tenant.id) once the user is authenticated.
let _rcConfigured = false;
export function initializeRevenueCat(): void {
  if (!rcEnabled || _rcConfigured) return;
  const apiKey = pickApiKey();
  if (!apiKey) {
    console.warn('[RevenueCat] API keys missing — skipping SDK init');
    return;
  }
  try {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
    Purchases.configure({ apiKey });
    _rcConfigured = true;
  } catch (err) {
    console.warn('[RevenueCat] configure() failed:', err);
  }
}

// ---- Provider context ------------------------------------------------------
type PurchaseTier = 'starter' | 'growth';
type PurchasePeriod = 'monthly' | 'yearly';

interface RCContextValue {
  ready: boolean;                   // true when the SDK is configured + logged-in
  identityReady: boolean;           // true only when logged-in with a real tenant.id
  loadingOfferings: boolean;
  customerInfo: CustomerInfo | null;
  offering: PurchasesOffering | null;
  isStarter: boolean;
  isGrowth: boolean;
  isSubscribed: boolean;            // starter OR growth
  packages: Partial<Record<`${PurchaseTier}_${PurchasePeriod}`, PurchasesPackage>>;
  identityError: string | null;
  purchase: (pkg: PurchasesPackage) => Promise<CustomerInfo>;
  restore: () => Promise<CustomerInfo>;
  refresh: () => Promise<void>;
  showManageSubscriptions: () => Promise<void>;
}

const RCContext = createContext<RCContextValue | null>(null);

export function RevenueCatProvider({
  tenantId,
  children,
}: {
  tenantId: string | null | undefined;
  children: React.ReactNode;
}) {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [loadingOfferings, setLoadingOfferings] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const boundRef = useRef<string | null>(null);

  // Identity binding. Rebinds when tenantId flips; logs out when tenantId
  // becomes null (sign-out). NEVER swallow errors — an anonymous purchase
  // cannot be mapped back to a ParlourPilot business.
  useEffect(() => {
    if (!rcEnabled || !_rcConfigured) return;
    (async () => {
      try {
        if (tenantId && boundRef.current !== tenantId) {
          const { customerInfo: info } = await Purchases.logIn(tenantId);
          boundRef.current = tenantId;
          setCustomerInfo(info);
          setIdentityError(null);
        } else if (!tenantId && boundRef.current) {
          await Purchases.logOut();
          boundRef.current = null;
          setCustomerInfo(null);
          setOffering(null);
        }
      } catch (e: any) {
        setIdentityError(e?.message || String(e));
      }
    })();
  }, [tenantId]);

  // Listen for SDK-pushed CustomerInfo updates (post-purchase, renewals,
  // background refresh). Never poll — the SDK pushes.
  useEffect(() => {
    if (!rcEnabled || !_rcConfigured) return;
    const listener = (info: CustomerInfo) => setCustomerInfo(info);
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  // Fetch the single 'default' offering, which contains our 4 ParlourPilot
  // packages after manual RevenueCat dashboard configuration. Package lookup
  // keys are: $rc_starter_monthly / $rc_starter_yearly / $rc_growth_monthly /
  // $rc_growth_yearly.
  useEffect(() => {
    if (!rcEnabled || !_rcConfigured || !tenantId) return;
    setLoadingOfferings(true);
    Purchases.getOfferings()
      .then((o) => setOffering(o.current || null))
      .catch((e) => console.warn('[RevenueCat] getOfferings failed:', e))
      .finally(() => setLoadingOfferings(false));
  }, [tenantId]);

  // Resolve our 4 packages by their lookup keys (fallback to product-id match
  // in case the dashboard still uses standard $rc_monthly / $rc_annual keys).
  const packages: RCContextValue['packages'] = React.useMemo(() => {
    if (!offering) return {};
    const byKey = (key: string) => offering.availablePackages.find((p) => p.identifier === key);
    const byProduct = (id: string) =>
      offering.availablePackages.find((p) => p.product.identifier === id);
    return {
      starter_monthly:
        byKey('$rc_starter_monthly') || byProduct(PRODUCT_IDS.starterMonthly),
      starter_yearly:
        byKey('$rc_starter_yearly') || byProduct(PRODUCT_IDS.starterYearly),
      growth_monthly:
        byKey('$rc_growth_monthly') || byProduct(PRODUCT_IDS.growthMonthly),
      growth_yearly:
        byKey('$rc_growth_yearly') || byProduct(PRODUCT_IDS.growthYearly),
    };
  }, [offering]);

  const isStarter = !!customerInfo?.entitlements.active?.[ENTITLEMENT_STARTER];
  const isGrowth = !!customerInfo?.entitlements.active?.[ENTITLEMENT_GROWTH];
  const identityReady =
    !!customerInfo?.originalAppUserId &&
    !customerInfo.originalAppUserId.startsWith('$RCAnonymousID:');

  const purchase = async (pkg: PurchasesPackage) => {
    // Defensive: block anonymous purchases even if SDK slipped through.
    const cur = await Purchases.getCustomerInfo();
    if (cur.originalAppUserId.startsWith('$RCAnonymousID:')) {
      throw new Error('identity_not_ready');
    }
    const { customerInfo: after } = await Purchases.purchasePackage(pkg);
    setCustomerInfo(after);
    return after;
  };

  const restore = async () => {
    // Restore MUST happen only when a tenant.id is bound. Otherwise the Apple
    // purchase could be re-attributed to whoever logs in on this device
    // later — which for a B2B multi-tenant app is a data-leak.
    if (!identityReady) throw new Error('identity_not_ready');
    const info = await Purchases.restorePurchases();
    setCustomerInfo(info);
    return info;
  };

  const refresh = async () => {
    try {
      const info = await Purchases.getCustomerInfo();
      setCustomerInfo(info);
    } catch (e) {
      console.warn('[RevenueCat] refresh failed:', e);
    }
  };

  const showManageSubscriptions = async () => {
    // iOS 15+: opens the StoreKit sheet inside the app (no navigation away).
    // Older iOS or web: fall back to the App Store account subscriptions page.
    try {
      // @ts-ignore — showManageSubscriptions is only on native.
      if (typeof Purchases.showManageSubscriptions === 'function') {
        await Purchases.showManageSubscriptions();
        return;
      }
    } catch {
      /* fall through */
    }
    const { Linking } = await import('react-native');
    await Linking.openURL('https://apps.apple.com/account/subscriptions');
  };

  const value: RCContextValue = {
    ready: !!(_rcConfigured && tenantId),
    identityReady,
    loadingOfferings,
    customerInfo,
    offering,
    isStarter,
    isGrowth,
    isSubscribed: isStarter || isGrowth,
    packages,
    identityError,
    purchase,
    restore,
    refresh,
    showManageSubscriptions,
  };
  return <RCContext.Provider value={value}>{children}</RCContext.Provider>;
}

export function useRevenueCat(): RCContextValue {
  const ctx = useContext(RCContext);
  if (!ctx) {
    // Provider not mounted (e.g. on the login screen before auth). Return a
    // safe no-op so callers can render without crashing.
    return {
      ready: false,
      identityReady: false,
      loadingOfferings: false,
      customerInfo: null,
      offering: null,
      isStarter: false,
      isGrowth: false,
      isSubscribed: false,
      packages: {},
      identityError: null,
      purchase: async () => { throw new Error('RevenueCat not ready'); },
      restore: async () => { throw new Error('RevenueCat not ready'); },
      refresh: async () => {},
      showManageSubscriptions: async () => {},
    };
  }
  return ctx;
}
