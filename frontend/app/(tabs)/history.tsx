import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import { sendWhatsAppInvoice, buildWhatsAppInvoiceMessage } from '@/src/utils/whatsappInvoice';

type Bill = {
  id: string; bill_no: string; customer_name: string; customer_phone?: string; grand_total: number;
  payment_mode: string; items: any[]; created_at: string;
  services_net?: number; discount_amount?: number; tax_amount?: number; tip_amount?: number;
  cash_amount?: number; qr_amount?: number;
};

const chips = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'today', label: 'Today', icon: 'today-outline' },
  { key: 'cash', label: 'Cash', icon: 'cash-outline' },
  { key: 'qr', label: 'QR', icon: 'qr-code-outline' },
  { key: 'split', label: 'Split', icon: 'git-branch-outline' },
];

export default function HistoryScreen() {
  const router = useRouter();
  const { user, tenant } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState(isAdmin ? 'all' : 'today');
  const [search, setSearch] = useState('');

  const shareOnWhatsApp = (b: Bill) => {
    const items = (b.items || []).map((it: any) => ({
      name: it.service_name || 'Service',
      qty: it.qty || 1,
      price: Number(it.total ?? it.price ?? 0),
    }));
    const dt = new Date(b.created_at).toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const paymentMode = b.payment_mode
      ? (b.payment_mode === 'qr' ? 'UPI' : b.payment_mode.charAt(0).toUpperCase() + b.payment_mode.slice(1))
      : (((b.cash_amount || 0) > 0 && (b.qr_amount || 0) > 0) ? 'Cash + UPI'
        : (b.cash_amount || 0) > 0 ? 'Cash'
        : (b.qr_amount || 0) > 0 ? 'UPI' : null);
    const msg = buildWhatsAppInvoiceMessage({
      businessName: tenant?.business_name,
      billNo: b.bill_no,
      dateStr: dt,
      customerName: b.customer_name,
      items,
      subtotal: (b as any).subtotal ?? b.services_net,
      discount: (b as any).discount ?? b.discount_amount,
      tax: b.tax_amount,
      tip: b.tip_amount,
      grandTotal: b.grand_total || 0,
      paymentMode,
    });
    Haptics.selectionAsync();
    sendWhatsAppInvoice({ phone: b.customer_phone, message: msg });
  };

  const load = async () => {
    try {
      const params: string[] = [];
      if (filter === 'today') {
        const today = new Date().toISOString().slice(0, 10);
        params.push(`date=${today}`);
      } else if (['cash', 'qr', 'split'].includes(filter)) {
        params.push(`payment_mode=${filter}`);
      }
      const q = params.length ? `?${params.join('&')}` : '';
      const data = await api<Bill[]>(`/bills${q}`);
      setBills(data || []);
    } catch {}
  };

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [filter]);
  useFocusEffect(useCallback(() => { load(); }, [filter]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = bills.filter(b => {
    const s = search.toLowerCase();
    if (!s) return true;
    return (b.bill_no.toLowerCase().includes(s)
      || (b.customer_name || '').toLowerCase().includes(s));
  });

  const totalShown = filtered.reduce((s, b) => s + b.grand_total, 0);

  return (
    <View style={styles.root} testID="history-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.headerTitle}>{isAdmin ? 'Bill History' : "Today's Bills"}</Text>
            <Text style={styles.headerSub}>{filtered.length} bills · {fmtINR(totalShown)}</Text>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="history-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search by bill # or customer"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.searchInput}
          />
        </View>

        {isAdmin && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map(c => {
            const active = filter === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                testID={`chip-${c.key}`}
                onPress={() => { Haptics.selectionAsync(); setFilter(c.key); }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Ionicons name={c.icon as any} size={13} color={active ? '#fff' : colors.onSurfaceSecondary} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        )}
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={56} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>No bills yet</Text>
            <Text style={styles.emptySub}>Create your first bill from the New Bill tab</Text>
          </View>
        ) : (
          filtered.map(b => (
            <TouchableOpacity
              key={b.id}
              testID={`bill-card-${b.id}`}
              style={styles.billCard}
              onPress={() => router.push(`/bill/${b.id}` as any)}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.billNo}>#{b.bill_no}</Text>
                  <View style={[styles.pmBadge, b.payment_mode === 'cash' ? styles.pmCash : b.payment_mode === 'qr' ? styles.pmQr : styles.pmSplit]}>
                    <Text style={styles.pmBadgeText}>{b.payment_mode.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.billCustomer}>{b.customer_name || 'Walk-in'}</Text>
                <Text style={styles.billMeta}>{b.items.length} services · {new Date(b.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.billTotal}>{fmtINR(b.grand_total)}</Text>
                <View style={styles.billActions}>
                  <TouchableOpacity
                    testID={`wa-btn-${b.id}`}
                    onPress={(e) => { e.stopPropagation?.(); shareOnWhatsApp(b); }}
                    style={styles.waBtn}
                    hitSlop={6}
                    accessibilityLabel="Send invoice on WhatsApp"
                  >
                    <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                  </TouchableOpacity>
                  <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: spacing.md },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md,
    borderRadius: radius.sm, height: 42, marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },

  chipRow: { gap: spacing.sm, paddingRight: spacing.md },
  chip: {
    flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff' },

  empty: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },

  billCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card,
  },
  billNo: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  billCustomer: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4 },
  billMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  billTotal: { fontSize: 17, fontWeight: '800', color: colors.brandPrimary },
  pmBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  pmBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  pmCash: { backgroundColor: colors.success },
  pmQr: { backgroundColor: colors.info },
  pmSplit: { backgroundColor: colors.warning },
  billActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  waBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#E8F9EF', borderWidth: 1, borderColor: '#B7EAC4',
    alignItems: 'center', justifyContent: 'center',
  },
});
