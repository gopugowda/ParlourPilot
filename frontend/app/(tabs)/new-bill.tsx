import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal,
  ActivityIndicator, Pressable, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

const DEFAULT_MEMBER_PCT = 10;
const DEFAULT_MEMBER_MIN_PRICE = 100;

type Service = { id: string; name: string; price: number; category: string; tax_percentage?: number };
type Beautician = { id: string; name: string; role: string };
type Item = {
  service_id?: string; service_name: string; price: number;
  discount_pct: number; tax_percentage?: number;
  beautician_id?: string; beautician_name: string;
  tip_amount?: number; tip_via?: 'cash' | 'qr';
};

export default function NewBillScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tenant } = useAuth();
  const params = useLocalSearchParams<{ edit?: string }>();
  const editBillId = params?.edit as string | undefined;
  const [services, setServices] = useState<Service[]>([]);
  const [beauticians, setBeauticians] = useState<Beautician[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'qr' | 'split'>('cash');
  const [cashAmt, setCashAmt] = useState('');
  const [qrAmt, setQrAmt] = useState('');
  const [isMember, setIsMember] = useState(false);
  const [memberDiscountPct, setMemberDiscountPct] = useState<number | null>(null); // per-member override
  const [memberInfo, setMemberInfo] = useState<{ name: string; status: string; days_left: number | null } | null>(null);
  const [tipAmt, setTipAmt] = useState('');
  const [tipVia, setTipVia] = useState<'cash' | 'qr'>('cash');
  const [tipBeauticianId, setTipBeauticianId] = useState<string | undefined>();
  const [tipBeauticianName, setTipBeauticianName] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Picker modals — 'tip-beautician' picks the beautician who received the tip
  const [pickerFor, setPickerFor] = useState<{ index: number; type: 'service' | 'beautician' } | { type: 'tip-beautician' } | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');

  const loadData = async () => {
    try {
      const [s, b] = await Promise.all([api('/services'), api('/beauticians')]);
      setServices(((s as any[]) || []).filter(x => x.active));
      setBeauticians(((b as any[]) || []).filter(x => x.active));
    } catch {}
  };

  useEffect(() => { loadData(); }, []);
  useFocusEffect(useCallback(() => { loadData(); }, []));

  // Load existing bill for edit mode
  useEffect(() => {
    if (!editBillId) return;
    (async () => {
      try {
        const b: any = await api(`/bills/${editBillId}`);
        setItems((b.items || []).map((it: any) => ({
          service_id: it.service_id, service_name: it.service_name,
          price: it.price, discount_pct: it.discount_pct || 0,
          tax_percentage: it.tax_percentage || 0,
          beautician_id: it.beautician_id, beautician_name: it.beautician_name,
          tip_amount: it.tip_amount || 0, tip_via: it.tip_via || 'cash',
        })));
        setCustomerName(b.customer_name || ''); setCustomerPhone(b.customer_phone || '');
        setIsMember(!!b.is_member);
        setPaymentMode(b.payment_mode); setCashAmt(String(b.cash_amount || '')); setQrAmt(String(b.qr_amount || ''));
        setTipAmt(b.tip_amount ? String(b.tip_amount - (b.items || []).reduce((s: number, it: any) => s + (it.tip_amount || 0), 0)) : '');
        setTipVia(b.tip_via || 'cash');
        setTipBeauticianId(b.tip_beautician_id); setTipBeauticianName(b.tip_beautician_name || '');
      } catch {}
    })();
  }, [editBillId]);

  // Tenant-configurable member settings
  const tenantMemberPct = tenant?.member_discount_pct ?? DEFAULT_MEMBER_PCT;
  const tenantMinPrice = tenant?.member_min_price ?? DEFAULT_MEMBER_MIN_PRICE;

  // Auto-detect member by phone with proper reset behavior
  useEffect(() => {
    const p = (customerPhone || '').trim();
    // Short/empty phone → clear all member state
    if (p.length < 4) {
      setMemberInfo(null);
      setIsMember(false);
      setMemberDiscountPct(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res: any = await api(`/members/lookup?phone=${encodeURIComponent(p)}`);
        if (cancelled) return;
        if (res?.found && res.is_active_member) {
          setMemberInfo({ name: res.member.name, status: res.member.status, days_left: res.member.days_left });
          setIsMember(true);
          const pct = res.member?.effective_discount_pct ?? res.member?.discount_pct ?? null;
          setMemberDiscountPct(typeof pct === 'number' ? pct : null);
          if (!customerName && res.member.name) setCustomerName(res.member.name);
        } else if (res?.found) {
          // Found but expired/inactive → show info banner but NO discount
          setMemberInfo({ name: res.member.name, status: res.member.status, days_left: res.member.days_left });
          setIsMember(false);
          setMemberDiscountPct(null);
        } else {
          // Not found → non-member
          setMemberInfo(null);
          setIsMember(false);
          setMemberDiscountPct(null);
        }
      } catch {
        if (!cancelled) {
          setMemberInfo(null);
          setIsMember(false);
          setMemberDiscountPct(null);
        }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [customerPhone]);

  const addItem = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setItems(prev => [...prev, { service_name: '', price: 0, discount_pct: 0, beautician_name: '' }]);
  };

  const updateItem = (i: number, patch: Partial<Item>) => {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  };

  const removeItem = (i: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems(prev => prev.filter((_, idx) => idx !== i));
  };

  const memberPctToApply = memberDiscountPct ?? tenantMemberPct;
  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const discount = items.reduce((s, it) => {
    const price = Number(it.price) || 0;
    const manual = Number(it.discount_pct) || 0;
    const member = isMember && price > tenantMinPrice ? memberPctToApply : 0;
    const eff = Math.max(manual, member);
    return s + price * (eff / 100);
  }, 0);
  const servicesNet = Math.max(0, subtotal - discount);
  // Per-item tax (applied on line net = price - discount)
  const taxTotal = items.reduce((s, it) => {
    const price = Number(it.price) || 0;
    const manual = Number(it.discount_pct) || 0;
    const member = isMember && price > tenantMinPrice ? memberPctToApply : 0;
    const eff = Math.max(manual, member);
    const lineNet = price * (1 - eff / 100);
    const taxPct = Number(it.tax_percentage) || 0;
    return s + lineNet * (taxPct / 100);
  }, 0);
  const lineTipTotal = items.reduce((s, it) => s + (Number(it.tip_amount) || 0), 0);
  const tip = Math.max(0, Number(tipAmt) || 0) + lineTipTotal;
  const total = servicesNet + taxTotal + tip;

  const resetForm = () => {
    setItems([]); setCustomerName(''); setCustomerPhone('');
    setPaymentMode('cash'); setCashAmt(''); setQrAmt('');
    setIsMember(false); setMemberDiscountPct(null);
    setTipAmt(''); setTipVia('cash');
    setTipBeauticianId(undefined); setTipBeauticianName('');
    setMemberInfo(null);
  };

  const onSubmit = async () => {
    setErr(null);
    if (items.length === 0) { setErr('Add at least one service'); return; }
    for (const it of items) {
      if (!it.service_name) { setErr('Select service for all rows'); return; }
      if (!it.beautician_name) { setErr('Assign beautician for all rows'); return; }
      if (!(Number(it.price) > 0)) { setErr('Price must be > 0'); return; }
    }
    if (Math.max(0, Number(tipAmt) || 0) > 0 && !tipBeauticianName) { setErr('Choose beautician who received the tip'); return; }
    let cash = 0, qr = 0;
    const payable = servicesNet + taxTotal;
    if (paymentMode === 'cash') cash = payable;
    else if (paymentMode === 'qr') qr = payable;
    else {
      cash = Number(cashAmt) || 0; qr = Number(qrAmt) || 0;
      if (Math.abs(cash + qr - payable) > 0.01) { setErr(`Split for services + tax must total ${fmtINR(payable)}`); return; }
    }
    setSaving(true);
    try {
      const payload = {
        customer_name: customerName || 'Walk-in',
        customer_phone: customerPhone,
        items: items.map(it => ({
          service_id: it.service_id, service_name: it.service_name,
          price: Number(it.price), discount_pct: Number(it.discount_pct) || 0,
          tax_percentage: Number(it.tax_percentage) || 0,
          beautician_id: it.beautician_id, beautician_name: it.beautician_name,
          tip_amount: Number(it.tip_amount) || 0,
          tip_via: (Number(it.tip_amount) || 0) > 0 ? (it.tip_via || 'cash') : null,
        })),
        payment_mode: paymentMode,
        cash_amount: cash, qr_amount: qr,
        is_member: isMember,
        tip_amount: Math.max(0, Number(tipAmt) || 0),
        tip_via: (Number(tipAmt) || 0) > 0 ? tipVia : null,
        tip_beautician_id: (Number(tipAmt) || 0) > 0 ? tipBeauticianId : null,
        tip_beautician_name: (Number(tipAmt) || 0) > 0 ? tipBeauticianName : '',
      };
      const bill: any = editBillId
        ? await api(`/bills/${editBillId}`, { method: 'PUT', body: payload })
        : await api('/bills', { method: 'POST', body: payload });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      resetForm();
      router.replace(`/bill/${bill.id}` as any);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message || 'Failed to save bill');
    } finally {
      setSaving(false);
    }
  };

  const pickerData = pickerFor?.type === 'service'
    ? services.filter(s => s.name.toLowerCase().includes(pickerSearch.toLowerCase()))
    : (pickerFor?.type === 'beautician' || pickerFor?.type === 'tip-beautician')
      ? beauticians.filter(b => b.name.toLowerCase().includes(pickerSearch.toLowerCase()))
      : [];

  return (
    <View style={styles.root} testID="new-bill-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.headerTitle}>New Bill</Text>
        <Text style={styles.headerSub}>Add services and process payment</Text>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
          {/* Customer */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Customer</Text>
            <TextInput
              testID="customer-name-input"
              placeholder="Customer name (optional)"
              placeholderTextColor={colors.onSurfaceTertiary}
              value={customerName}
              onChangeText={setCustomerName}
              style={styles.input}
            />
            <TextInput
              testID="customer-phone-input"
              placeholder="Phone (optional)"
              placeholderTextColor={colors.onSurfaceTertiary}
              value={customerPhone}
              onChangeText={setCustomerPhone}
              keyboardType="phone-pad"
              style={styles.input}
            />
          </View>

          {/* Items */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.cardTitle}>Services</Text>
              <TouchableOpacity testID="add-service-btn" onPress={addItem} style={styles.addBtn}>
                <Ionicons name="add" size={18} color={colors.brandPrimary} />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {items.length === 0 && (
              <TouchableOpacity onPress={addItem} style={styles.emptyItems} testID="empty-add-service">
                <Ionicons name="add-circle-outline" size={28} color={colors.brandPrimary} />
                <Text style={styles.emptyItemsText}>Tap to add first service</Text>
              </TouchableOpacity>
            )}

            {items.map((it, i) => {
              const price = Number(it.price) || 0;
              const manual = Number(it.discount_pct) || 0;
              const memberPct = isMember && price > tenantMinPrice ? memberPctToApply : 0;
              const effPct = Math.max(manual, memberPct);
              const lineTotal = price * (1 - effPct / 100);
              const lineTax = lineTotal * (Number(it.tax_percentage) || 0) / 100;
              const memberActive = memberPct > 0 && memberPct >= manual;
              return (
                <View key={i} style={styles.itemBlock} testID={`item-row-${i}`}>
                  <View style={styles.itemHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.itemNum}>#{i + 1}</Text>
                      {memberActive && (
                        <View style={styles.memberBadge}>
                          <Ionicons name="star" size={9} color="#fff" />
                          <Text style={styles.memberBadgeText}>-{memberPct}% Member</Text>
                        </View>
                      )}
                      {(Number(it.tax_percentage) || 0) > 0 && (
                        <View style={styles.taxBadge}>
                          <Text style={styles.taxBadgeText}>Tax {it.tax_percentage}%</Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity testID={`item-remove-${i}`} onPress={() => removeItem(i)}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    testID={`item-service-${i}`}
                    onPress={() => { setPickerSearch(''); setPickerFor({ index: i, type: 'service' }); }}
                    style={styles.selectField}
                  >
                    <Ionicons name="cut-outline" size={16} color={colors.onSurfaceTertiary} />
                    <Text style={[styles.selectText, !it.service_name && styles.selectPlaceholder]} numberOfLines={1}>
                      {it.service_name || 'Select service'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID={`item-beautician-${i}`}
                    onPress={() => { setPickerSearch(''); setPickerFor({ index: i, type: 'beautician' }); }}
                    style={styles.selectField}
                  >
                    <Ionicons name="person-outline" size={16} color={colors.onSurfaceTertiary} />
                    <Text style={[styles.selectText, !it.beautician_name && styles.selectPlaceholder]} numberOfLines={1}>
                      {it.beautician_name || 'Assign beautician'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={[styles.smallField, { flex: 1 }]}>
                      <Text style={styles.smallLabel}>Price (₹)</Text>
                      <TextInput
                        testID={`item-price-${i}`}
                        value={it.price ? String(it.price) : ''}
                        onChangeText={(v) => updateItem(i, { price: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        style={styles.smallInput}
                      />
                    </View>
                    <View style={[styles.smallField, { flex: 1 }]}>
                      <Text style={styles.smallLabel}>Discount %</Text>
                      <TextInput
                        testID={`item-discount-${i}`}
                        value={it.discount_pct ? String(it.discount_pct) : ''}
                        onChangeText={(v) => updateItem(i, { discount_pct: Math.min(100, Number(v.replace(/[^0-9.]/g, '')) || 0) })}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        style={styles.smallInput}
                      />
                    </View>
                    <View style={[styles.smallField, { flex: 1.2, backgroundColor: colors.brandTertiary }]}>
                      <Text style={styles.smallLabel}>Line Total</Text>
                      <Text style={[styles.smallInput, { color: colors.brandPrimary, fontWeight: '700' }]}>{fmtINR(lineTotal)}</Text>
                    </View>
                  </View>

                  {/* Per-line tip */}
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
                    <View style={[styles.smallField, { flex: 1 }]}>
                      <Text style={styles.smallLabel}>Tip (₹) — to {it.beautician_name || 'beautician'}</Text>
                      <TextInput
                        testID={`item-tip-${i}`}
                        value={it.tip_amount ? String(it.tip_amount) : ''}
                        onChangeText={(v) => updateItem(i, { tip_amount: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        style={styles.smallInput}
                      />
                    </View>
                    {(Number(it.tip_amount) || 0) > 0 && (
                      <View style={[styles.smallField, { flex: 1 }]}>
                        <Text style={styles.smallLabel}>Tip via</Text>
                        <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                          {(['cash', 'qr'] as const).map(v => (
                            <TouchableOpacity
                              key={v}
                              testID={`item-tipvia-${i}-${v}`}
                              onPress={() => { Haptics.selectionAsync(); updateItem(i, { tip_via: v }); }}
                              style={[styles.tipViaChip, (it.tip_via || 'cash') === v && styles.tipViaChipActive]}
                            >
                              <Text style={[styles.tipViaText, (it.tip_via || 'cash') === v && styles.tipViaTextActive]}>{v.toUpperCase()}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                  {(Number(it.tip_amount) || 0) > 0 && it.tip_via === 'qr' && (
                    <View style={styles.tipNote}>
                      <Ionicons name="information-circle" size={12} color={colors.warning} />
                      <Text style={styles.tipNoteText}>
                        Give {fmtINR(Number(it.tip_amount) || 0)} cash from counter to {it.beautician_name}.
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Membership */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={styles.memberIcon}>
                <Ionicons name="star" size={16} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Yearly Membership</Text>
                <Text style={styles.hintText}>Flat 10% off on services above ₹100</Text>
              </View>
              <Switch
                testID="member-switch"
                value={isMember}
                onValueChange={(v) => { Haptics.selectionAsync(); setIsMember(v); }}
                trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
                thumbColor="#fff"
              />
            </View>
            {memberInfo && memberInfo.status !== 'inactive' && (
              <View style={[styles.memberDetectBanner, memberInfo.status === 'expired' && { backgroundColor: '#FDE7E7', borderColor: '#F2B5B5' }]}>
                <Ionicons
                  name={memberInfo.status === 'expired' ? 'alert-circle' : 'checkmark-circle'}
                  size={16}
                  color={memberInfo.status === 'expired' ? colors.error : colors.success}
                />
                <Text style={styles.memberDetectText}>
                  {memberInfo.status === 'expired'
                    ? `${memberInfo.name} — membership EXPIRED`
                    : memberInfo.status === 'expiring_soon'
                      ? `${memberInfo.name} — active (${memberInfo.days_left}d left)`
                      : `${memberInfo.name} — active member`}
                </Text>
              </View>
            )}
          </View>

          {/* Tip */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tip (optional)</Text>
            <Text style={styles.hintText}>
              Tip goes to the beautician. If paid via QR/UPI, cash from counter is given to beautician.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={[styles.smallField, { flex: 1 }]}>
                <Text style={styles.smallLabel}>Amount (₹)</Text>
                <TextInput
                  testID="tip-amount-input"
                  value={tipAmt}
                  onChangeText={(v) => setTipAmt(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.smallInput}
                />
              </View>
              <View style={[styles.smallField, { flex: 1.4 }]}>
                <Text style={styles.smallLabel}>Paid via</Text>
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                  {(['cash', 'qr'] as const).map(v => (
                    <TouchableOpacity
                      key={v}
                      testID={`tip-via-${v}`}
                      disabled={tip <= 0}
                      onPress={() => { Haptics.selectionAsync(); setTipVia(v); }}
                      style={[styles.tipViaChip, tipVia === v && styles.tipViaChipActive, tip <= 0 && { opacity: 0.5 }]}
                    >
                      <Ionicons name={v === 'cash' ? 'cash-outline' : 'qr-code-outline'} size={12} color={tipVia === v ? '#fff' : colors.onSurfaceSecondary} />
                      <Text style={[styles.tipViaText, tipVia === v && styles.tipViaTextActive]}>{v === 'cash' ? 'Cash' : 'QR'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            {tip > 0 && (
              <TouchableOpacity
                testID="tip-beautician-btn"
                onPress={() => { setPickerSearch(''); setPickerFor({ type: 'tip-beautician' }); }}
                style={styles.selectField}
              >
                <Ionicons name="person-outline" size={16} color={colors.onSurfaceTertiary} />
                <Text style={[styles.selectText, !tipBeauticianName && styles.selectPlaceholder]} numberOfLines={1}>
                  {tipBeauticianName || 'Which beautician gets the tip?'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
              </TouchableOpacity>
            )}
            {tip > 0 && tipVia === 'qr' && (
              <View style={styles.tipNote}>
                <Ionicons name="information-circle" size={14} color={colors.warning} />
                <Text style={styles.tipNoteText}>
                  Give {fmtINR(tip)} cash from counter to {tipBeauticianName || 'the beautician'}.
                </Text>
              </View>
            )}
          </View>

          {/* Payment */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Payment Mode (Services)</Text>
            <Text style={styles.hintText}>How the customer paid for services + tax: {fmtINR(servicesNet + taxTotal)}</Text>
            <View style={styles.segmentRow}>
              {[
                { k: 'cash', label: 'Cash', icon: 'cash-outline' },
                { k: 'qr', label: 'QR / UPI', icon: 'qr-code-outline' },
                { k: 'split', label: 'Split', icon: 'git-branch-outline' },
              ].map(o => (
                <TouchableOpacity
                  key={o.k}
                  testID={`pay-mode-${o.k}`}
                  onPress={() => { Haptics.selectionAsync(); setPaymentMode(o.k as any); }}
                  style={[styles.segment, paymentMode === o.k && styles.segmentActive]}
                >
                  <Ionicons name={o.icon as any} size={16} color={paymentMode === o.k ? '#fff' : colors.onSurfaceTertiary} />
                  <Text style={[styles.segmentText, paymentMode === o.k && styles.segmentTextActive]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {paymentMode === 'split' && (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <View style={[styles.smallField, { flex: 1 }]}>
                  <Text style={styles.smallLabel}>Cash (₹)</Text>
                  <TextInput
                    testID="split-cash-input"
                    value={cashAmt}
                    onChangeText={(v) => setCashAmt(v.replace(/[^0-9.]/g, ''))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.smallInput}
                  />
                </View>
                <View style={[styles.smallField, { flex: 1 }]}>
                  <Text style={styles.smallLabel}>QR (₹)</Text>
                  <TextInput
                    testID="split-qr-input"
                    value={qrAmt}
                    onChangeText={(v) => setQrAmt(v.replace(/[^0-9.]/g, ''))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.smallInput}
                  />
                </View>
              </View>
            )}
          </View>

          {err && <Text style={styles.err} testID="bill-error">{err}</Text>}
        </ScrollView>

        {/* Sticky footer */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 6, 16) }]}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLabel}>Total {tip > 0 ? '(incl. tip)' : ''}</Text>
            <Text style={styles.footerTotal} testID="bill-total">{fmtINR(total)}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 2, flexWrap: 'wrap' }}>
              {discount > 0 && <Text style={styles.footerHint}>Saved {fmtINR(discount)}</Text>}
              {taxTotal > 0 && <Text style={styles.footerHint}>Tax {fmtINR(taxTotal)}</Text>}
              {tip > 0 && <Text style={[styles.footerHint, { color: colors.brandPrimary }]}>Tip {fmtINR(tip)}</Text>}
            </View>
          </View>
          <Pressable
            testID="process-payment-btn"
            onPress={onSubmit}
            disabled={saving || items.length === 0}
            style={({ pressed }) => [styles.cta, (saving || items.length === 0) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.ctaText}>Process</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Picker Modal */}
      <Modal visible={!!pickerFor} animationType="slide" transparent onRequestClose={() => setPickerFor(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerFor(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {pickerFor?.type === 'service' ? 'Select Service'
                : pickerFor?.type === 'tip-beautician' ? 'Beautician receiving Tip'
                : 'Select Beautician'}
            </Text>
            <TextInput
              testID="picker-search"
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder="Search..."
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.modalSearch}
            />
            <ScrollView style={{ maxHeight: 400 }}>
              {pickerData.length === 0 && <Text style={styles.emptyText}>Nothing found</Text>}
              {pickerData.map((opt: any) => (
                <TouchableOpacity
                  key={opt.id}
                  testID={`picker-item-${opt.id}`}
                  style={styles.pickerRow}
                  onPress={() => {
                    if (!pickerFor) return;
                    if (pickerFor.type === 'service' && 'index' in pickerFor) {
                      updateItem(pickerFor.index, {
                        service_id: opt.id, service_name: opt.name,
                        price: opt.price,
                        tax_percentage: opt.tax_percentage || 0,
                      });
                    } else if (pickerFor.type === 'beautician' && 'index' in pickerFor) {
                      updateItem(pickerFor.index, { beautician_id: opt.id, beautician_name: opt.name });
                    } else if (pickerFor.type === 'tip-beautician') {
                      setTipBeauticianId(opt.id); setTipBeauticianName(opt.name);
                    }
                    Haptics.selectionAsync();
                    setPickerFor(null);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerName}>{opt.name}</Text>
                    <Text style={styles.pickerSub}>{pickerFor?.type === 'service' ? opt.category : opt.role}</Text>
                  </View>
                  {pickerFor?.type === 'service' && (
                    <Text style={styles.pickerPrice}>{fmtINR(opt.price)}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },

  card: { backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.onSurface },

  input: {
    backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12,
    borderRadius: radius.sm, fontSize: 14, color: colors.onSurface,
  },

  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.brandTertiary, borderRadius: radius.pill },
  addBtnText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 13 },

  emptyItems: {
    alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.md,
  },
  emptyItemsText: { color: colors.onSurfaceTertiary, fontSize: 13 },

  itemBlock: { backgroundColor: colors.surfaceTertiary, padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemNum: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceTertiary },

  selectField: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 12,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
  },
  selectText: { flex: 1, fontSize: 14, color: colors.onSurface, fontWeight: '500' },
  selectPlaceholder: { color: colors.onSurfaceTertiary, fontWeight: '400' },

  smallField: { backgroundColor: colors.surfaceSecondary, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  smallLabel: { fontSize: 11, color: colors.onSurfaceTertiary, marginBottom: 2 },
  smallInput: { fontSize: 15, color: colors.onSurface, fontWeight: '600', paddingVertical: 4, minHeight: 24 },

  segmentRow: { flexDirection: 'row', gap: spacing.sm },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  segmentActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  segmentText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 13 },
  segmentTextActive: { color: '#fff' },

  err: { color: colors.error, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },

  hintText: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: -6 },
  memberIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  memberBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  memberBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  taxBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: '#EFEDE3', borderWidth: 1, borderColor: colors.borderStrong },
  taxBadgeText: { color: colors.onSurfaceSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  memberDetectBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E9F1E7', borderWidth: 1, borderColor: '#C8DDC4',
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm, marginTop: spacing.sm,
  },
  memberDetectText: { flex: 1, fontSize: 12, color: colors.onSurface, fontWeight: '600' },
  tipViaChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  tipViaChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tipViaText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  tipViaTextActive: { color: '#fff' },
  tipNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#FDF6E7', padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: '#F0DCA6' },
  tipNoteText: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary },
  footerHint: { fontSize: 11, color: colors.success, fontWeight: '600' },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    ...shadows.strong,
  },
  footerLeft: { flex: 1 },
  footerLabel: { fontSize: 12, color: colors.onSurfaceTertiary },
  footerTotal: { fontSize: 26, fontWeight: '800', color: colors.onSurface },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 14,
    borderRadius: radius.md, ...shadows.card,
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end', alignItems: 'center' } as any,
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...(Platform.OS === 'web' ? { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 } : {}),
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: '80%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  } as any,
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  modalSearch: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  pickerName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  pickerSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  pickerPrice: { fontSize: 15, fontWeight: '700', color: colors.brandPrimary },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: 'center', padding: spacing.xl },
});
