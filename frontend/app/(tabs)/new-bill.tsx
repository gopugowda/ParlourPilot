import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal,
  ActivityIndicator, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

type Service = { id: string; name: string; price: number; category: string };
type Beautician = { id: string; name: string; role: string };
type Item = {
  service_id?: string; service_name: string; price: number;
  discount_pct: number; beautician_id?: string; beautician_name: string;
};

export default function NewBillScreen() {
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [beauticians, setBeauticians] = useState<Beautician[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'qr' | 'split'>('cash');
  const [cashAmt, setCashAmt] = useState('');
  const [qrAmt, setQrAmt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Picker modals
  const [pickerFor, setPickerFor] = useState<{ index: number; type: 'service' | 'beautician' } | null>(null);
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

  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const discount = items.reduce((s, it) => s + (Number(it.price) || 0) * ((Number(it.discount_pct) || 0) / 100), 0);
  const total = Math.max(0, subtotal - discount);

  const resetForm = () => {
    setItems([]); setCustomerName(''); setCustomerPhone('');
    setPaymentMode('cash'); setCashAmt(''); setQrAmt('');
  };

  const onSubmit = async () => {
    setErr(null);
    if (items.length === 0) { setErr('Add at least one service'); return; }
    for (const it of items) {
      if (!it.service_name) { setErr('Select service for all rows'); return; }
      if (!it.beautician_name) { setErr('Assign beautician for all rows'); return; }
      if (!(Number(it.price) > 0)) { setErr('Price must be > 0'); return; }
    }
    let cash = 0, qr = 0;
    if (paymentMode === 'cash') cash = total;
    else if (paymentMode === 'qr') qr = total;
    else {
      cash = Number(cashAmt) || 0; qr = Number(qrAmt) || 0;
      if (Math.abs(cash + qr - total) > 0.01) { setErr(`Split must total ${fmtINR(total)}`); return; }
    }
    setSaving(true);
    try {
      const bill: any = await api('/bills', {
        method: 'POST',
        body: {
          customer_name: customerName || 'Walk-in',
          customer_phone: customerPhone,
          items: items.map(it => ({
            service_id: it.service_id, service_name: it.service_name,
            price: Number(it.price), discount_pct: Number(it.discount_pct) || 0,
            beautician_id: it.beautician_id, beautician_name: it.beautician_name,
          })),
          payment_mode: paymentMode,
          cash_amount: cash, qr_amount: qr,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      resetForm();
      router.push(`/bill/${bill.id}` as any);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message || 'Failed to save bill');
    } finally {
      setSaving(false);
    }
  };

  const pickerData = pickerFor?.type === 'service'
    ? services.filter(s => s.name.toLowerCase().includes(pickerSearch.toLowerCase()))
    : beauticians.filter(b => b.name.toLowerCase().includes(pickerSearch.toLowerCase()));

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
              const lineTotal = (Number(it.price) || 0) * (1 - (Number(it.discount_pct) || 0) / 100);
              return (
                <View key={i} style={styles.itemBlock} testID={`item-row-${i}`}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemNum}>#{i + 1}</Text>
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
                </View>
              );
            })}
          </View>

          {/* Payment */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Payment Mode</Text>
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
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLabel}>Total</Text>
            <Text style={styles.footerTotal} testID="bill-total">{fmtINR(total)}</Text>
            {discount > 0 && <Text style={styles.footerDisc}>Saved {fmtINR(discount)}</Text>}
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
              {pickerFor?.type === 'service' ? 'Select Service' : 'Select Beautician'}
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
                    if (pickerFor.type === 'service') {
                      updateItem(pickerFor.index, { service_id: opt.id, service_name: opt.name, price: opt.price });
                    } else {
                      updateItem(pickerFor.index, { beautician_id: opt.id, beautician_name: opt.name });
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

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl + 8 : spacing.lg,
    ...shadows.strong,
  },
  footerLeft: { flex: 1 },
  footerLabel: { fontSize: 12, color: colors.onSurfaceTertiary },
  footerTotal: { fontSize: 26, fontWeight: '800', color: colors.onSurface },
  footerDisc: { fontSize: 11, color: colors.success, marginTop: 2 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 14,
    borderRadius: radius.md, ...shadows.card,
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md, maxHeight: '80%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  modalSearch: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  pickerName: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  pickerSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  pickerPrice: { fontSize: 15, fontWeight: '700', color: colors.brandPrimary },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: 'center', padding: spacing.xl },
});
