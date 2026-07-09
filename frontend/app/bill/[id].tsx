import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

export default function BillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [bill, setBill] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const b = await api(`/bills/${id}`);
        setBill(b);
      } catch {} finally { setLoading(false); }
    })();
  }, [id]);

  const buildHtml = () => {
    if (!bill) return '';
    const rows = bill.items.map((it: any, i: number) => {
      const lineTotal = (it.price * (1 - (it.discount_pct || 0) / 100)).toFixed(2);
      return `<tr>
        <td>${i + 1}</td>
        <td>${it.service_name}<br/><small style="color:#888">by ${it.beautician_name}</small></td>
        <td style="text-align:right">₹${it.price.toFixed(2)}</td>
        <td style="text-align:right">${it.discount_pct || 0}%</td>
        <td style="text-align:right"><b>₹${lineTotal}</b></td>
      </tr>`;
    }).join('');

    const dt = new Date(bill.created_at).toLocaleString('en-IN');

    return `
<html><head><meta charset="utf-8"/>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#2C2A29}
.brand{color:#B46A55;font-size:22px;font-weight:800;letter-spacing:1px}
.sub{color:#66625E;font-size:12px;margin-bottom:16px}
.box{border:1px solid #E8E6E1;border-radius:12px;padding:14px;margin-top:14px}
h3{margin:0 0 8px 0;font-size:13px;color:#66625E;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{padding:8px 6px;border-bottom:1px solid #F0EFEB;font-size:13px;text-align:left}
th{background:#F5F4F0;color:#66625E;font-size:11px;text-transform:uppercase}
.totals{margin-top:10px;font-size:14px}
.totals .row{display:flex;justify-content:space-between;padding:4px 0}
.grand{font-size:22px;font-weight:800;color:#B46A55}
.footer{margin-top:24px;text-align:center;color:#66625E;font-size:11px}
.pm{display:inline-block;background:#F9EBE8;color:#B46A55;padding:4px 10px;border-radius:999px;font-weight:700;font-size:12px}
</style></head><body>
<div class="brand">GLOW UP UNISEX SALON</div>
<div class="sub">Sullia · Karnataka</div>

<div class="box">
  <h3>Invoice</h3>
  <div style="display:flex;justify-content:space-between">
    <div><b>Bill #${bill.bill_no}</b><br/><small>${dt}</small></div>
    <div style="text-align:right"><b>${bill.customer_name}</b><br/><small>${bill.customer_phone || ''}</small></div>
  </div>
</div>

<div class="box">
  <table>
    <tr><th>#</th><th>Service</th><th style="text-align:right">Price</th><th style="text-align:right">Disc</th><th style="text-align:right">Total</th></tr>
    ${rows}
  </table>
</div>

<div class="box">
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>₹${bill.subtotal.toFixed(2)}</span></div>
    <div class="row"><span>Discount</span><span>- ₹${bill.discount.toFixed(2)}</span></div>
    <div class="row"><span><b>Grand Total</b></span><span class="grand">₹${bill.grand_total.toFixed(2)}</span></div>
  </div>
  <div style="margin-top:12px">
    <span class="pm">${bill.payment_mode.toUpperCase()}</span>
    ${bill.payment_mode === 'split' ? `<div style="margin-top:6px;font-size:12px">Cash: ₹${bill.cash_amount.toFixed(2)} · QR: ₹${bill.qr_amount.toFixed(2)}</div>` : ''}
  </div>
</div>

<div class="footer">Thank you for visiting GLOW UP · Please come again!</div>
</body></html>`;
  };

  const share = async () => {
    if (!bill) return;
    setSharing(true);
    try {
      const html = buildHtml();
      const { uri } = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Bill ${bill.bill_no}` });
      } else if (Platform.OS === 'web') {
        window.open(uri, '_blank');
      }
    } catch (e: any) {
      Alert.alert('Share error', e.message || 'Could not share bill');
    } finally { setSharing(false); }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }
  if (!bill) {
    return <View style={styles.center}><Text>Bill not found</Text></View>;
  }

  return (
    <View style={styles.root} testID="bill-detail-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="bill-back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Bill #{bill.bill_no}</Text>
          <Text style={styles.headerSub}>{new Date(bill.created_at).toLocaleString('en-IN')}</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        {/* Success banner */}
        <View style={styles.banner}>
          <Ionicons name="checkmark-circle" size={28} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Payment Received</Text>
            <Text style={styles.bannerSub}>{bill.payment_mode === 'split' ? `Split · Cash ${fmtINR(bill.cash_amount)} + QR ${fmtINR(bill.qr_amount)}` : bill.payment_mode.toUpperCase()}</Text>
          </View>
          <Text style={styles.bannerAmt}>{fmtINR(bill.grand_total)}</Text>
        </View>

        {/* Customer */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer</Text>
          <Text style={styles.rowVal}>{bill.customer_name || 'Walk-in'}</Text>
          {bill.customer_phone ? <Text style={styles.rowMeta}>{bill.customer_phone}</Text> : null}
        </View>

        {/* Items */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Services ({bill.items.length})</Text>
          {bill.items.map((it: any, i: number) => {
            const lineTotal = it.price * (1 - (it.discount_pct || 0) / 100);
            return (
              <View key={i} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.service_name}</Text>
                  <Text style={styles.itemBy}>by {it.beautician_name}</Text>
                  {it.discount_pct > 0 && <Text style={styles.itemDisc}>-{it.discount_pct}% off · {fmtINR(it.price)}</Text>}
                </View>
                <Text style={styles.itemAmt}>{fmtINR(lineTotal)}</Text>
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View style={styles.card}>
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalVal}>{fmtINR(bill.subtotal)}</Text></View>
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Discount</Text><Text style={[styles.totalVal, { color: colors.success }]}>- {fmtINR(bill.discount)}</Text></View>
          <View style={[styles.totalRow, { marginTop: 6, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider }]}>
            <Text style={styles.grandLabel}>Grand Total</Text>
            <Text style={styles.grandVal}>{fmtINR(bill.grand_total)}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Sticky footer with actions */}
      <View style={styles.footer}>
        <TouchableOpacity testID="new-bill-again" style={styles.footerSecondary} onPress={() => router.replace('/(tabs)/new-bill' as any)}>
          <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
          <Text style={styles.footerSecondaryText}>New Bill</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="share-bill-btn" style={styles.footerPrimary} onPress={share} disabled={sharing}>
          {sharing ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="share-social-outline" size={18} color="#fff" />
              <Text style={styles.footerPrimaryText}>Share Bill</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: '#EAF3E8', borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: '#C8DDC4',
  },
  bannerTitle: { fontSize: 15, fontWeight: '700', color: colors.success },
  bannerSub: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  bannerAmt: { fontSize: 20, fontWeight: '800', color: colors.success },

  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.md, ...shadows.card,
  },
  cardTitle: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', marginBottom: spacing.sm, letterSpacing: 0.5 },
  rowVal: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowMeta: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },

  itemRow: { flexDirection: 'row', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  itemName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  itemBy: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  itemDisc: { fontSize: 11, color: colors.warning, marginTop: 2 },
  itemAmt: { fontSize: 15, fontWeight: '700', color: colors.brandPrimary },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 13, color: colors.onSurfaceSecondary },
  totalVal: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  grandLabel: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  grandVal: { fontSize: 22, fontWeight: '800', color: colors.brandPrimary },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.lg, paddingBottom: Platform.OS === 'ios' ? spacing.xl + 8 : spacing.lg,
    flexDirection: 'row', gap: spacing.md, ...shadows.strong,
  },
  footerSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary,
  },
  footerSecondaryText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 14 },
  footerPrimary: {
    flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandPrimary, ...shadows.card,
  },
  footerPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
