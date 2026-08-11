import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Linking, Modal, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows } from '@/src/theme';

const SUPPORT_EMAIL = 'support@parlourpilot.com';

// Format an ISO date as e.g. "Mon, 25 Aug 2026"
function formatEndDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return String(iso).slice(0, 10); }
}

export default function SubscriptionScreen() {
  const { subscription, tenant, user, logout, refreshTenant } = useAuth();
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const statusColor = (s: string) =>
    s === 'expired' ? colors.error :
    s === 'trialing' ? colors.warning :
    s === 'active' ? colors.success :
    s === 'suspended' ? colors.error : colors.info;

  const status = subscription?.status || 'expired';
  const isOwner = user?.role === 'admin' || user?.role === 'owner';
  const cancellationRequestedAt: string | null | undefined = (subscription as any)?.cancellation_requested_at;
  const cancellationPending: boolean = !!(subscription as any)?.cancellation_pending;
  const endIso = subscription?.subscription_end_date || subscription?.trial_end_date || null;
  const endDateFmt = formatEndDate(endIso);
  const isActiveOrTrial = status === 'active' || status === 'trialing';

  // Effective UI status
  const uiStatus = cancellationPending ? 'cancelled_pending' : status;

  const uiStatusText = (
    uiStatus === 'cancelled_pending' ? 'CANCELLED (PENDING EXPIRY)' :
    uiStatus.toUpperCase()
  );
  const uiStatusColor = (
    uiStatus === 'cancelled_pending' ? colors.warning :
    statusColor(uiStatus)
  );

  const openRenew = () => {
    if (!isOwner) {
      Alert.alert('Owner action required', 'Only the salon owner/admin can renew the subscription. Please contact your admin.');
      return;
    }
    router.push('/checkout?type=tenant');
  };

  const openSupport = async () => {
    const subject = encodeURIComponent(`ParlourPilot support — ${tenant?.business_name || 'account'}`);
    const bodyLines = [
      'Hi ParlourPilot Support,',
      '',
      'I need help with my account.',
      '',
      '— Account details —',
      `Business: ${tenant?.business_name || 'N/A'}`,
      `Email: ${user?.email || 'N/A'}`,
      `Subscription: ${status}`,
      `Plan: ${subscription?.subscription_plan || 'N/A'}`,
      tenant?.id ? `Tenant ID: ${tenant.id}` : '',
      '',
      'Please describe your issue below:',
      '',
    ].filter(Boolean).join('\n');
    const body = encodeURIComponent(bodyLines);
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    try {
      if (Platform.OS === 'web') {
        const w: any = typeof window !== 'undefined' ? window : null;
        if (w) { w.location.href = mailto; return; }
      }
      const supported = await Linking.canOpenURL(mailto);
      if (supported) await Linking.openURL(mailto);
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
      Alert.alert('Cancellation failed', e?.message || 'Please try again.');
    } finally { setBusy(false); }
  };

  const resumeSubscription = async () => {
    if (!isOwner) return;
    setBusy(true);
    try {
      await api('/tenants/me/cancel-subscription', { method: 'DELETE' });
      await refreshTenant();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Cancellation reversed', 'Your subscription will renew as usual.');
    } catch (e: any) {
      Alert.alert('Could not resume', e?.message || 'Please try again.');
    } finally { setBusy(false); }
  };

  const isExpired = status === 'expired' || status === 'suspended' || status === 'cancelled';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={styles.container}>
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
        <Text style={styles.brand}>ParlourPilot</Text>

        <View style={[styles.statusPill, { backgroundColor: `${uiStatusColor}20`, borderColor: uiStatusColor }]}>
          <Ionicons name={uiStatus === 'cancelled_pending' ? 'time-outline' : uiStatus === 'active' ? 'shield-checkmark' : 'alert-circle'} size={16} color={uiStatusColor} />
          <Text style={[styles.statusText, { color: uiStatusColor }]} testID="subscription-status-pill">{uiStatusText}</Text>
        </View>

        <Text style={styles.title}>
          {uiStatus === 'cancelled_pending' ? 'Cancellation Confirmed' :
           uiStatus === 'expired' ? 'Your subscription has expired' :
           uiStatus === 'suspended' ? 'Your account is suspended' :
           uiStatus === 'cancelled' ? 'Your subscription is cancelled' :
           uiStatus === 'trialing' ? 'You are on a free trial' :
           'Subscription Active'}
        </Text>

        {tenant && <Text style={styles.subtitle}>{tenant.business_name}</Text>}

        {/* Plan details card */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Current Plan</Text>
            <Text style={styles.value}>{subscription?.subscription_plan || '—'}</Text>
          </View>
          {subscription?.days_left !== null && subscription?.days_left !== undefined && (
            <View style={styles.row}>
              <Text style={styles.label}>Days Remaining</Text>
              <Text style={[styles.value, subscription.days_left <= 7 && { color: colors.warning }]}>
                {subscription.days_left} day{subscription.days_left === 1 ? '' : 's'}
              </Text>
            </View>
          )}
          {endIso && (
            <View style={styles.row}>
              <Text style={styles.label}>{isExpired ? 'Access Ended' : 'Access Until'}</Text>
              <Text style={styles.value}>{endDateFmt}</Text>
            </View>
          )}
          {cancellationRequestedAt && (
            <View style={styles.row}>
              <Text style={styles.label}>Cancelled On</Text>
              <Text style={styles.value}>{formatEndDate(cancellationRequestedAt)}</Text>
            </View>
          )}
        </View>

        {/* Cancellation Pending banner */}
        {uiStatus === 'cancelled_pending' && (
          <View style={styles.warnBox}>
            <Ionicons name="time-outline" size={20} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>You've confirmed non-renewal</Text>
              <Text style={styles.warnText}>
                Your subscription will not auto-renew. You continue to have <Text style={styles.bold}>full access</Text> to all
                features until <Text style={styles.bold}>{endDateFmt}</Text>. After that, your account will be locked
                — but all your data (bills, customers, reports) remains safely preserved for future renewal.
              </Text>
            </View>
          </View>
        )}

        {/* Active + not cancelled: reassurance */}
        {isActiveOrTrial && !cancellationPending && (
          <View style={styles.infoBox}>
            <Ionicons name="shield-checkmark" size={20} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>Everything is running smoothly</Text>
              <Text style={styles.infoText}>You have full access to all ParlourPilot features. No auto-renewal — you'll be reminded before {endDateFmt}.</Text>
            </View>
          </View>
        )}

        {/* Expired states */}
        {isExpired && (
          <View style={styles.infoBox}>
            <Ionicons name="shield-checkmark" size={20} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>Your data is safe</Text>
              <Text style={styles.infoText}>All salon data, bills, customers and reports remain preserved. Renew your subscription to resume access.</Text>
            </View>
          </View>
        )}

        {/* CTAs */}
        {isExpired && (
          <TouchableOpacity style={styles.btnPrimary} onPress={openRenew} testID="btn-renew-subscription">
            <Ionicons name="card-outline" size={18} color="#fff" />
            <Text style={styles.btnPrimaryText}>Renew Subscription</Text>
          </TouchableOpacity>
        )}

        {isActiveOrTrial && !cancellationPending && isOwner && (
          <TouchableOpacity style={styles.btnPrimary} onPress={openRenew} testID="btn-renew-subscription">
            <Ionicons name="refresh-outline" size={18} color="#fff" />
            <Text style={styles.btnPrimaryText}>Renew / Extend Plan</Text>
          </TouchableOpacity>
        )}

        {isActiveOrTrial && !cancellationPending && isOwner && (
          <TouchableOpacity style={styles.btnDanger} onPress={() => setCancelOpen(true)} testID="btn-cancel-subscription">
            <Ionicons name="close-circle-outline" size={18} color={colors.error} />
            <Text style={styles.btnDangerText}>Cancel Subscription</Text>
          </TouchableOpacity>
        )}

        {cancellationPending && isOwner && (
          <TouchableOpacity style={styles.btnPrimary} onPress={resumeSubscription} disabled={busy} testID="btn-resume-subscription">
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="refresh-circle-outline" size={18} color="#fff" />
                <Text style={styles.btnPrimaryText}>Undo Cancellation</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.btnSecondary} onPress={openSupport} testID="btn-contact-support">
          <Ionicons name="mail-outline" size={18} color={colors.brandPrimary} />
          <Text style={styles.btnSecondaryText}>Contact Support</Text>
        </TouchableOpacity>

        <Text style={styles.supportHint} selectable>Email: {SUPPORT_EMAIL}</Text>

        {isExpired && (
          <TouchableOpacity onPress={logout} style={styles.logoutLink}>
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Cancellation confirmation modal */}
      <Modal visible={cancelOpen} transparent animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setCancelOpen(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <View style={styles.dialogIconWrap}>
              <Ionicons name="alert-circle" size={32} color={colors.warning} />
            </View>
            <Text style={styles.dialogTitle}>Cancel Subscription?</Text>
            <Text style={styles.dialogBody}>
              By cancelling, you are confirming you will not renew your plan. You will still have{'\n'}
              <Text style={styles.bold}>full access to all features</Text> until your current subscription expires on{'\n'}
              <Text style={styles.dialogDate}>{endDateFmt}</Text>.
            </Text>
            <Text style={styles.dialogNote}>Your data (bills, customers, staff, reports) remains safely preserved. You can renew any time.</Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.dialogBtnGhost} onPress={() => setCancelOpen(false)} disabled={busy}>
                <Text style={styles.dialogBtnGhostText}>Keep Subscription</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogBtnDanger} onPress={confirmCancel} disabled={busy} testID="btn-cancel-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.dialogBtnDangerText}>Yes, Cancel</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, alignItems: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: spacing.md },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  logo: { width: 72, height: 72 },
  brand: { fontSize: 20, fontWeight: '900', color: colors.brandPrimary, marginTop: spacing.sm },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6,
    marginTop: spacing.lg,
  },
  statusText: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: '800', color: colors.onSurface, marginTop: spacing.lg, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.onSurfaceTertiary, marginTop: 4 },
  card: {
    width: '100%', maxWidth: 560, backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, gap: spacing.md, marginTop: spacing.xl, ...shadows.card,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: '600' },
  value: { fontSize: 14, color: colors.onSurface, fontWeight: '700' },
  bold: { fontWeight: '800', color: colors.onSurface },
  infoBox: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: '#E8F5EE',
    borderColor: '#B9E1CC', borderWidth: 1, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.lg, width: '100%', maxWidth: 560,
  },
  warnBox: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: '#FFF6E5',
    borderColor: '#F0DCA6', borderWidth: 1, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.lg, width: '100%', maxWidth: 560,
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  infoText: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 16 },
  warnTitle: { fontSize: 14, fontWeight: '800', color: '#A05B00' },
  warnText: { fontSize: 12, color: '#4B3A16', marginTop: 4, lineHeight: 18 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14,
    width: '100%', maxWidth: 560, marginTop: spacing.xl, ...shadows.card,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: 14,
    width: '100%', maxWidth: 560, marginTop: spacing.md,
  },
  btnSecondaryText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 15 },
  btnDanger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderColor: colors.error, borderWidth: 1, borderRadius: radius.md, paddingVertical: 14,
    width: '100%', maxWidth: 560, marginTop: spacing.md, backgroundColor: '#FDEDED',
  },
  btnDangerText: { color: colors.error, fontWeight: '700', fontSize: 15 },
  supportHint: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: spacing.md, textAlign: 'center' },
  logoutLink: { marginTop: spacing.xl },
  logoutText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: '600' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  dialog: {
    width: '100%', maxWidth: 440, backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.md, ...shadows.strong,
  } as any,
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
