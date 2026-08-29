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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Platform, Linking, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';

import { billingApi, tenantApi, paymentsApi } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

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

// Loads Razorpay checkout on web. On native, we fall back to a hosted link.
async function openRazorpay(order: any, onSuccess: (r: any) => void, onDismiss: () => void) {
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
  const isTrial = (ent.subscription?.subscription_plan || '').toLowerCase() === 'trial';
  const cancellationPending = !!ent.subscription?.cancellation_pending;
  const scheduledDowngrade = ent.scheduled_plan_change?.tier === 'starter';

  const staffUsed = ent.staff_used ?? 0;
  const staffLimit = ent.effective_user_limit ?? ent.base_user_limit ?? 0;
  const branchUsed = ent.branch_count ?? 0;
  const branchLimit = ent.effective_branch_limit ?? ent.base_branch_limit ?? 0;
  const staffPct = staffLimit > 0 ? Math.min(100, (staffUsed / staffLimit) * 100) : 0;
  const branchPct = branchLimit > 0 ? Math.min(100, (branchUsed / branchLimit) * 100) : 0;
  const staffLeft = Math.max(0, staffLimit - staffUsed);
  const branchLeft = Math.max(0, branchLimit - branchUsed);

  const canUpgrade = (ent.plan_tier || ent.plan) === 'starter';
  const canDowngrade = (ent.plan_tier || ent.plan) === 'growth' && !scheduledDowngrade;

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
                <View style={[styles.statusPill, { backgroundColor: (ent.status === 'active' || isTrial) ? '#B7E4C7' : '#F5D0D0' }]}>
                  <Text style={[styles.statusPillText, { color: (ent.status === 'active' || isTrial) ? '#166534' : '#8A1A1A' }]}>
                    {isTrial ? 'Trial' : titlecase(ent.status || 'inactive')}
                  </Text>
                </View>
              </View>
              <Text style={styles.planSubline}>{interval} billing · {staffLimit} user accounts · {branchLimit} branch{branchLimit === 1 ? '' : 'es'}</Text>
            </View>
          </View>

          {/* Actions */}
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
                      <Text style={styles.planActionPrimaryText}>Pay {fmtINR(ent.renewal?.total_inr)} with Razorpay</Text>
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
            <View style={styles.bar}><View style={[styles.barFill, { width: `${staffPct}%`, backgroundColor: staffPct >= 100 ? colors.error : colors.brandPrimary }]} /></View>
            {staffPct >= 100 && <View style={styles.limitPill}><Text style={styles.limitPillText}>User limit reached</Text></View>}
            {staffPct < 100 && staffLeft <= 1 && <Text style={styles.usageHint}>{staffLeft} seat{staffLeft === 1 ? '' : 's'} left</Text>}
          </View>

          <View style={styles.usageBlock}>
            <View style={styles.usageHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="business-outline" size={14} color={colors.onSurfaceSecondary} />
                <Text style={styles.usageTitle}>Branches</Text>
              </View>
              <Text style={styles.usageCount}>{branchUsed}<Text style={styles.usageMax}> / {branchLimit}</Text></Text>
            </View>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${branchPct}%`, backgroundColor: branchPct >= 100 ? colors.error : colors.brandPrimary }]} /></View>
            {branchPct >= 100 && <View style={styles.limitPill}><Text style={styles.limitPillText}>Branch limit reached</Text></View>}
            {branchPct < 100 && branchLeft <= 1 && <Text style={styles.usageHint}>{branchLeft} branch{branchLeft === 1 ? '' : 'es'} left</Text>}
          </View>

          {(staffPct >= 100 || branchPct >= 100) && canUpgrade && (
            <View style={styles.growthNudge}>
              <Ionicons name="trending-up-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.growthNudgeText}>
                Growing fast? <Text style={{ fontWeight: '800' }}>Growth</Text> unlocks 30 user accounts and 3 branches — and yearly billing saves you roughly two months every year.
              </Text>
            </View>
          )}
        </View>

        {/* ===== Additional Branch add-on ===== */}
        {isOwner && (
          <View style={[styles.card, !ent.addon_eligible && { opacity: 0.65 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={styles.addonIconBox}><Ionicons name={ent.addon_eligible ? 'add-circle-outline' : 'lock-closed'} size={22} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Additional Branch</Text>
                <Text style={styles.cardSubtitle}>Each add-on increases your capacity by <Text style={{ fontWeight: '800' }}>1 branch</Text> and <Text style={{ fontWeight: '800' }}>10 user accounts</Text>.</Text>
                <Text style={styles.addonPrice}>{fmtINR(addonMonthlyInr)}/mo · {fmtINR(addonYearlyInr)}/yr</Text>
                {!ent.addon_eligible && <Text style={styles.addonLocked}>Available once you have an active paid subscription.</Text>}
              </View>
              {ent.addon_eligible ? (
                <TouchableOpacity onPress={doAddBranch} disabled={!!busy} style={styles.addonBtn} testID="add-branch-btn">
                  {busy === 'branch' ? <ActivityIndicator size="small" color="#3D2100" /> : <Text style={styles.addonBtnText}>Add Branch</Text>}
                </TouchableOpacity>
              ) : (
                <View style={[styles.addonBtn, { opacity: 0.4 }]}><Text style={styles.addonBtnText}>Locked</Text></View>
              )}
            </View>
          </View>
        )}

        {/* ===== Downgrade action (Growth-only) ===== */}
        {isOwner && canDowngrade && (
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
