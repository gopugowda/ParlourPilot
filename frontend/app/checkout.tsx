import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { branchApi, billingApi, paymentsApi, tenantApi, tokenStore } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// SaaS pricing.
// INR salons see local INR prices; every other salon sees flat USD prices.
// The actual gateway charge is ALWAYS in INR (subscription is processed in India).
const PRICES_INR: Record<string, { monthly: number; yearly: number }> = {
  starter: { monthly: 999, yearly: 9999 },
  growth: { monthly: 2499, yearly: 24999 },
  extra_branch: { monthly: 799, yearly: 7999 },
};
const PRICES_USD: Record<string, { monthly: number; yearly: number }> = {
  starter: { monthly: 12, yearly: 120 },
  growth: { monthly: 30, yearly: 300 },
  extra_branch: { monthly: 10, yearly: 100 },
};

// Back-compat map — legacy type='branch' means add-on branch, type='tenant' means starter.
const LEGACY_TYPE_MAP: Record<string, string> = {
  branch: 'extra_branch',
  tenant: 'starter',
};

type Plan = 'monthly' | 'yearly';

export default function CheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; intent?: string; kind?: string }>();
  const legacyType = (params?.type === 'tenant' ? 'tenant' : 'branch') as 'branch' | 'tenant';
  // Priority: explicit `kind` > `intent=upgrade` (Growth) > legacy type mapping.
  const kind: 'starter' | 'growth' | 'extra_branch' = (params?.kind as any)
    || (params?.intent === 'upgrade' ? 'growth'
      : (LEGACY_TYPE_MAP[legacyType] as any))
    || 'starter';
  const isBranchAddOn = kind === 'extra_branch';
  // Back-compat alias for existing code below which references `type` for branch payload.
  const type = isBranchAddOn ? 'branch' : 'tenant';
  const kindLabel = kind === 'growth' ? 'Growth plan upgrade'
    : kind === 'extra_branch' ? 'Add branch add-on'
    : 'Salon subscription';
  const { refreshBranches, refreshTenant, user, tenant } = useAuth();

  const [plan, setPlan] = useState<Plan>('monthly');

  // Determine display currency from the salon's chosen currency.
  // INR salons → local ₹ pricing. Everyone else → flat USD ($) pricing.
  const isINR = ((tenant as any)?.currency || 'INR').toUpperCase() === 'INR';
  const displaySymbol = isINR ? '₹' : '$';
  const displayCode = isINR ? 'INR' : 'USD';
  const displayPrices = isINR ? PRICES_INR : PRICES_USD;
  // Actual gateway amount is ALWAYS in INR (payments processed in India).
  const priceINR = PRICES_INR[kind][plan];
  const displayAmount = displayPrices[kind][plan];
  const monthlyDisplay = displayPrices[kind].monthly;
  const yearlyDisplay = displayPrices[kind].yearly;
  const annualSavings = monthlyDisplay * 12 - yearlyDisplay;
  const yearlyPerMonth = Math.round(yearlyDisplay / 12);

  // Branch payload (collected after payment success)
  const [branchName, setBranchName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [processing, setProcessing] = useState(false);

  const canPay = useMemo(() => {
    if (processing) return false;
    if (type !== 'branch') return true;
    return branchName.trim().length > 0;
  }, [processing, type, branchName]);

  const [gatewayReady, setGatewayReady] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg: any = await paymentsApi.config();
        setGatewayReady(!!cfg?.enabled);
      } catch { setGatewayReady(false); }
    })();
  }, []);

  // ---- Load Razorpay checkout.js on WEB ----
  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (Platform.OS !== 'web') return resolve(false);
      const w: any = typeof window !== 'undefined' ? window : null;
      if (!w) return resolve(false);
      if (w.Razorpay) return resolve(true);
      const script = w.document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      w.document.body.appendChild(script);
    });
  };

  const openRazorpayWeb = (order: any): Promise<any> => {
    return new Promise(async (resolve, reject) => {
      const ok = await loadRazorpayScript();
      const w: any = typeof window !== 'undefined' ? window : null;
      if (!ok || !w || !w.Razorpay) return reject(new Error('Failed to load Razorpay checkout'));
      const options = {
        key: order.key_id,
        amount: String(order.amount),
        currency: order.currency,
        order_id: order.order_id,
        name: order.name || 'ParlourPilot',
        description: order.description || 'Subscription',
        handler: (response: any) => resolve(response),
        modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
        theme: { color: colors.brandPrimary },
        prefill: {
          name: user?.name || undefined,
          email: user?.email || undefined,
        },
      };
      const rzp = new w.Razorpay(options);
      rzp.on('payment.failed', (r: any) => reject(new Error(r?.error?.description || 'Payment failed')));
      rzp.open();
    });
  };

  const openRazorpayNative = async (order: any): Promise<'paid' | 'cancelled' | 'failed'> => {
    // Use hosted checkout page + WebBrowser to complete payment. The page auto-verifies
    // on success and redirects to our returnUrl (Expo deep link) — WebBrowser then auto-closes.
    const token = await tokenStore.get();
    const returnUrl = Linking.createURL('checkout-done');
    const payUrl = `${API_BASE}/api/pay/${encodeURIComponent(order.order_id)}?token=${encodeURIComponent(token || '')}&return=${encodeURIComponent(returnUrl)}`;
    const result = await WebBrowser.openAuthSessionAsync(payUrl, returnUrl);
    if (result.type !== 'success' || !result.url) return 'cancelled';
    const parsed = Linking.parse(result.url);
    const status = String((parsed.queryParams as any)?.status || '');
    if (status === 'paid') return 'paid';
    if (status === 'failed') return 'failed';
    return 'cancelled';
  };

  const submitRazorpayPayment = async () => {
    if (!canPay) return;
    if (gatewayReady === false) {
      Alert.alert('Payment gateway not configured', 'Razorpay keys are not set on the server. Please contact support.');
      return;
    }
    setProcessing(true);
    try {
      // 1. Create order server-side (Growth uses unified billing endpoint; else legacy branch/tenant).
      const order: any = kind === 'growth'
        ? await billingApi.createOrder({ kind: 'growth', plan, display_currency: displayCode })
        : (type === 'branch'
            ? await branchApi.createOrder({
                plan,
                branch: {
                  name: branchName.trim(),
                  address: address.trim(),
                  city: city.trim(),
                  phone: phone.replace(/\D/g, ''),
                  invoice_prefix: invoicePrefix.trim(),
                  active: true,
                },
                display_amount: Math.round(displayAmount * 100) / 100,
                display_currency: displayCode,
              })
            : await tenantApi.createOrder({
                plan,
                display_amount: Math.round(displayAmount * 100) / 100,
                display_currency: displayCode,
              }));

      const verifyFn = kind === 'growth'
        ? billingApi.verifyPayment
        : (type === 'branch' ? branchApi.verifyPayment : tenantApi.verifyPayment);

      if (Platform.OS === 'web') {
        // 2a. Open Razorpay Checkout inline
        const response: any = await openRazorpayWeb(order);
        // 3. Verify server-side
        const verified: any = await verifyFn({
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature,
        });
        if (type === 'branch') {
          await refreshBranches();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Payment successful',
            `Branch "${verified?.branch?.name || branchName}" activated on the ${plan} plan.\n\nAmount: ${displaySymbol}${displayAmount.toFixed(2)} (₹${priceINR} INR)\nPayment ID: ${response.razorpay_payment_id}`,
            [{ text: 'Done', onPress: () => router.replace('/manage/branches') }]
          );
        } else {
          await refreshTenant();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Subscription renewed',
            `Your salon subscription is now active on the ${plan} plan.\n\nAmount: ${displaySymbol}${displayAmount.toFixed(2)} (₹${priceINR} INR)\nPayment ID: ${response.razorpay_payment_id}`,
            [{ text: 'Continue', onPress: () => router.replace('/(tabs)') }]
          );
        }
      } else {
        // 2b. Native (Expo Go / dev build): open hosted checkout in WebBrowser
        const status = await openRazorpayNative(order);
        if (status === 'paid') {
          if (type === 'branch') {
            await refreshBranches();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
              'Payment successful',
              `Branch "${branchName}" activated on the ${plan} plan.`,
              [{ text: 'Done', onPress: () => router.replace('/manage/branches') }]
            );
          } else {
            await refreshTenant();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
              'Subscription renewed',
              `Your salon subscription is now active on the ${plan} plan.`,
              [{ text: 'Continue', onPress: () => router.replace('/(tabs)') }]
            );
          }
        } else if (status === 'cancelled') {
          Alert.alert('Payment cancelled', 'You closed the payment window before completing.');
        } else {
          Alert.alert('Payment failed', 'Please try again or use a different card.');
        }
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = e?.message || String(e);
      if (msg.toLowerCase().includes('cancel')) {
        // silent — user closed the modal
      } else {
        Alert.alert('Payment failed', msg);
      }
    } finally {
      setProcessing(false);
    }
  };

  const title = type === 'branch' ? 'Add Branch — Checkout' : 'Renew Subscription';

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.backBtn}>
          <Ionicons name="home-outline" size={20} color={colors.onSurface} />
        </TouchableOpacity>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={70}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

          {/* Payment gateway status banner */}
          {gatewayReady === null ? (
            <View style={styles.mockBanner}>
              <ActivityIndicator size="small" color={colors.warning} />
              <Text style={styles.mockBannerText}>Loading payment gateway…</Text>
            </View>
          ) : gatewayReady ? (
            <View style={[styles.mockBanner, { backgroundColor: '#E7F5EC', borderColor: '#5FBF7F' }]}>
              <Ionicons name="shield-checkmark" size={18} color="#2F855A" />
              <Text style={[styles.mockBannerText, { color: '#204F32' }]}>
                Secure Razorpay checkout. {Platform.OS !== 'web' && '(Opens in secure browser)'}
              </Text>
            </View>
          ) : (
            <View style={styles.mockBanner}>
              <Ionicons name="warning" size={18} color={colors.warning} />
              <Text style={styles.mockBannerText}>Payment gateway not configured. Contact support.</Text>
            </View>
          )}

          {/* Plan selector */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.sectionLabel}>Choose Plan</Text>
            <Text style={{ fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '700' }}>{kindLabel}</Text>
          </View>
          <View style={styles.planRow}>
            <TouchableOpacity
              testID="plan-monthly"
              style={[styles.planCard, plan === 'monthly' && styles.planCardActive]}
              onPress={() => setPlan('monthly')}
            >
              <Text style={[styles.planName, plan === 'monthly' && styles.planNameActive]}>Monthly</Text>
              <Text style={[styles.planPrice, plan === 'monthly' && styles.planPriceActive]}>
                {displaySymbol}{monthlyDisplay.toLocaleString(isINR ? 'en-IN' : 'en-US')}
              </Text>
              <Text style={styles.planPer}>per month</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="plan-yearly"
              style={[styles.planCard, plan === 'yearly' && styles.planCardActive]}
              onPress={() => setPlan('yearly')}
            >
              <View style={styles.saveTag}>
                <Text style={styles.saveTagText}>
                  Save {displaySymbol}{annualSavings.toLocaleString(isINR ? 'en-IN' : 'en-US')}
                </Text>
              </View>
              <Text style={[styles.planName, plan === 'yearly' && styles.planNameActive]}>Yearly</Text>
              <Text style={[styles.planPrice, plan === 'yearly' && styles.planPriceActive]}>
                {displaySymbol}{yearlyDisplay.toLocaleString(isINR ? 'en-IN' : 'en-US')}
              </Text>
              <Text style={styles.planPer}>
                {`${displaySymbol}${yearlyPerMonth.toLocaleString(isINR ? 'en-IN' : 'en-US')}/mo · billed yearly`}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Amount preview */}
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>You will be charged</Text>
            <Text style={styles.amountBig}>
              {displaySymbol}{displayAmount.toLocaleString(isINR ? 'en-IN' : 'en-US', { maximumFractionDigits: 2 })}
            </Text>
            {!isINR && (
              <Text style={styles.amountSub}>Payments are processed in INR; the local figure is for reference only.</Text>
            )}
            <Text style={styles.amountRenew}>Auto-renews {plan === 'yearly' ? 'yearly' : 'monthly'} — cancel anytime</Text>
          </View>

          {/* Payment disclosure */}
          <View style={styles.disclosureCard}>
            <Ionicons name="information-circle-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.disclosureText}>
              Note: All subscription payments are processed in INR. Your local currency symbol is used for your salon&apos;s internal reporting only. International bank conversion rates may apply.
            </Text>
          </View>

          {/* Branch details */}
          {type === 'branch' && (
            <>
              <Text style={styles.sectionLabel}>Branch Details</Text>
              <View style={styles.card}>
                <View style={styles.field}>
                  <Text style={styles.label}>Branch Name *</Text>
                  <TextInput value={branchName} onChangeText={setBranchName} style={styles.input} placeholder="Downtown Salon" testID="branch-name" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Address</Text>
                  <TextInput value={address} onChangeText={setAddress} style={styles.input} placeholder="Street, area" />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>City</Text>
                    <TextInput value={city} onChangeText={setCity} style={styles.input} />
                  </View>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>Phone</Text>
                    <TextInput value={phone} onChangeText={setPhone} style={styles.input} keyboardType="phone-pad" />
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Invoice Prefix (e.g. B2)</Text>
                  <TextInput value={invoicePrefix} onChangeText={setInvoicePrefix} style={styles.input} autoCapitalize="characters" />
                </View>
              </View>
            </>
          )}

          {/* Pay button */}
          <TouchableOpacity
            testID="razorpay-pay-btn"
            style={[styles.payBtn, !canPay && { opacity: 0.6 }]}
            onPress={submitRazorpayPayment}
            disabled={!canPay}
          >
            {processing ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={styles.payBtnText}>Processing…</Text>
              </>
            ) : (
              <>
                <Ionicons name="card" size={18} color="#fff" />
                <Text style={styles.payBtnText}>
                  Pay {displaySymbol}{displayAmount.toLocaleString(isINR ? 'en-IN' : 'en-US', { maximumFractionDigits: 2 })} with Razorpay
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            🔒 Secured by Razorpay. All Indian payment methods supported — Cards, UPI, Netbanking, Wallets. In test mode use card 4111 1111 1111 1111, any future expiry, any CVV, OTP 1234.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },

  mockBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#FFF4D6', borderColor: '#F0C948', borderWidth: 1, padding: spacing.md, borderRadius: radius.sm, marginBottom: spacing.lg },
  mockBannerText: { flex: 1, fontSize: 12, color: '#5D4A00', fontWeight: '600' },

  sectionLabel: { fontSize: 12, fontWeight: '800', color: colors.brandPrimary, letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase' },

  planRow: { flexDirection: 'row', gap: spacing.md },
  planCard: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', position: 'relative' },
  planCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary, ...shadows.card },
  planName: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  planNameActive: { color: colors.brandPrimary },
  planPrice: { fontSize: 28, fontWeight: '900', color: colors.onSurface, marginTop: 8 },
  planPriceActive: { color: colors.brandPrimary },
  planPer: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4 },
  saveTag: { position: 'absolute', top: -8, right: 12, backgroundColor: colors.success, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  saveTagText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  currencyBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 14 },
  currencySym: { fontSize: 22, fontWeight: '800', color: colors.brandPrimary, minWidth: 32 },
  currencyName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.onSurface },

  amountCard: { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.md, alignItems: 'center' },
  amountLabel: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary, letterSpacing: 0.5, textTransform: 'uppercase' },
  amountBig: { fontSize: 40, fontWeight: '900', color: colors.brandPrimary, marginTop: 6 },
  amountSub: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 4 },
  amountRenew: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 8 },

  disclosureCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: spacing.md, padding: spacing.md,
    backgroundColor: '#FFF8E7', borderWidth: 1, borderColor: '#F0D97A',
    borderRadius: radius.sm,
  },
  disclosureText: { flex: 1, fontSize: 11, color: '#8A4B00', lineHeight: 16 },

  card: { backgroundColor: '#FFFFFF', padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, ...shadows.card, gap: spacing.md },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.sm, fontSize: 15, minHeight: 44, color: colors.onSurface },

  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, marginTop: spacing.xl, ...shadows.card },
  payBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  disclaimer: { fontSize: 11, color: colors.onSurfaceTertiary, textAlign: 'center', marginTop: spacing.md, lineHeight: 16, paddingHorizontal: spacing.md },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  pickerSheet: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, width: '100%', maxWidth: 420, gap: spacing.md },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  pickerItemActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary },
  pickerItemText: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  pickerItemMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  ghostBtn: { alignSelf: 'stretch', paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  ghostBtnText: { color: colors.onSurfaceSecondary, fontWeight: '700' },
});
