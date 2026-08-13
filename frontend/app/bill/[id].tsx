import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Alert,
  Modal, Pressable, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import { sendWhatsAppInvoice, buildWhatsAppInvoiceMessage } from '@/src/utils/whatsappInvoice';

export default function BillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, tenant, branches } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [bill, setBill] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  // Email invoice modal state
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [emailOk, setEmailOk] = useState<string | null>(null);

  // Branch corresponding to this bill (for logo, address, tax overrides)
  const billBranch = bill ? (branches || []).find((b: any) => b.id === bill.branch_id) : null;

  // Compute effective member discount % applied on this bill
  const memberDiscountPct = bill?.member_discount_pct_applied != null
    ? bill.member_discount_pct_applied
    : (tenant?.member_discount_pct ?? 10);

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
      const eff = it.effective_discount_pct ?? it.discount_pct ?? 0;
      const lineTotal = (it.price * (1 - eff / 100)).toFixed(2);
      const discStr = eff > 0 ? `${eff}%${it.member_applied ? ' ★' : ''}` : '0%';
      return `<tr>
        <td>${i + 1}</td>
        <td>${it.service_name}<br/><small style="color:#888">by ${it.beautician_name}</small></td>
        <td style="text-align:right">₹${it.price.toFixed(2)}</td>
        <td style="text-align:right">${discStr}</td>
        <td style="text-align:right"><b>₹${lineTotal}</b></td>
      </tr>`;
    }).join('');

    const dt = new Date(bill.created_at).toLocaleString('en-IN');
    const memberBadge = bill.is_member ? `<div style="display:inline-block;background:#C42032;color:#fff;padding:4px 10px;border-radius:999px;font-weight:700;font-size:11px;margin-left:8px">★ MEMBER · ${memberDiscountPct}% OFF</div>` : '';
    const tipBlock = (bill.tip_amount || 0) > 0 ? `
      <div class="box">
        <h3>Tip</h3>
        <div class="row" style="display:flex;justify-content:space-between">
          <span>Tip to ${bill.tip_beautician_name || 'beautician'} (${(bill.tip_via || '').toUpperCase()})</span>
          <span><b>₹${bill.tip_amount.toFixed(2)}</b></span>
        </div>
      </div>
    ` : '';
    const servicesNet = bill.services_net ?? (bill.grand_total - (bill.tip_amount || 0));

    // Prefer branch-level branding, fall back to tenant
    const bizName = (tenant?.business_name || 'ParlourPilot').toUpperCase();
    const branchName = billBranch?.name || '';
    const logoSrc = billBranch?.logo || tenant?.logo || null;
    const logoHtml = logoSrc
      ? `<img src="${logoSrc}" alt="logo" style="width:64px;height:64px;object-fit:contain;border-radius:8px;background:#fff;padding:4px;border:1px solid #E8E5DA"/>`
      : '';

    const addrLines: string[] = [];
    // Branch address overrides tenant address if any branch address exists
    const branchAddr = billBranch?.address || '';
    const branchCity = [billBranch?.city, (billBranch as any)?.state].filter(Boolean).join(', ');
    if (branchAddr) addrLines.push(branchAddr);
    else if (tenant?.address) addrLines.push(tenant.address);
    if (branchCity) addrLines.push(branchCity);
    else {
      const cityLine = [tenant?.city, tenant?.state].filter(Boolean).join(', ');
      if (cityLine) addrLines.push(cityLine);
    }
    const branchPhone = billBranch?.phone;
    if (branchPhone) addrLines.push(`Ph: ${branchPhone}`);
    else if (tenant?.phone) addrLines.push(`Ph: ${tenant.phone}`);
    const branchEmail = billBranch?.email;
    if (branchEmail) addrLines.push(branchEmail);
    else if (tenant?.email) addrLines.push(tenant.email);

    // Tax settings prefer branch if enabled, else tenant
    const branchTaxEnabled = !!billBranch?.tax_enabled;
    const branchTaxPct = billBranch?.tax_percentage;
    const branchTaxNum = billBranch?.tax_number;
    const useBranchTax = branchTaxEnabled && (branchTaxPct || 0) > 0;
    const useTenantTax = !useBranchTax && tenant?.tax_enabled && (tenant?.tax_percentage || 0) > 0;
    const taxNum = useBranchTax ? branchTaxNum : (useTenantTax ? tenant?.tax_number : '');
    if (taxNum) addrLines.push(`GST/Tax: ${taxNum}`);

    const addrHtml = addrLines.map(l => `<div>${l}</div>`).join('');
    const headerLine = (billBranch?.receipt_header || tenant?.receipt_header) ? `<div class="header-line">${billBranch?.receipt_header || tenant?.receipt_header}</div>` : '';
    const footerText = billBranch?.receipt_footer || tenant?.receipt_footer || 'Thank you! Powered by ParlourPilot';

    // Tax calculation
    let taxAmount = 0;
    let showTax = false;
    let taxPctDisplay = 0;
    if (useBranchTax) {
      taxPctDisplay = branchTaxPct || 0;
      taxAmount = servicesNet * (taxPctDisplay / 100);
      showTax = true;
    } else if (useTenantTax) {
      taxPctDisplay = tenant?.tax_percentage || 0;
      taxAmount = servicesNet * (taxPctDisplay / 100);
      showTax = true;
    }
    const displayGrandTotal = bill.grand_total + (showTax ? taxAmount : 0);

    return `
<html><head><meta charset="utf-8"/>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#1A1A1A}
.brand-row{display:flex;align-items:center;gap:14px;margin-bottom:6px}
.brand{color:#C42032;font-size:24px;font-weight:900;letter-spacing:1px;line-height:1.1}
.branch{color:#3A3937;font-size:13px;font-weight:600;margin-top:2px}
.sub{color:#6B6862;font-size:12px;margin-bottom:8px;letter-spacing:0.5px;line-height:1.6}
.header-line{background:#FDECEE;color:#8A0E1D;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;margin-top:8px;text-align:center}
.box{border:1px solid #E8E5DA;border-radius:12px;padding:14px;margin-top:14px}
h3{margin:0 0 8px 0;font-size:13px;color:#6B6862;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{padding:8px 6px;border-bottom:1px solid #F0EDE3;font-size:13px;text-align:left}
th{background:#FDECEE;color:#8A0E1D;font-size:11px;text-transform:uppercase}
.totals{margin-top:10px;font-size:14px}
.totals .row{display:flex;justify-content:space-between;padding:4px 0}
.grand{font-size:22px;font-weight:900;color:#C42032}
.footer{margin-top:24px;text-align:center;color:#6B6862;font-size:11px}
.pm{display:inline-block;background:#FDECEE;color:#8A0E1D;padding:4px 10px;border-radius:999px;font-weight:700;font-size:12px}
</style></head><body>
<div class="brand-row">
  ${logoHtml}
  <div>
    <div class="brand">${bizName}</div>
    ${branchName ? `<div class="branch">${branchName}</div>` : ''}
  </div>
</div>
<div class="sub">${addrHtml}</div>
${headerLine}

<div class="box">
  <h3>Invoice</h3>
  <div style="display:flex;justify-content:space-between">
    <div><b>Bill #${bill.bill_no}</b>${memberBadge}<br/><small>${dt}</small></div>
    <div style="text-align:right"><b>${bill.customer_name}</b><br/><small>${bill.customer_phone || ''}</small></div>
  </div>
</div>

<div class="box">
  <table>
    <tr><th>#</th><th>Service</th><th style="text-align:right">Price</th><th style="text-align:right">Disc</th><th style="text-align:right">Total</th></tr>
    ${rows}
  </table>
</div>

${tipBlock}

<div class="box">
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>₹${bill.subtotal.toFixed(2)}</span></div>
    <div class="row"><span>Discount</span><span>- ₹${bill.discount.toFixed(2)}</span></div>
    <div class="row"><span>Services Net</span><span>₹${servicesNet.toFixed(2)}</span></div>
    ${showTax ? `<div class="row"><span>Tax (${taxPctDisplay}%)</span><span>+ ₹${taxAmount.toFixed(2)}</span></div>` : ''}
    ${(bill.tip_amount || 0) > 0 ? `<div class="row"><span>Tip</span><span>+ ₹${bill.tip_amount.toFixed(2)}</span></div>` : ''}
    <div class="row"><span><b>Grand Total</b></span><span class="grand">₹${displayGrandTotal.toFixed(2)}</span></div>
  </div>
  <div style="margin-top:12px">
    <span class="pm">${bill.payment_mode.toUpperCase()}</span>
    ${bill.payment_mode === 'split' ? `<div style="margin-top:6px;font-size:12px">Cash: ₹${bill.cash_amount.toFixed(2)} · QR: ₹${bill.qr_amount.toFixed(2)}</div>` : ''}
  </div>
</div>

<div class="footer">${footerText}</div>
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
        <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.iconBtn} testID="bill-home">
          <Ionicons name="home-outline" size={20} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Bill #{bill.bill_no}</Text>
          <Text style={styles.headerSub}>
            {new Date(bill.created_at).toLocaleString('en-IN')}
            {bill.edited_at ? ` · edited ${new Date(bill.edited_at).toLocaleDateString('en-IN')}` : ''}
          </Text>
        </View>
        {isAdmin && (
          <TouchableOpacity
            testID="edit-bill-btn"
            onPress={() => router.push(`/(tabs)/new-bill?edit=${bill.id}` as any)}
            style={styles.editBtn}
          >
            <Ionicons name="pencil" size={16} color={colors.brandPrimary} />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        )}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.cardTitle}>Services ({bill.items.length})</Text>
            {bill.is_member && (
              <View style={styles.memberBadge}>
                <Ionicons name="star" size={10} color="#fff" />
                <Text style={styles.memberBadgeText}>MEMBER · {memberDiscountPct}% off</Text>
              </View>
            )}
          </View>
          {bill.items.map((it: any, i: number) => {
            const eff = it.effective_discount_pct ?? it.discount_pct ?? 0;
            const lineTotal = it.price * (1 - eff / 100);
            return (
              <View key={i} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.service_name}</Text>
                  <Text style={styles.itemBy}>by {it.beautician_name}</Text>
                  {eff > 0 && (
                    <Text style={styles.itemDisc}>
                      -{eff}% off · {fmtINR(it.price)}
                      {it.member_applied ? ' · Member' : ''}
                    </Text>
                  )}
                </View>
                <Text style={styles.itemAmt}>{fmtINR(lineTotal)}</Text>
              </View>
            );
          })}
        </View>

        {/* Tip */}
        {(bill.tip_amount || 0) > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tip</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={styles.tipIcon}>
                <Ionicons name="heart" size={18} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{bill.tip_beautician_name || 'Beautician'}</Text>
                <Text style={styles.itemBy}>Paid via {String(bill.tip_via || '').toUpperCase()}</Text>
                {bill.tip_via === 'qr' && (
                  <Text style={[styles.itemDisc, { color: colors.warning }]}>
                    Give {fmtINR(bill.tip_amount)} cash from counter
                  </Text>
                )}
              </View>
              <Text style={styles.itemAmt}>{fmtINR(bill.tip_amount)}</Text>
            </View>
          </View>
        )}

        {/* Totals */}
        <View style={styles.card}>
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalVal}>{fmtINR(bill.subtotal)}</Text></View>
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Discount</Text><Text style={[styles.totalVal, { color: colors.success }]}>- {fmtINR(bill.discount)}</Text></View>
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Services Net</Text><Text style={styles.totalVal}>{fmtINR(bill.services_net ?? (bill.grand_total - (bill.tip_amount || 0)))}</Text></View>
          {(bill.tip_amount || 0) > 0 && (
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Tip</Text><Text style={[styles.totalVal, { color: colors.brandPrimary }]}>+ {fmtINR(bill.tip_amount)}</Text></View>
          )}
          <View style={[styles.totalRow, { marginTop: 6, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider }]}>
            <Text style={styles.grandLabel}>Grand Total</Text>
            <Text style={styles.grandVal}>{fmtINR(bill.grand_total)}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Sticky footer with actions */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 6, 16) }]}>
        <TouchableOpacity testID="new-bill-again" style={styles.footerIcon} onPress={() => router.replace('/(tabs)/new-bill' as any)}>
          <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.footerIconText}>New</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="email-bill-btn" style={styles.footerIcon} onPress={() => { setEmailTo(bill?.customer_email || bill?.customer_phone_email || ''); setEmailErr(null); setEmailOk(null); setEmailOpen(true); }}>
          <Ionicons name="mail-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.footerIconText}>Email</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="whatsapp-bill-btn"
          style={[styles.footerIcon, styles.footerIconWA]}
          onPress={() => {
            const items = (bill?.items || []).map((it: any) => ({
              name: it.service_name || 'Service',
              qty: it.qty || 1,
              price: Number(it.total ?? it.price ?? 0),
            }));
            const dt = new Date(bill?.created_at || Date.now()).toLocaleString(undefined, {
              day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            });
            const paymentMode = bill?.payment_mode
              ? (bill.payment_mode === 'qr' ? 'UPI' : bill.payment_mode.charAt(0).toUpperCase() + bill.payment_mode.slice(1))
              : ((bill?.cash_amount > 0 && bill?.qr_amount > 0) ? 'Cash + UPI'
                : bill?.cash_amount > 0 ? 'Cash'
                : bill?.qr_amount > 0 ? 'UPI' : null);
            const msg = buildWhatsAppInvoiceMessage({
              businessName: tenant?.business_name,
              billNo: bill?.bill_no,
              dateStr: dt,
              customerName: bill?.customer_name,
              items,
              subtotal: bill?.subtotal ?? bill?.services_net,
              discount: bill?.discount ?? bill?.discount_amount,
              tax: bill?.tax_amount,
              tip: bill?.tip_amount,
              grandTotal: bill?.grand_total || 0,
              paymentMode,
            });
            sendWhatsAppInvoice({ phone: bill?.customer_phone, message: msg });
          }}
        >
          <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
          <Text style={[styles.footerIconText, { color: '#128C7E' }]}>WhatsApp</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="share-bill-btn" style={styles.footerPrimary} onPress={share} disabled={sharing}>
          {sharing ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="share-social-outline" size={18} color="#fff" />
              <Text style={styles.footerPrimaryText}>Share</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Email invoice modal */}
      <Modal visible={emailOpen} transparent animationType="slide" onRequestClose={() => !emailBusy && setEmailOpen(false)}>
        <Pressable style={styles.emailBackdrop} onPress={() => !emailBusy && setEmailOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.emailSheet} onPress={() => {}}>
              <View style={styles.emailHandle} />
              <Text style={styles.emailTitle}>Email Invoice</Text>
              <Text style={styles.emailHint}>Send a copy of Bill #{bill?.bill_no} to your customer&rsquo;s email.</Text>

              <TextInput
                testID="email-invoice-input"
                value={emailTo}
                onChangeText={setEmailTo}
                placeholder="customer@example.com"
                placeholderTextColor={colors.onSurfaceTertiary}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                editable={!emailBusy}
                style={styles.emailInput}
              />
              {emailErr && <Text style={styles.emailErr}>{emailErr}</Text>}
              {emailOk && <Text style={styles.emailOk}>{emailOk}</Text>}

              <View style={styles.emailActions}>
                <TouchableOpacity style={styles.emailBtnGhost} onPress={() => setEmailOpen(false)} disabled={emailBusy}>
                  <Text style={styles.emailBtnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="email-invoice-send"
                  style={styles.emailBtnPrimary}
                  disabled={emailBusy}
                  onPress={async () => {
                    setEmailErr(null); setEmailOk(null);
                    const to = emailTo.trim().toLowerCase();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setEmailErr('Enter a valid email address'); return; }
                    setEmailBusy(true);
                    try {
                      const res: any = await api(`/bills/${bill.id}/email`, {
                        method: 'POST',
                        body: { email: to, customer_name: bill?.customer_name || undefined },
                      });
                      if (res?.ok) {
                        setEmailOk(`Sent! (via ${res.provider || 'email'})`);
                        setTimeout(() => setEmailOpen(false), 1200);
                      } else {
                        setEmailErr(res?.error || 'Delivery failed. Please try again.');
                      }
                    } catch (e: any) {
                      setEmailErr(e?.message || 'Delivery failed.');
                    } finally { setEmailBusy(false); }
                  }}
                >
                  {emailBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.emailBtnPrimaryText}>Send Invoice</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
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

  memberBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  memberBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  tipIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 13, color: colors.onSurfaceSecondary },
  totalVal: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  grandLabel: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  grandVal: { fontSize: 22, fontWeight: '800', color: colors.brandPrimary },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.lg,
    flexDirection: 'row', gap: spacing.md, ...shadows.strong,
  },
  footerSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary,
  },
  footerSecondaryText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 14 },
  footerIcon: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3,
    paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary,
    minWidth: 62,
  },
  footerIconText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 11 },
  footerIconWA: { borderColor: '#25D366', backgroundColor: '#F0FFF4' },
  footerPrimary: {
    flex: 1.1, alignItems: 'center', justifyContent: 'center', gap: 3, flexDirection: 'row',
    paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.brandPrimary, ...shadows.card,
    minWidth: 76,
  },
  footerPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  // Email invoice modal
  emailBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end', alignItems: 'center' } as any,
  emailSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    ...(Platform.OS === 'web' ? { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 } : {}),
    padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 480, alignSelf: 'center',
  } as any,
  emailHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  emailTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  emailHint: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },
  emailInput: {
    backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 14,
    borderRadius: radius.sm, fontSize: 15, color: colors.onSurface,
  },
  emailErr: { color: colors.error, fontSize: 13, textAlign: 'center' },
  emailOk: { color: colors.success, fontSize: 13, textAlign: 'center', fontWeight: '700' },
  emailActions: { flexDirection: 'row', gap: spacing.sm },
  emailBtnGhost: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  emailBtnGhostText: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  emailBtnPrimary: { flex: 1.4, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center' },
  emailBtnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
