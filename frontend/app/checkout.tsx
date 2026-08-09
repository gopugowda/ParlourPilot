import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, TextInput, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { branchApi } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

// SaaS pricing (INR base). These match the backend BRANCH_PLAN_PRICES_INR / TENANT_PLAN_PRICES_INR.
const PRICES: Record<string, { monthly: number; yearly: number }> = {
  branch: { monthly: 888, yearly: 8888 },
  tenant: { monthly: 999, yearly: 9999 },
};

type Plan = 'monthly' | 'yearly';

// Curated list of major target currencies for SaaS billing (display only)
const SUB_CURRENCIES: Array<{ code: string; symbol: string; label: string }> = [
  { code: 'INR', symbol: '₹',  label: 'Indian Rupee' },
  { code: 'USD', symbol: '$',  label: 'US Dollar' },
  { code: 'EUR', symbol: '€',  label: 'Euro' },
  { code: 'GBP', symbol: '£',  label: 'British Pound' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar' },
  { code: 'MYR', symbol: 'RM', label: 'Malaysian Ringgit' },
  { code: 'JPY', symbol: '¥',  label: 'Japanese Yen' },
];

async function fetchFxRates(base: string): Promise<Record<string, number>> {
  // Free public FX API (no key). Rate keys are ISO codes: { USD: 0.012, ... }
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
    const data = await res.json();
    if (data && data.result === 'success' && data.rates) return data.rates as Record<string, number>;
  } catch {}
  // Fallback approximate rates (as of mid-2026) so the UI still works offline.
  return { INR: 1, USD: 0.012, EUR: 0.011, GBP: 0.0094, AUD: 0.018, CAD: 0.016, AED: 0.044, SGD: 0.016, MYR: 0.054, JPY: 1.83 };
}

