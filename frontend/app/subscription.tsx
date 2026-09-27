/**
 * Subscription & Billing screen — INR-only, entitlement-driven.
 *
 * Consumes GET /api/billing/entitlements (authoritative renewal breakdown,
 * usage counters, feature flags). Never computes prices client-side.
 *
 * Uses Razorpay checkout via billing/checkout/order + verify for growth
 * upgrade and additional-branch add-on, and tenants/checkout for renewal.
 *
 * All amounts are in Indian Rupees. Server returns:
 *   - *_price fields in paise (divide by 100)
 *   - renewal.*_inr fields already in rupees
 *
 * Crash-safety: EVERY numeric render uses Number(x ?? 0).toLocaleString('en-IN').
 * Nothing derefs a possibly-undefined field.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Platform, Linking, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';

import { billingApi, tenantApi, paymentsApi, api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { useRevenueCat } from '@/src/lib/revenuecat';

const SUPPORT_EMAIL = 'support@parlourpilot.com';

// ------------- Types (all fields optional-friendly by design) --------------
type Renewal = {
  tier?: 'starter' | 'growth' | string;
  interval?: 'monthly' | 'yearly' | string;
  currency?: string;
  base_inr?: number;
  addon_qty?: number;
  addon_unit_inr?: number;
  addon_total_inr?: number;
  total_inr?: number;
};

type Ent = {
  plan?: 'starter' | 'growth' | 'legacy' | string;
  plan_tier?: string;
  status?: string;
  grandfathered?: boolean;
  billing_currency?: string;
  billing_interval?: 'monthly' | 'yearly' | string;

  base_branch_limit?: number;
  base_user_limit?: number;
  additional_branch_addons?: number;
  extra_branch_slots?: number;
  effective_branch_limit?: number;
  effective_user_limit?: number;

  staff_used?: number;
  branch_count?: number;
  can_add_staff?: boolean;
  can_add_branch?: boolean;

  all_features?: boolean;
  web_access?: boolean;
  mobile_access?: boolean;
  addon_eligible?: boolean;

  growth_price?: { monthly?: number; yearly?: number };
  extra_branch_price?: { monthly?: number; yearly?: number };
  renewal?: Renewal;

  subscription?: {
    status?: string;
    days_left?: number;
    trial_end_date?: string | null;
    subscription_end_date?: string | null;
    subscription_plan?: string;
    cancellation_pending?: boolean;
    cancellation_requested_at?: string | null;
  };
  scheduled_plan_change?: { tier?: string; effective_at?: string } | null;
};

type HistoryRow = {
  id: string; type?: string; kind?: string; plan?: string;
  amount_inr?: number; created_at?: string; status?: string;
  reference?: string; label?: string;
};

// ------------- Helpers -----------------------------------------------------
const fmtINR = (n?: number | null) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return String(iso).slice(0, 10); }
};

const titlecase = (s?: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

// Loads Razorpay checkout on web. On iOS this function is NEVER called —
// iOS purchases go through RevenueCat/StoreKit (see useRevenueCat).
// On Android we still allow the existing Razorpay hosted-link fallback,
// unchanged per user directive.
async function openRazorpay(order: any, onSuccess: (r: any) => void, onDismiss: () => void) {
  if (Platform.OS === 'ios') {
    // Belt-and-braces guard — should be unreachable because the calling
    // buttons are hidden on iOS. If someone slips through, redirect to the
    // in-app StoreKit path instead of exposing a Razorpay purchase surface.
    Alert.alert('Use in-app purchase', 'Please use the Apple in-app subscription options.');
    onDismiss();
    return;
  }
  if (Platform.OS === 'web') {
    const w: any = typeof window !== 'undefined' ? window : null;
    if (!w) return onDismiss();
    if (!w.Razorpay) {
      await new Promise<void>((res) => {
        const s = w.document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = () => res();
        w.document.body.appendChild(s);
      });
    }
    const rzp = new w.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency || 'INR',
      order_id: order.order_id,
      name: order.name || 'ParlourPilot',
      description: order.description || 'Subscription payment',
      handler: onSuccess,
      modal: { ondismiss: onDismiss },
      theme: { color: colors.brandPrimary },
    });
    rzp.open();
    return;
  }
  // Native fallback: open a hosted checkout URL if backend provides one, else email support.
  if (order.hosted_url) {
    Linking.openURL(order.hosted_url).catch(() => onDismiss());
    return;
  }
  Alert.alert(
    'Payment in mobile',
    'Complete payment on our secure web page. Open now?',
    [
      { text: 'Cancel', style: 'cancel', onPress: onDismiss },
      { text: 'Open', onPress: () => Linking.openURL('https://parlourpilot.com/app/subscription').catch(() => onDismiss()) },
    ]
  );
}

// ------------- iOS IAP subsection ------------------------------------------
/**
 * Renders the ParlourPilot In-App Purchase surface on iOS.
 * - Non-subscribed owners see 4 tier buttons (Starter M/Y, Growth M/Y).
 * - Subscribed owners see the plan, "Manage Apple Subscription" (opens
 *   StoreKit sheet), and "Restore Purchases" for safety.
 * - After every purchase / restore, we POST to /api/billing/revenuecat/sync
 *   so the backend re-verifies with RevenueCat REST and updates the
 *   tenant.subscription_provider = "apple" state (see routes/revenuecat.py).
 */
