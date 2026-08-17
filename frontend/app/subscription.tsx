import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Linking,
  Modal, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

const SUPPORT_EMAIL = 'support@parlourpilot.com';

type Entitlements = {
  plan_tier: 'starter' | 'growth' | 'legacy' | string;
  plan_tier_label: string;
  branch_count: number; branches_allowed: number;
  staff_count: number; staff_pool: number;
  can_upgrade: boolean; grandfathered: boolean;
  monthly_price_per_branch: number;
  yearly_price_per_branch: number;
  currency: string;
};

type PaymentsCfg = { enabled: boolean; key_id: string; provider: string; currency: string };

function formatEndDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return String(iso).slice(0, 10); }
}

// Small snackbar-style toast used for payment-config / gateway errors.
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string, ttlMs = 3800) => {
    setMsg(m);
    setTimeout(() => setMsg(null), ttlMs);
  };
  return { msg, show, hide: () => setMsg(null) };
}

export default function SubscriptionScreen() {
  const { subscription, tenant, user, logout, refreshTenant } = useAuth();
  const router = useRouter();
  const isOwner = user?.role === 'admin' || user?.role === 'owner';

  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [paymentsCfg, setPaymentsCfg] = useState<PaymentsCfg | null>(null);
  const toast = useToast();

  const status = subscription?.status || 'expired';
  const cancellationPending: boolean = !!(subscription as any)?.cancellation_pending;
  const endIso = subscription?.subscription_end_date || subscription?.trial_end_date || null;
  const endDateFmt = formatEndDate(endIso);
  const isActiveOrTrial = status === 'active' || status === 'trialing';
  const isExpired = status === 'expired' || status === 'suspended' || status === 'cancelled';

  const uiStatus = cancellationPending ? 'cancelled_pending' : status;

  const load = useCallback(async () => {
    try {
      const [ent, cfg] = await Promise.all([
        api<Entitlements>('/billing/entitlements').catch(() => null),
        api<PaymentsCfg>('/payments/config').catch(() => null),
      ]);
      setEntitlements(ent);
      setPaymentsCfg(cfg);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshTenant(), load()]);
    setRefreshing(false);
  };

  // --- Derived plan-card values ---
  const planTierLabel = entitlements?.plan_tier_label || 'Starter';
  const billingCycleLabel = (() => {
    if (status === 'trialing') return 'Free trial';
    const p = (subscription?.subscription_plan || '').toLowerCase();
    if (p === 'monthly') return 'Monthly';
    if (p === 'yearly') return 'Yearly';
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : '—';
  })();
  const expiryLabel = cancellationPending
    ? 'Access until'
    : (status === 'trialing' ? 'Trial ends' : 'Renews on');
  const daysLeft = subscription?.days_left ?? null;
  const daysColor = daysLeft === null
    ? colors.onSurface
    : daysLeft <= 3 ? colors.error
    : daysLeft <= 7 ? colors.warning
    : colors.onSurface;

  const nextPaymentAmount = (() => {
    if (!entitlements) return null;
    const pricePerBranch = (subscription?.subscription_plan === 'yearly')
      ? entitlements.yearly_price_per_branch
      : entitlements.monthly_price_per_branch;
    const total = pricePerBranch * Math.max(1, entitlements.branch_count || 1);
    return { pricePerBranch, branches: entitlements.branch_count || 1, total };
  })();

  const statusColorFor = (s: string) =>
    s === 'active' ? colors.success :
    s === 'trialing' ? colors.warning :
    s === 'cancelled_pending' ? colors.warning :
    colors.error;
  const uiStatusColor = statusColorFor(uiStatus);
  const uiStatusText = ({
    cancelled_pending: 'CANCEL PENDING',
    trialing: 'TRIALING',
    active: 'ACTIVE',
    expired: 'EXPIRED',
    cancelled: 'CANCELLED',
    suspended: 'SUSPENDED',
  } as Record<string, string>)[uiStatus] || String(uiStatus).toUpperCase();

  // --- Actions ---
  const openRenew = async () => {
    if (!isOwner) {
      Alert.alert('Owner action required', 'Only the salon owner/admin can renew the subscription.');
      return;
    }
    if (paymentsCfg && paymentsCfg.enabled === false) {
      toast.show("Online payments aren't configured yet.");
      return;
    }
    Haptics.selectionAsync();
    router.push('/checkout?type=tenant');
  };

  const openUpgrade = async () => {
    if (!isOwner) return;
    if (paymentsCfg && paymentsCfg.enabled === false) {
      toast.show("Online payments aren't configured yet.");
      return;
    }
    // On this backend the tenant-scoped checkout endpoints handle the upgrade too.
    // If the shared backend later exposes /billing/checkout/order, the checkout
    // screen will simply hit that; here we route to the same checkout page with a hint.
    Haptics.selectionAsync();
    router.push('/checkout?type=tenant&intent=upgrade');
  };

  const openSupport = async () => {
    const subject = encodeURIComponent(`ParlourPilot support — ${tenant?.business_name || 'account'}`);
    const bodyLines = [
      'Hi ParlourPilot Support,',
      '', 'I need help with my account.', '',
      '— Account details —',
      `Business: ${tenant?.business_name || 'N/A'}`,
      `Email: ${user?.email || 'N/A'}`,
      `Subscription: ${status}`,
      `Plan: ${subscription?.subscription_plan || 'N/A'}`,
      tenant?.id ? `Tenant ID: ${tenant.id}` : '',
      '', 'Please describe your issue below:', '',
    ].filter(Boolean).join('\n');
    const body = encodeURIComponent(bodyLines);
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    try {
      if (Platform.OS === 'web') {
        const w: any = typeof window !== 'undefined' ? window : null;
        if (w) { w.location.href = mailto; return; }
      }
      const ok = await Linking.canOpenURL(mailto);
      if (ok) await Linking.openURL(mailto);
      else Alert.alert('Contact Support', `Email us at ${SUPPORT_EMAIL}`);
    } catch { Alert.alert('Contact Support', `Email us at ${SUPPORT_EMAIL}`); }
  };

  const confirmCancel = async () => {
    setBusy(true);
    try {
      await api('/tenants/me/cancel-subscription', { method: 'POST' });
      await refreshTenant();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCancelOpen(false);
    } catch (e: any) {
      toast.show(e?.message || 'Cancellation failed. Please try again.');
    } finally { setBusy(false); }
  };

  const resumeSubscription = async () => {
    if (!isOwner) return;
    setBusy(true);
    try {
      await api('/tenants/me/cancel-subscription', { method: 'DELETE' });
      await refreshTenant();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Renewal restored', 'Your subscription will renew as usual.');
    } catch (e: any) {
      toast.show(e?.message || 'Could not resume. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.headerRow}>
          {isOwner && (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
              <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>Subscription</Text>
          <View style={{ width: 32 }} />
        </View>

        <Image
          source={require('../assets/images/parlourpilot-logo.png')}
          style={styles.logo}
          contentFit="contain"
        />
        {tenant && <Text style={styles.subtitle}>{tenant.business_name}</Text>}

        {/* ==== Redesigned Current Plan panel ==== */}
        <View style={styles.planCard} testID="current-plan-card">
          <View style={styles.planHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planEyebrow}>CURRENT PLAN</Text>
              <Text style={styles.planTitle} testID="plan-tier-name">{planTierLabel}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: `${uiStatusColor}18`, borderColor: uiStatusColor }]}>
              <Ionicons
                name={uiStatus === 'active' ? 'shield-checkmark' : uiStatus === 'cancelled_pending' ? 'time-outline' : uiStatus === 'trialing' ? 'flash-outline' : 'alert-circle'}
                size={14} color={uiStatusColor}
              />
              <Text style={[styles.statusText, { color: uiStatusColor }]} testID="subscription-status-pill">{uiStatusText}</Text>
            </View>
          </View>

          <View style={styles.grid} testID="plan-detail-grid">
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>Plan</Text>
              <Text style={styles.gridValue}>{planTierLabel}</Text>
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>Billing cycle</Text>
              <Text style={styles.gridValue}>{billingCycleLabel}</Text>
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>{expiryLabel}</Text>
              <Text style={styles.gridValue}>{endDateFmt}</Text>
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>Days remaining</Text>
              <Text style={[styles.gridValue, { color: daysColor }]}>
                {daysLeft === null ? '—' : `${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
              </Text>
            </View>
          </View>

          {nextPaymentAmount && !cancellationPending && (
            <View style={styles.nextPayment} testID="next-payment-line">
              <Ionicons name="card-outline" size={16} color={colors.onSurfaceSecondary} />
              <Text style={styles.nextPaymentText}>
                Next payment: <Text style={styles.bold}>{fmtINR(nextPaymentAmount.total)}</Text>
                <Text style={styles.nextPaymentSub}>
                  {`  (${fmtINR(nextPaymentAmount.pricePerBranch)} × ${nextPaymentAmount.branches} branch${nextPaymentAmount.branches === 1 ? '' : 'es'})`}
                </Text>
              </Text>
            </View>
          )}

          {cancellationPending && (
            <View style={styles.cancelNotice} testID="cancel-pending-notice">
              <Ionicons name="time-outline" size={14} color="#A05B00" />
              <Text style={styles.cancelNoticeText}>
                Plan set to cancel — access continues until <Text style={styles.bold}>{endDateFmt}</Text>.
              </Text>
            </View>
          )}

          {/* Buttons */}
          {isOwner && (
            <View style={styles.actionsCol}>
              {(isActiveOrTrial || isExpired) && !cancellationPending && (
                <TouchableOpacity style={styles.btnPrimary} onPress={openRenew} testID="btn-renew-subscription">
                  <Ionicons name={status === 'trialing' ? 'flash-outline' : 'refresh-outline'} size={18} color="#fff" />
                  <Text style={styles.btnPrimaryText}>{status === 'trialing' ? 'Activate plan' : 'Renew'}</Text>
                </TouchableOpacity>
              )}
              {cancellationPending && (
                <TouchableOpacity style={styles.btnPrimary} onPress={resumeSubscription} disabled={busy} testID="btn-resume-subscription">
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="refresh-circle-outline" size={18} color="#fff" />
                      <Text style={styles.btnPrimaryText}>Resume subscription</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {entitlements?.can_upgrade && !cancellationPending && (
                <TouchableOpacity style={styles.btnSecondary} onPress={openUpgrade} testID="btn-upgrade-growth">
                  <Ionicons name="trending-up-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.btnSecondaryText}>Upgrade to Growth</Text>
                </TouchableOpacity>
              )}
              {isActiveOrTrial && !cancellationPending && (
                <TouchableOpacity style={styles.btnGhostDanger} onPress={() => setCancelOpen(true)} testID="btn-cancel-subscription">
                  <Ionicons name="close-circle-outline" size={15} color={colors.error} />
                  <Text style={styles.btnGhostDangerText}>Cancel subscription</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* ==== Usage hub ==== */}
        {entitlements && (
          <View style={styles.usageCard} testID="usage-card">
            <Text style={styles.usageTitle}>Usage</Text>
            <View style={styles.usageRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.usageLabel}>Staff</Text>
                <Text style={styles.usageValue}>
                  <Text style={styles.usageBig}>{entitlements.staff_count}</Text>
                  <Text style={styles.usageMuted}>{`  / ${entitlements.staff_pool} pool`}</Text>
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.usageLabel}>Branches</Text>
                <Text style={styles.usageValue}>
                  <Text style={styles.usageBig}>{entitlements.branch_count}</Text>
                  <Text style={styles.usageMuted}>{`  / ${entitlements.branches_allowed} allowed`}</Text>
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ==== Support / Sign out ==== */}
        <TouchableOpacity style={styles.btnSecondary} onPress={openSupport} testID="btn-contact-support">
          <Ionicons name="mail-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.btnSecondaryText}>Contact support</Text>
        </TouchableOpacity>
        <Text style={styles.supportHint} selectable>{SUPPORT_EMAIL}</Text>

        {isExpired && (
          <TouchableOpacity onPress={logout} style={styles.logoutLink}>
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Snackbar */}
      {toast.msg && (
        <View style={styles.toast} pointerEvents="box-none">
          <View style={styles.toastBubble} testID="subscription-toast">
            <Ionicons name="alert-circle-outline" size={16} color="#fff" />
            <Text style={styles.toastText}>{toast.msg}</Text>
            <TouchableOpacity onPress={toast.hide}><Ionicons name="close" size={16} color="#fff" /></TouchableOpacity>
          </View>
        </View>
      )}

      {/* Cancellation confirmation modal */}
      <Modal visible={cancelOpen} transparent animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setCancelOpen(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <View style={styles.dialogIconWrap}>
              <Ionicons name="alert-circle" size={32} color={colors.warning} />
            </View>
            <Text style={styles.dialogTitle}>Cancel Subscription?</Text>
            <Text style={styles.dialogBody}>
              By cancelling, you confirm you will not renew your plan. You keep{'\n'}
              <Text style={styles.bold}>full access to all features</Text> until{'\n'}
              <Text style={styles.dialogDate}>{endDateFmt}</Text>.
            </Text>
            <Text style={styles.dialogNote}>All your data (bills, customers, staff, reports) remains preserved. You can renew any time.</Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.dialogBtnGhost} onPress={() => setCancelOpen(false)} disabled={busy}>
                <Text style={styles.dialogBtnGhostText}>Keep subscription</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogBtnDanger} onPress={confirmCancel} disabled={busy} testID="btn-cancel-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.dialogBtnDangerText}>Yes, cancel</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, alignItems: 'center', gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  logo: { width: 60, height: 60 },
  subtitle: { fontSize: 13, color: colors.onSurfaceTertiary, marginTop: -6, fontWeight: '600' },

  // Plan card
  planCard: {
    width: '100%', maxWidth: 560, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginTop: spacing.md, gap: spacing.md, ...shadows.card,
  },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  planEyebrow: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 0.8 },
  planTitle: { fontSize: 24, fontWeight: '900', color: colors.brandPrimary, marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridCell: { width: '48%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  gridLabel: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  gridValue: { fontSize: 15, fontWeight: '800', color: colors.onSurface, marginTop: 4 },

  nextPayment: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  nextPaymentText: { fontSize: 13, color: colors.onSurfaceSecondary, flexShrink: 1 },
  nextPaymentSub: { fontSize: 11, color: colors.onSurfaceTertiary },

  cancelNotice: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FDF3E4', borderColor: '#F0DCA6', borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm },
  cancelNoticeText: { fontSize: 12, color: '#4B3A16', flex: 1, lineHeight: 16 },

  actionsCol: { gap: spacing.sm, marginTop: 4 },
  btnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, ...shadows.sm },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: { width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: 12 },
  btnSecondaryText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 14 },
  btnGhostDanger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  btnGhostDangerText: { color: colors.error, fontWeight: '600', fontSize: 13 },

  // Usage
  usageCard: { width: '100%', maxWidth: 560, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  usageTitle: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  usageRow: { flexDirection: 'row', gap: spacing.md },
  usageLabel: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  usageValue: { marginTop: 4 },
  usageBig: { fontSize: 22, fontWeight: '900', color: colors.onSurface },
  usageMuted: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '600' },

  bold: { fontWeight: '800', color: colors.onSurface },
  supportHint: { fontSize: 11, color: colors.onSurfaceTertiary, textAlign: 'center' },
  logoutLink: { marginTop: spacing.lg },
  logoutText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: '600' },

  // Toast
  toast: { position: 'absolute', left: 0, right: 0, bottom: spacing.xl, alignItems: 'center', paddingHorizontal: spacing.lg },
  toastBubble: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#1f1e1c', borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12, maxWidth: 560, width: '100%' },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },

  // Modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  dialog: { width: '100%', maxWidth: 440, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.md, ...shadows.strong } as any,
  dialogIconWrap: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF6E5', alignItems: 'center', justifyContent: 'center' },
  dialogTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  dialogBody: { fontSize: 14, color: colors.onSurfaceSecondary, lineHeight: 20, textAlign: 'center' },
  dialogDate: { fontWeight: '900', color: colors.brandPrimary, fontSize: 15 },
  dialogNote: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center', lineHeight: 16 },
  dialogActions: { flexDirection: 'row', gap: spacing.sm, width: '100%', marginTop: spacing.sm },
  dialogBtnGhost: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  dialogBtnGhostText: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  dialogBtnDanger: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.error, alignItems: 'center' },
  dialogBtnDangerText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