export default function CheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const type = (params?.type === 'tenant' ? 'tenant' : 'branch') as 'branch' | 'tenant';
  const { refreshBranches, refreshTenant } = useAuth();

  const [plan, setPlan] = useState<Plan>('monthly');
  const [subCurrency, setSubCurrency] = useState<string>('INR');
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({ INR: 1 });
  const [ratesLoading, setRatesLoading] = useState(true);

  // Branch payload (collected after payment success)
  const [branchName, setBranchName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    (async () => {
      setRatesLoading(true);
      const r = await fetchFxRates('INR');
      setRates(r);
      setRatesLoading(false);
    })();
  }, []);

  // Attempt basic geolocation → auto-suggest currency by locale
  useEffect(() => {
    try {
      const locale = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
      const mapping: Record<string, string> = {
        us: 'USD', gb: 'GBP', in: 'INR', au: 'AUD', ca: 'CAD', ae: 'AED', sg: 'SGD',
        my: 'MYR', jp: 'JPY', de: 'EUR', fr: 'EUR', it: 'EUR', es: 'EUR', ie: 'EUR', nl: 'EUR',
      };
      const parts = locale.split('-');
      const region = parts[parts.length - 1];
      const guess = mapping[region];
      if (guess && SUB_CURRENCIES.find(c => c.code === guess)) setSubCurrency(guess);
    } catch {}
  }, []);

  const priceINR = PRICES[type][plan];
  const rate = rates[subCurrency] ?? 1;
  const displayAmount = subCurrency === 'INR' ? priceINR : priceINR * rate;
  const symbol = SUB_CURRENCIES.find(c => c.code === subCurrency)?.symbol || '₹';

  const canPay = useMemo(() => {
    if (processing) return false;
    if (type !== 'branch') return true;
    return branchName.trim().length > 0;
  }, [processing, type, branchName]);

  const submitMockPayment = async () => {
    if (!canPay) return;
    setProcessing(true);
    try {
      // Simulate a payment sleep
      await new Promise(res => setTimeout(res, 1500));
      if (type === 'branch') {
        const ref = `MOCKPAY-${Date.now().toString(36).toUpperCase()}`;
        await branchApi.checkout({
          plan,
          branch: {
            name: branchName.trim(),
            address: address.trim(),
            city: city.trim(),
            phone: phone.replace(/\D/g, ''),
            invoice_prefix: invoicePrefix.trim(),
            active: true,
          },
          amount_inr: priceINR,
          display_amount: Math.round(displayAmount * 100) / 100,
          display_currency: subCurrency,
          payment_reference: ref,
        });
        await refreshBranches();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Payment successful (mock)',
          `Branch "${branchName}" activated on the ${plan} plan.\n\nReference: ${ref}\nAmount charged: ${symbol}${displayAmount.toFixed(2)} (₹${priceINR} INR)\n\nNext renewal in ${plan === 'yearly' ? '365' : '30'} days.`,
          [{ text: 'Done', onPress: () => router.replace('/manage/branches') }]
        );
      } else {
        // tenant checkout — future: extend main tenant subscription
        Alert.alert('Coming soon', 'Main salon subscription renewal is coming soon.');
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Payment failed', e.message || String(e));
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

          {/* MOCK-PAYMENT banner */}
          <View style={styles.mockBanner}>
            <Ionicons name="information-circle" size={18} color={colors.warning} />
            <Text style={styles.mockBannerText}>MOCK payment — no real charge is made. Real gateway coming soon.</Text>
          </View>

          {/* Plan selector */}
          <Text style={styles.sectionLabel}>Choose Plan</Text>
          <View style={styles.planRow}>
            <TouchableOpacity
              testID="plan-monthly"
              style={[styles.planCard, plan === 'monthly' && styles.planCardActive]}
              onPress={() => setPlan('monthly')}
            >
              <Text style={[styles.planName, plan === 'monthly' && styles.planNameActive]}>Monthly</Text>
              <Text style={[styles.planPrice, plan === 'monthly' && styles.planPriceActive]}>₹{PRICES[type].monthly}</Text>
              <Text style={styles.planPer}>per month</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="plan-yearly"
              style={[styles.planCard, plan === 'yearly' && styles.planCardActive]}
              onPress={() => setPlan('yearly')}
            >
              <View style={styles.saveTag}><Text style={styles.saveTagText}>Save ~17%</Text></View>
              <Text style={[styles.planName, plan === 'yearly' && styles.planNameActive]}>Yearly</Text>
              <Text style={[styles.planPrice, plan === 'yearly' && styles.planPriceActive]}>₹{PRICES[type].yearly}</Text>
              <Text style={styles.planPer}>per year</Text>
            </TouchableOpacity>
          </View>

          {/* Currency selector */}
          <Text style={styles.sectionLabel}>Pay in Currency</Text>
          <TouchableOpacity style={styles.currencyBtn} onPress={() => setCurrencyPickerOpen(true)} testID="pay-currency">
            <Text style={styles.currencySym}>{symbol}</Text>
            <Text style={styles.currencyName}>{subCurrency} — {SUB_CURRENCIES.find(c => c.code === subCurrency)?.label}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.onSurfaceTertiary} />
          </TouchableOpacity>

          {/* Amount preview */}
          <View style={styles.amountCard}>
            {ratesLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (
              <>
                <Text style={styles.amountLabel}>You will be charged</Text>
                <Text style={styles.amountBig}>
                  {symbol}{displayAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </Text>
                {subCurrency !== 'INR' && (
                  <Text style={styles.amountSub}>(base price ₹{priceINR} INR · live FX 1 INR ≈ {rate.toFixed(4)} {subCurrency})</Text>
                )}
                <Text style={styles.amountRenew}>Auto-renews {plan === 'yearly' ? 'yearly' : 'monthly'} — cancel anytime</Text>
              </>
            )}
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
            testID="mock-pay-btn"
            style={[styles.payBtn, !canPay && { opacity: 0.6 }]}
            onPress={submitMockPayment}
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
                  Pay {symbol}{displayAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} & Activate
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            By continuing you agree to the ParlourPilot terms. This is a mock payment flow for demo — real Stripe/Razorpay integration comes later. Your card is not charged.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Currency picker */}
      <Modal visible={currencyPickerOpen} transparent animationType="fade" onRequestClose={() => setCurrencyPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCurrencyPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Choose Payment Currency</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {SUB_CURRENCIES.map(c => {
                const sel = c.code === subCurrency;
                const rInv = rates[c.code] ?? null;
                const approx = rInv ? (priceINR * rInv) : null;
                return (
                  <TouchableOpacity
                    key={c.code}
                    testID={`pay-cur-${c.code}`}
                    onPress={() => { setSubCurrency(c.code); setCurrencyPickerOpen(false); Haptics.selectionAsync(); }}
                    style={[styles.pickerItem, sel && styles.pickerItemActive]}
                  >
                    <Text style={{ fontSize: 20, fontWeight: '800', color: sel ? colors.brandPrimary : colors.onSurface, minWidth: 40 }}>{c.symbol}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerItemText, sel && { color: colors.brandPrimary, fontWeight: '800' }]}>{c.code}</Text>
                      <Text style={styles.pickerItemMeta}>
                        {c.label}
                        {approx !== null && ` · ≈ ${c.symbol}${approx.toFixed(2)}`}
                      </Text>
                    </View>
                    {sel && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setCurrencyPickerOpen(false)}>
              <Text style={styles.ghostBtnText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