function IosSubscriptionActions() {
  const rc = useRevenueCat();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const onPurchase = useCallback(async (key: keyof typeof rc.packages) => {
    const pkg = rc.packages[key];
    if (!pkg) { setMsg('This plan is not available yet. Please try again in a minute.'); return; }
    setBusy(key); setMsg(null);
    try {
      await rc.purchase(pkg);
      // Ping our backend so tenant.subscription_provider flips to 'apple'
      // and plan/branch/staff enforcement immediately reflects the purchase.
      try { await api('/billing/revenuecat/sync', { method: 'POST', body: { trigger: 'purchase' } }); } catch {}
      setMsg('Subscription active. Thanks!');
    } catch (e: any) {
      if (e?.userCancelled) return;
      setMsg(e?.message || 'Purchase failed');
    } finally { setBusy(null); }
  }, [rc]);

  const onRestore = useCallback(async () => {
    setBusy('restore'); setMsg(null);
    try {
      await rc.restore();
      try { await api('/billing/revenuecat/sync', { method: 'POST', body: { trigger: 'restore' } }); } catch {}
      setMsg('Restore complete');
    } catch (e: any) {
      setMsg(e?.message === 'identity_not_ready' ? 'Please wait, still preparing…' : (e?.message || 'Restore failed'));
    } finally { setBusy(null); }
  }, [rc]);

  const onManage = useCallback(async () => {
    try { await rc.showManageSubscriptions(); } catch (e: any) { setMsg(e?.message || 'Could not open Apple subscription management'); }
  }, [rc]);

  const label = (k: keyof typeof rc.packages, fallback: string) => {
    const p = rc.packages[k];
    return p ? `${fallback} — ${p.product.priceString}` : fallback;
  };

  return (
    <View style={{ marginTop: 12, gap: 8 }} testID="ios-iap-card">
      {rc.identityError && (
        <Text style={{ color: '#F5B5B5', fontSize: 12 }}>Purchase temporarily unavailable: {rc.identityError}</Text>
      )}
      {!rc.isSubscribed ? (
        <>
          <Text style={{ color: '#F5D5A0', fontSize: 12, marginBottom: 4 }}>
            Choose your plan (billed by Apple)
          </Text>
          {!rc.identityReady && (
            <Text style={{ color: '#F5D5A0', fontSize: 12, marginBottom: 4 }}>
              Preparing subscription — please wait…
            </Text>
          )}
          <TouchableOpacity testID="iap-starter-monthly" disabled={busy !== null || !rc.identityReady} onPress={() => onPurchase('starter_monthly')} style={[styles.planActionBtn, styles.planActionPrimary, !rc.identityReady && { opacity: 0.5 }]}>
            {busy === 'starter_monthly' ? <ActivityIndicator size="small" color="#3D2100" /> : <Text style={styles.planActionPrimaryText}>{label('starter_monthly', 'Starter — Monthly')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity testID="iap-starter-yearly" disabled={busy !== null || !rc.identityReady} onPress={() => onPurchase('starter_yearly')} style={[styles.planActionBtn, styles.planActionGhost, !rc.identityReady && { opacity: 0.5 }]}>
            <Text style={styles.planActionGhostText}>{label('starter_yearly', 'Starter — Yearly')}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="iap-growth-monthly" disabled={busy !== null || !rc.identityReady} onPress={() => onPurchase('growth_monthly')} style={[styles.planActionBtn, styles.planActionAmber, !rc.identityReady && { opacity: 0.5 }]}>
            {busy === 'growth_monthly' ? <ActivityIndicator size="small" color="#3D2100" /> : <Text style={styles.planActionAmberText}>{label('growth_monthly', 'Growth — Monthly')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity testID="iap-growth-yearly" disabled={busy !== null || !rc.identityReady} onPress={() => onPurchase('growth_yearly')} style={[styles.planActionBtn, styles.planActionGhost, !rc.identityReady && { opacity: 0.5 }]}>
            <Text style={styles.planActionGhostText}>{label('growth_yearly', 'Growth — Yearly')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TouchableOpacity testID="iap-manage-btn" onPress={onManage} style={[styles.planActionBtn, styles.planActionPrimary]}>
            <Ionicons name="settings-outline" size={14} color="#3D2100" />
            <Text style={styles.planActionPrimaryText}>Manage Apple Subscription</Text>
          </TouchableOpacity>
        </>
      )}
      <TouchableOpacity testID="iap-restore-btn" disabled={busy !== null || !rc.identityReady} onPress={onRestore} style={[styles.planActionBtn, styles.planActionGhost]}>
        {busy === 'restore' ? <ActivityIndicator size="small" color="#F5D5A0" /> : <Text style={styles.planActionGhostText}>Restore Purchases</Text>}
      </TouchableOpacity>
      {msg && <Text style={{ color: '#F5D5A0', fontSize: 12 }}>{msg}</Text>}
    </View>
  );
}

// ------------- Component ---------------------------------------------------
export default function SubscriptionScreen() {
  const router = useRouter();
  const { user, refreshTenant } = useAuth();
  const isOwner = !!(user?.is_owner || user?.role === 'owner');

  const [ent, setEnt] = useState<Ent | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [businessName, setBusinessName] = useState('ParlourPilot');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [e, h] = await Promise.all([
        billingApi.entitlements().catch(() => null),
        billingApi.history().catch(() => ({ items: [] })),
      ]);
      setEnt(e as any);
      setHistory(Array.isArray((h as any)?.items) ? (h as any).items : []);
      setBusinessName((h as any)?.business_name || 'ParlourPilot');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ============ ACTIONS ============
  const doRenew = useCallback(async () => {
    if (!isOwner) return;
    setBusy('renew');
    try {
      const cfg: any = await paymentsApi.config().catch(() => null);
      if (!cfg?.enabled) throw new Error('Payments not configured. Contact support.');
      const interval = (ent?.subscription?.subscription_plan === 'yearly') ? 'yearly' : 'monthly';
      const order: any = await tenantApi.createOrder({ plan: interval as any });
      await openRazorpay(order,
        async (r: any) => {
          try {
            await tenantApi.verifyPayment({
              razorpay_payment_id: r.razorpay_payment_id,
              razorpay_order_id: r.razorpay_order_id,
              razorpay_signature: r.razorpay_signature,
            });
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            await refreshTenant();
            await load(true);
            Alert.alert('Success', 'Subscription renewed.');
          } catch (e: any) { Alert.alert('Verification failed', e.message || String(e)); }
        },
        () => {}
      );
    } catch (e: any) { Alert.alert('Renew failed', e.message || String(e)); }
    finally { setBusy(null); }
  }, [isOwner, ent, refreshTenant, load]);

  const doUpgrade = useCallback(async () => {
    if (!isOwner) return;
    setBusy('upgrade');
    try {
      const cfg: any = await paymentsApi.config().catch(() => null);
      if (!cfg?.enabled) throw new Error('Payments not configured. Contact support.');
      const interval = (ent?.subscription?.subscription_plan === 'yearly') ? 'yearly' : 'monthly';
      const order: any = await billingApi.createOrder({ kind: 'growth', plan: interval as any });
      await openRazorpay(order,
        async (r: any) => {
          try {
            await billingApi.verifyPayment({
              razorpay_payment_id: r.razorpay_payment_id,
              razorpay_order_id: r.razorpay_order_id,
              razorpay_signature: r.razorpay_signature,
            });
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            await refreshTenant();
            await load(true);
            Alert.alert('Upgraded', 'You are now on Growth. Enjoy the extra capacity!');
          } catch (e: any) { Alert.alert('Verification failed', e.message || String(e)); }
        },
        () => {}
      );
    } catch (e: any) { Alert.alert('Upgrade failed', e.message || String(e)); }
    finally { setBusy(null); }
  }, [isOwner, ent, refreshTenant, load]);

  const doAddBranch = useCallback(async () => {
    if (!isOwner) return;
    if (!ent?.addon_eligible) {
      Alert.alert('Not available yet', 'Additional Branch add-ons become available once you have an active paid subscription.');
      return;
    }
    setBusy('branch');
    try {
      const cfg: any = await paymentsApi.config().catch(() => null);
      if (!cfg?.enabled) throw new Error('Payments not configured. Contact support.');
      const interval = (ent?.subscription?.subscription_plan === 'yearly') ? 'yearly' : 'monthly';
      const order: any = await billingApi.createOrder({ kind: 'extra_branch', plan: interval as any });
      await openRazorpay(order,
        async (r: any) => {
          try {
            await billingApi.verifyPayment({
              razorpay_payment_id: r.razorpay_payment_id,
              razorpay_order_id: r.razorpay_order_id,
              razorpay_signature: r.razorpay_signature,
            });
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            await refreshTenant();
            await load(true);
            Alert.alert('Branch added', 'You can now create an additional branch.');
          } catch (e: any) { Alert.alert('Verification failed', e.message || String(e)); }
        },
        () => {}
      );
    } catch (e: any) { Alert.alert('Add-on failed', e.message || String(e)); }
    finally { setBusy(null); }
  }, [isOwner, ent, refreshTenant, load]);

  const doDowngrade = useCallback(() => {
    if (!isOwner) return;
    Alert.alert(
      'Downgrade to Starter?',
      'Your plan will change to Starter at the next renewal. You keep Growth benefits until then. Extra branches/users beyond Starter limits will need to be removed before the change takes effect.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Schedule Downgrade', style: 'destructive', onPress: async () => {
          setBusy('downgrade');
          try { await tenantApi.downgrade(); await load(true); Alert.alert('Scheduled', 'Downgrade to Starter is scheduled for the next renewal.'); }
          catch (e: any) { Alert.alert('Failed', e.message); }
          finally { setBusy(null); }
        }},
      ]
    );
  }, [isOwner, load]);

  const doCancelDowngrade = useCallback(async () => {
    setBusy('cancel-downgrade');
    try { await tenantApi.cancelDowngrade(); await load(true); Alert.alert('Cancelled', 'Downgrade cancelled.'); }
    catch (e: any) { Alert.alert('Failed', e.message); }
    finally { setBusy(null); }
  }, [load]);

  const doCancel = useCallback(() => {
    if (!isOwner) return;
    Alert.alert(
      'Cancel subscription?',
      'You will keep access until the end of the current billing period. You can resume anytime before then.',
      [
        { text: 'Keep subscription', style: 'cancel' },
        { text: 'Cancel subscription', style: 'destructive', onPress: async () => {
          setBusy('cancel');
          try { await tenantApi.cancelSubscription(); await refreshTenant(); await load(true); }
          catch (e: any) { Alert.alert('Failed', e.message); }
          finally { setBusy(null); }
        }},
      ]
    );
  }, [isOwner, refreshTenant, load]);

  const doResume = useCallback(async () => {
    setBusy('resume');
    try { await tenantApi.resumeSubscription(); await refreshTenant(); await load(true); }
    catch (e: any) { Alert.alert('Failed', e.message); }
    finally { setBusy(null); }
  }, [refreshTenant, load]);

  // ============ RENDER ============
  if (loading) {
    return (
      <View style={styles.root}>
        <Header router={router} />
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      </View>
    );
  }

  if (!ent) {
    return (
      <View style={styles.root}>
        <Header router={router} />
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>Couldn{"'"}t load subscription</Text>
          <TouchableOpacity onPress={() => load(true)} style={[styles.primaryBtn, { marginTop: spacing.md, paddingHorizontal: 24 }]}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const planName = titlecase(ent.plan || ent.plan_tier || 'Starter');
  const interval = ent.billing_interval === 'yearly' ? 'Yearly' : 'Monthly';
  const daysLeft = ent.subscription?.days_left ?? 0;
  const subPlan = (ent.subscription?.subscription_plan || '').toLowerCase();
  const isTrial = subPlan === 'trial';
  // Normalise every possible status the backend may return into a single canonical value.
  const rawStatus = String(ent.subscription?.status || ent.status || 'active').toLowerCase();
  const canonicalStatus: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'inactive' =
    isTrial ? 'trial'
    : rawStatus.startsWith('past') ? 'past_due'
    : rawStatus === 'cancelled' || rawStatus === 'canceled' ? 'cancelled'
    : rawStatus === 'expired' ? 'expired'
    : rawStatus === 'suspended' ? 'suspended'
    : rawStatus === 'active' ? 'active'
    : 'inactive';
  const statusPillMeta: Record<typeof canonicalStatus, { bg: string; fg: string; label: string }> = {
    trial:     { bg: '#B7E4C7', fg: '#166534', label: 'Trial' },
    active:    { bg: '#B7E4C7', fg: '#166534', label: 'Active' },
    past_due:  { bg: '#FDE7C1', fg: '#8A5300', label: 'Past due' },
    cancelled: { bg: '#F5D0D0', fg: '#8A1A1A', label: 'Cancelled' },
    expired:   { bg: '#F5D0D0', fg: '#8A1A1A', label: 'Expired' },
    suspended: { bg: '#F5D0D0', fg: '#8A1A1A', label: 'Suspended' },
    inactive:  { bg: '#F5D0D0', fg: '#8A1A1A', label: 'Inactive' },
  };
  const statusMeta = statusPillMeta[canonicalStatus];
  const cancellationPending = !!ent.subscription?.cancellation_pending;
  const scheduledDowngrade = ent.scheduled_plan_change?.tier === 'starter';

  const staffUsed = ent.staff_used ?? 0;
  const staffLimit = ent.effective_user_limit ?? ent.base_user_limit ?? 0;
  const branchUsed = ent.branch_count ?? 0;
  const branchLimit = ent.effective_branch_limit ?? ent.base_branch_limit ?? 0;
  // Note: percentage capped at 100 for the bar, but "Limit reached" pill fires
  // as soon as usage >= limit — so a grandfathered 4/3 correctly renders as
  // "Branch limit reached" without hiding the 4th branch anywhere in the app.
  const staffPct = staffLimit > 0 ? Math.min(100, (staffUsed / staffLimit) * 100) : 0;
  const branchPct = branchLimit > 0 ? Math.min(100, (branchUsed / branchLimit) * 100) : 0;
  const staffOverLimit = staffLimit > 0 && staffUsed >= staffLimit;
  const branchOverLimit = branchLimit > 0 && branchUsed >= branchLimit;
  const staffLeft = Math.max(0, staffLimit - staffUsed);
  const branchLeft = Math.max(0, branchLimit - branchUsed);

  const canUpgrade = (ent.plan_tier || ent.plan) === 'starter';
  const canDowngrade = (ent.plan_tier || ent.plan) === 'growth' && !scheduledDowngrade;
  const showAddon = isOwner && ent.addon_eligible === true;
  const needsPayment = canonicalStatus === 'past_due' || canonicalStatus === 'expired' || canonicalStatus === 'suspended';

  const addonMonthlyInr = Math.round(((ent.extra_branch_price?.monthly ?? 88800) / 100));
  const addonYearlyInr = Math.round(((ent.extra_branch_price?.yearly ?? 888800) / 100));

  return (
    <View style={styles.root}>
      <Header router={router} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.brandRow}>
          <Image source={require('../assets/images/parlourpilot-logo.png')} style={{ width: 44, height: 44 }} contentFit="contain" />
          <Text style={styles.brandName}>{businessName}</Text>
        </View>

        {/* ===== Dark plan card ===== */}
        <View style={styles.planCard} testID="plan-card">
          <View style={styles.planHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planLabel}>Current Plan</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Text style={styles.planName}>{planName}</Text>
                <View style={[styles.statusPill, { backgroundColor: statusMeta.bg }]}>
                  <Text style={[styles.statusPillText, { color: statusMeta.fg }]}>{statusMeta.label}</Text>
                </View>
              </View>
              <Text style={styles.planSubline}>{interval} billing · {staffLimit} user accounts · {branchLimit} branch{branchLimit === 1 ? '' : 'es'}</Text>
            </View>
          </View>

          {/* Actions
              NOTE (iOS): the buttons below all trigger the Razorpay hosted
              checkout flow, which Apple prohibits for digital subscriptions
              (App Store guideline 3.1.1). On iOS we hide them and render a
              separate In-App-Purchase card below. Android + Web behaviour is
              UNCHANGED per user directive. */}
          {Platform.OS !== 'ios' && (
          <View style={styles.planActions}>
            {isOwner && (
              <TouchableOpacity
                onPress={doRenew}
                disabled={!!busy}
                style={[styles.planActionBtn, styles.planActionPrimary]}
                testID="renew-btn"
              >
                {busy === 'renew'
                  ? <ActivityIndicator size="small" color="#3D2100" />
                  : <>
                      <Ionicons name="card-outline" size={14} color="#3D2100" />
                      <Text style={styles.planActionPrimaryText}>
                        {needsPayment ? `Renew now — ${fmtINR(ent.renewal?.total_inr)}` : `Pay ${fmtINR(ent.renewal?.total_inr)} with Razorpay`}
                      </Text>
                    </>}
              </TouchableOpacity>
            )}
            {isOwner && canUpgrade && (
              <TouchableOpacity onPress={doUpgrade} disabled={!!busy} style={[styles.planActionBtn, styles.planActionAmber]} testID="upgrade-btn">
                {busy === 'upgrade' ? <ActivityIndicator size="small" color="#3D2100" /> : <>
                  <Ionicons name="rocket-outline" size={14} color="#3D2100" />
                  <Text style={styles.planActionAmberText}>Upgrade to Growth</Text>
                </>}
              </TouchableOpacity>
            )}
            {isOwner && !cancellationPending && (
              <TouchableOpacity onPress={doCancel} disabled={!!busy} style={[styles.planActionBtn, styles.planActionGhost]} testID="cancel-btn">
                <Ionicons name="close-circle-outline" size={14} color="#F5D5A0" />
                <Text style={styles.planActionGhostText}>Cancel subscription</Text>
              </TouchableOpacity>
            )}
            {isOwner && cancellationPending && (
              <TouchableOpacity onPress={doResume} disabled={!!busy} style={[styles.planActionBtn, styles.planActionAmber]}>
                <Ionicons name="refresh-outline" size={14} color="#3D2100" />
                <Text style={styles.planActionAmberText}>Resume subscription</Text>
              </TouchableOpacity>
            )}
          </View>
          )}
          {Platform.OS === 'ios' && isOwner && <IosSubscriptionActions />}

          {/* KPIs */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCell}><Text style={styles.kpiLabel}>PLAN</Text><Text style={styles.kpiValue}>{planName}</Text></View>
            <View style={styles.kpiCell}><Text style={styles.kpiLabel}>BILLING CYCLE</Text><Text style={styles.kpiValue}>{interval}</Text></View>
          </View>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCell}><Text style={styles.kpiLabel}>RENEWS ON</Text><Text style={styles.kpiValue}>{fmtDate(ent.subscription?.subscription_end_date)}</Text></View>
            <View style={styles.kpiCell}><Text style={styles.kpiLabel}>DAYS REMAINING</Text><Text style={styles.kpiValue}>{daysLeft} days</Text></View>
          </View>

          {/* Renewal breakdown */}
          {ent.renewal && (
            <View style={styles.renewalBox}>
              <Text style={styles.renewalLabel}>NEXT PAYMENT</Text>
              <View style={styles.renewalRow}>
                <Text style={styles.renewalItem}>{planName} plan ({interval})</Text>
                <Text style={styles.renewalAmt}>{fmtINR(ent.renewal.base_inr)}</Text>
              </View>
              {(ent.renewal.addon_qty ?? 0) > 0 && (
                <View style={styles.renewalRow}>
                  <Text style={styles.renewalItem}>Additional Branch × {ent.renewal.addon_qty}</Text>
                  <Text style={styles.renewalAmt}>{fmtINR(ent.renewal.addon_total_inr)}</Text>
                </View>
              )}
              <View style={[styles.renewalRow, styles.renewalTotalRow]}>
                <Text style={styles.renewalTotalLabel}>Total /{interval === 'Yearly' ? 'yr' : 'mo'}</Text>
                <Text style={styles.renewalTotalAmt}>{fmtINR(ent.renewal.total_inr)}</Text>
              </View>
            </View>
          )}

          <View style={styles.disclaimer}>
            <Ionicons name="information-circle-outline" size={14} color="#F5D5A0" />
            <Text style={styles.disclaimerText}>
              All subscription prices are charged in INR. International card issuers or banks may apply currency conversion rates and applicable fees.
            </Text>
          </View>
        </View>

        {needsPayment && (
          <View style={[styles.warnBanner, { marginTop: spacing.md, backgroundColor: '#FDE7C1', borderColor: '#F0C060' }]}>
            <Ionicons name="warning-outline" size={16} color="#8A5300" />
            <Text style={[styles.warnText, { color: '#8A5300' }]}>
              {canonicalStatus === 'past_due'
                ? 'Payment past due. Renew now to keep full access.'
                : canonicalStatus === 'expired'
                  ? 'Subscription expired. Renew to restore full access.'
                  : 'Subscription suspended. Contact support or renew.'}
            </Text>
          </View>
        )}
        {cancellationPending && (
          <View style={[styles.warnBanner, { marginTop: spacing.md }]}>
            <Ionicons name="alert-circle-outline" size={16} color="#8A1A1A" />
            <Text style={styles.warnText}>Cancellation scheduled — active until {fmtDate(ent.subscription?.subscription_end_date)}.</Text>
          </View>
        )}
        {scheduledDowngrade && (
          <View style={[styles.warnBanner, { marginTop: spacing.md }]}>
            <Ionicons name="arrow-down-circle-outline" size={16} color="#8A1A1A" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnText}>Scheduled downgrade to Starter on renewal.</Text>
              <TouchableOpacity onPress={doCancelDowngrade}><Text style={{ color: colors.brandPrimary, fontWeight: '700', marginTop: 4 }}>Cancel downgrade</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {/* ===== Included with your plan ===== */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Included with your {planName} plan</Text>
          <View style={styles.featureGrid}>
            {ent.all_features && <FeatureRow icon="checkmark-circle" label="All features included" />}
            {ent.web_access && <FeatureRow icon="checkmark-circle" label="Web access" />}
            {ent.mobile_access && <FeatureRow icon="checkmark-circle" label="Mobile access" />}
            <FeatureRow icon="checkmark-circle" label={`${staffLimit} user account${staffLimit === 1 ? '' : 's'} (owner included)`} />
            <FeatureRow icon="checkmark-circle" label={`${branchLimit} branch${branchLimit === 1 ? '' : 'es'}`} />
          </View>
        </View>

        {/* ===== Usage ===== */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.cardTitle}>Your plan usage</Text>
            <View style={styles.planTag}><Text style={styles.planTagText}>{planName}</Text></View>
          </View>
          <Text style={styles.cardSubtitle}>Track your user accounts and branch capacity at a glance.</Text>

          <View style={styles.usageBlock}>
            <View style={styles.usageHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="people-outline" size={14} color={colors.onSurfaceSecondary} />
                <Text style={styles.usageTitle}>User accounts (owner included)</Text>
              </View>
              <Text style={styles.usageCount}>{staffUsed}<Text style={styles.usageMax}> / {staffLimit}</Text></Text>
            </View>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${staffPct}%`, backgroundColor: staffOverLimit ? colors.error : colors.brandPrimary }]} /></View>
            {staffOverLimit && <View style={styles.limitPill}><Text style={styles.limitPillText}>User limit reached</Text></View>}
            {!staffOverLimit && staffLeft <= 1 && staffLimit > 0 && <Text style={styles.usageHint}>{staffLeft} seat{staffLeft === 1 ? '' : 's'} left</Text>}
          </View>

          <View style={styles.usageBlock}>
            <View style={styles.usageHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="business-outline" size={14} color={colors.onSurfaceSecondary} />
                <Text style={styles.usageTitle}>Branches</Text>
              </View>
              <Text style={styles.usageCount}>{branchUsed}<Text style={styles.usageMax}> / {branchLimit}</Text></Text>
            </View>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${branchPct}%`, backgroundColor: branchOverLimit ? colors.error : colors.brandPrimary }]} /></View>
            {branchOverLimit && <View style={styles.limitPill}><Text style={styles.limitPillText}>Branch limit reached</Text></View>}
            {!branchOverLimit && branchLeft <= 1 && branchLimit > 0 && <Text style={styles.usageHint}>{branchLeft} branch{branchLeft === 1 ? '' : 'es'} left</Text>}
          </View>

          {(staffOverLimit || branchOverLimit) && canUpgrade && (
            <View style={styles.growthNudge}>
              <Ionicons name="trending-up-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.growthNudgeText}>
                Growing fast? <Text style={{ fontWeight: '800' }}>Growth</Text> unlocks 30 user accounts and 3 branches — and yearly billing saves you roughly two months every year.
              </Text>
            </View>
          )}
        </View>

        {/* ===== Additional Branch add-on (only when addon_eligible === true)
             NOTE: hidden on iOS — the Additional Branch add-on is currently a
             Razorpay-only purchase; iOS users manage add-ons on parlourpilot.com
             via existing web billing. IAP for extra branches will come later. */}
        {showAddon && Platform.OS !== 'ios' && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={styles.addonIconBox}><Ionicons name="add-circle-outline" size={22} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Additional Branch</Text>
                <Text style={styles.cardSubtitle}>Each add-on increases your capacity by <Text style={{ fontWeight: '800' }}>+1 branch</Text> and <Text style={{ fontWeight: '800' }}>+10 users</Text>.</Text>
                <Text style={styles.addonPrice}>{fmtINR(addonMonthlyInr)}/month · {fmtINR(addonYearlyInr)}/year</Text>
              </View>
              <TouchableOpacity onPress={doAddBranch} disabled={!!busy} style={styles.addonBtn} testID="add-branch-btn">
                {busy === 'branch' ? <ActivityIndicator size="small" color="#3D2100" /> : <Text style={styles.addonBtnText}>Add Branch</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ===== Downgrade action (Growth-only) — Razorpay flow, hidden on iOS ===== */}
        {isOwner && canDowngrade && Platform.OS !== 'ios' && (
          <TouchableOpacity onPress={doDowngrade} disabled={!!busy} style={styles.textLinkBtn} testID="downgrade-btn">
            <Ionicons name="arrow-down-outline" size={14} color={colors.onSurfaceTertiary} />
            <Text style={styles.textLinkBtnText}>Downgrade to Starter at next renewal</Text>
          </TouchableOpacity>
        )}

        {/* ===== Billing history ===== */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="receipt-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>Billing history</Text>
          </View>
          <Text style={styles.cardSubtitle}>Your recent plan payments — proof of every upgrade.</Text>
          {history.length === 0 ? (
            <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
              <Ionicons name="document-outline" size={32} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyHint}>No payments yet.</Text>
            </View>
          ) : history.map(row => (
            <View key={row.id} style={styles.historyRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.historyTitle}>{row.label || row.type || 'Payment'}</Text>
                  {row.plan && <View style={styles.tinyTag}><Text style={styles.tinyTagText}>{row.plan}</Text></View>}
                </View>
                <Text style={styles.historyMeta}>Payment confirmed · {fmtDate(row.created_at)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.historyAmt}>{fmtINR(row.amount_inr)}</Text>
                <Text style={styles.historyINR}>Charged in INR</Text>
                <TouchableOpacity onPress={() => shareReceipt(businessName, row)} style={styles.receiptBtn}>
                  <Ionicons name="download-outline" size={12} color={colors.brandPrimary} />
                  <Text style={styles.receiptBtnText}>Receipt</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Contact support */}
        <TouchableOpacity onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} style={styles.supportBtn}>
          <Ionicons name="mail-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.supportBtnText}>Contact support</Text>
        </TouchableOpacity>
        <Text style={styles.supportEmailText}>{SUPPORT_EMAIL}</Text>
      </ScrollView>
    </View>
  );
}

// ------------- Sub components ---------------------------------------------
function Header({ router }: { router: any }) {
  return (
    <SafeAreaView edges={['top']} style={styles.headerBar}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Subscription & Billing</Text>
      <View style={{ width: 32 }} />
    </SafeAreaView>
  );
}

function FeatureRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.featureRow}>
      <Ionicons name={icon} size={16} color={colors.success} />
      <Text style={styles.featureLabel}>{label}</Text>
    </View>
  );
}

// Simple text-based receipt share (server-generated PDFs come later).
async function shareReceipt(businessName: string, row: HistoryRow) {
  const body = [
    `${businessName} — Payment Receipt`,
    '',
    `Date: ${new Date(row.created_at || '').toLocaleString('en-IN')}`,
    `Type: ${row.label || row.type || 'Payment'}`,
    row.plan ? `Plan: ${row.plan}` : '',
    row.reference ? `Reference: ${row.reference}` : '',
    `Amount: ₹${Number(row.amount_inr ?? 0).toLocaleString('en-IN')} (charged in INR)`,
    `Status: ${row.status || 'success'}`,
    '',
    'This is a payment receipt (not a GST invoice).',
  ].filter(Boolean).join('\n');
  try {
    if (Platform.OS === 'web') {
      Alert.alert('Receipt', body);
    } else {
      await Share.share({ message: body, title: 'ParlourPilot receipt' });
    }
  } catch {}
}

// ------------- Styles ------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },

  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md },
  brandName: { fontSize: 18, fontWeight: '800', color: colors.onSurface },

  // Dark plan card
  planCard: {
    backgroundColor: '#161616', borderRadius: 18, padding: spacing.lg, ...shadows.card,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  planHead: { marginBottom: spacing.md },
  planLabel: { fontSize: 10, fontWeight: '800', color: '#8A8478', letterSpacing: 1 },
  planName: { fontSize: 28, fontWeight: '900', color: '#F5D5A0' },
  planSubline: { color: '#B8B0A0', fontSize: 12, marginTop: 4 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  statusPillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },

  planActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  planActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  planActionPrimary: { backgroundColor: '#F5D5A0', flex: 1, minWidth: '48%' },
  planActionPrimaryText: { color: '#3D2100', fontWeight: '800', fontSize: 12 },
  planActionAmber: { backgroundColor: '#F5D5A0' },
  planActionAmberText: { color: '#3D2100', fontWeight: '800', fontSize: 12 },
  planActionGhost: { borderWidth: 1, borderColor: '#3A3020', backgroundColor: 'transparent' },
  planActionGhostText: { color: '#F5D5A0', fontWeight: '700', fontSize: 12 },

  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  kpiCell: { flex: 1, backgroundColor: '#212121', padding: spacing.sm, borderRadius: 10 },
  kpiLabel: { fontSize: 9, color: '#8A8478', fontWeight: '800', letterSpacing: 1 },
  kpiValue: { fontSize: 14, color: '#F5F3EF', fontWeight: '800', marginTop: 2 },

  renewalBox: { backgroundColor: '#212121', borderRadius: 10, padding: spacing.md, marginTop: 8 },
  renewalLabel: { fontSize: 9, color: '#8A8478', fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  renewalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  renewalItem: { color: '#B8B0A0', fontSize: 12 },
  renewalAmt: { color: '#F5F3EF', fontSize: 12, fontWeight: '700' },
  renewalTotalRow: { borderTopWidth: 1, borderTopColor: '#333', paddingTop: 6, marginTop: 4 },
  renewalTotalLabel: { color: '#F5D5A0', fontSize: 13, fontWeight: '800' },
  renewalTotalAmt: { color: '#F5D5A0', fontSize: 15, fontWeight: '900' },

  disclaimer: { flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'flex-start', backgroundColor: '#212121', padding: 10, borderRadius: 8 },
  disclaimerText: { flex: 1, color: '#F5D5A0', fontSize: 10, lineHeight: 14 },

  warnBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FDECEC', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: '#F5B6B6' },
  warnText: { color: '#8A1A1A', fontSize: 12, fontWeight: '600', flex: 1 },

  card: { backgroundColor: '#fff', borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  cardSubtitle: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 4 },

  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '48%' },
  featureLabel: { fontSize: 12, color: colors.onSurface, flex: 1 },

  planTag: { backgroundColor: '#FDECC1', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  planTagText: { fontSize: 10, fontWeight: '800', color: '#7A5300' },

  usageBlock: { marginTop: spacing.md },
  usageHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  usageTitle: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '600' },
  usageCount: { fontSize: 13, fontWeight: '800', color: colors.onSurface },
  usageMax: { fontWeight: '600', color: colors.onSurfaceTertiary },
  usageHint: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4 },
  bar: { height: 6, backgroundColor: '#EFE8DA', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  limitPill: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: '#FDECEC', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  limitPillText: { fontSize: 10, color: '#8A1A1A', fontWeight: '800' },

  growthNudge: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: spacing.md, padding: spacing.md, backgroundColor: '#F7F5EE', borderRadius: radius.md },
  growthNudgeText: { flex: 1, fontSize: 12, color: colors.onSurface, lineHeight: 18 },

  addonIconBox: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary + '15' },
  addonPrice: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4 },
  addonLocked: { fontSize: 11, color: colors.error, marginTop: 4, fontStyle: 'italic' },
  addonBtn: { backgroundColor: '#F5D5A0', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  addonBtnText: { color: '#3D2100', fontWeight: '800', fontSize: 12 },

  textLinkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, marginTop: spacing.md },
  textLinkBtnText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },

  historyRow: { flexDirection: 'row', paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.divider, gap: 8 },
  historyTitle: { fontSize: 13, fontWeight: '800', color: colors.onSurface },
  historyMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  historyAmt: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  historyINR: { fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 1 },
  tinyTag: { backgroundColor: '#F7F5EE', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 },
  tinyTagText: { fontSize: 10, color: colors.onSurfaceSecondary, fontWeight: '700' },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, borderWidth: 1, borderColor: colors.border, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: '#fff' },
  receiptBtnText: { color: colors.brandPrimary, fontSize: 11, fontWeight: '700' },

  supportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.brandPrimary, padding: 14, borderRadius: radius.md, marginTop: spacing.md, backgroundColor: '#fff' },
  supportBtnText: { color: colors.brandPrimary, fontWeight: '800' },
  supportEmailText: { textAlign: 'center', color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 6 },

  primaryBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '800' },

  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.onSurface, marginTop: 10 },
  emptyHint: { color: colors.onSurfaceTertiary, marginTop: 6, fontSize: 12 },
});
