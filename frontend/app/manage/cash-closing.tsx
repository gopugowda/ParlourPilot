import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

export default function CashClosingScreen() {
  const router = useRouter();
  const { user, tenant } = useAuth();
  const insets = useSafeAreaInsets();
  const today = new Date().toISOString().slice(0, 10);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState('');
  const [cashExpenses, setCashExpenses] = useState('');
  const [actualClosing, setActualClosing] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedDoc, setSavedDoc] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const load = async () => {
    try {
      const [s, h]: any = await Promise.all([
        api(`/cash-closing/summary?date=${today}`),
        api('/cash-closing?limit=10'),
      ]);
      setSummary(s);
      setHistory(h || []);
      if (s.existing_closing) {
        setSavedDoc(s.existing_closing);
        setOpening(String(s.existing_closing.opening_balance));
        setCashExpenses(String(s.existing_closing.cash_expenses));
        setActualClosing(String(s.existing_closing.actual_closing));
        setNotes(s.existing_closing.notes || '');
      } else {
        setOpening(String(s.suggested_opening || 0));
        setCashExpenses(String(s.total_expenses || 0));
      }
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openingN = Number(opening) || 0;
  const cashExpN = Number(cashExpenses) || 0;
  const actualN = Number(actualClosing) || 0;
  const cashSales = summary?.cash_sales || 0;
  const expected = openingN + cashSales - cashExpN;
  const diff = actualN - expected;

  const save = async () => {
    setSaving(true);
    try {
      const doc: any = await api('/cash-closing', {
        method: 'POST',
        body: {
          date: today,
          opening_balance: openingN,
          cash_expenses: cashExpN,
          actual_closing: actualN,
          notes,
        },
      });
      setSavedDoc(doc);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch {} finally { setSaving(false); }
  };

  const shareReport = async () => {
    if (!summary) return;
    const salonName = (tenant?.business_name || 'Salon').toUpperCase();
    const msg = `*${salonName} — Daily Closing*
Date: ${today}
Submitted by: ${user?.name}

*Business*
Total Revenue: ${fmtINR(summary.total_revenue)}
Cash Sales: ${fmtINR(summary.cash_sales)}
UPI Sales: ${fmtINR(summary.upi_sales)}
Tips: ${fmtINR(summary.tips)}
Bills: ${summary.bills_count}

*Cash Counter*
Opening Balance: ${fmtINR(openingN)}
+ Cash Sales: ${fmtINR(cashSales)}
- Cash Expenses: ${fmtINR(cashExpN)}
Expected Closing: ${fmtINR(expected)}
Actual Closing: ${fmtINR(actualN)}
${diff === 0 ? 'MATCH ✓' : diff > 0 ? `Excess: +${fmtINR(diff)}` : `Short: ${fmtINR(diff)}`}

*Expenses Today*
Total: ${fmtINR(summary.total_expenses)}
Cash from counter: ${fmtINR(cashExpN)}

${notes ? '\nNotes: ' + notes : ''}`;
    try { await Share.share({ message: msg }); } catch {}
  };

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  return (
    <View style={styles.root} testID="cash-closing-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cash Closing</Text>
          <Text style={styles.headerSub}>{today} · {user?.name}</Text>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
          {/* Auto totals */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Today&apos;s Business</Text>
            <Text style={styles.summaryVal}>{fmtINR(summary?.total_revenue || 0)}</Text>
            <View style={styles.rowStats}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Cash</Text>
                <Text style={styles.statVal}>{fmtINR(cashSales)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>QR / Online</Text>
                <Text style={styles.statVal}>{fmtINR(summary?.upi_sales || 0)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Tips</Text>
                <Text style={styles.statVal}>{fmtINR(summary?.tips || 0)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Bills</Text>
                <Text style={styles.statVal}>{summary?.bills_count || 0}</Text>
              </View>
            </View>
          </View>

          {/* Inputs */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Counter Cash</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Opening Balance (₹)</Text>
              <Text style={styles.helpText}>Cash in counter at start of day (auto-filled from yesterday&apos;s close)</Text>
              <TextInput
                testID="opening-input"
                value={opening}
                onChangeText={(v) => setOpening(v.replace(/[^0-9.]/g, ''))}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Cash Spent Today (₹)</Text>
              <Text style={styles.helpText}>Cash taken from counter for expenses (auto = today&apos;s total expenses)</Text>
              <TextInput
                testID="cash-expenses-input"
                value={cashExpenses}
                onChangeText={(v) => setCashExpenses(v.replace(/[^0-9.]/g, ''))}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
              />
            </View>

            {/* Formula view */}
            <View style={styles.formula}>
              <View style={styles.formulaRow}><Text style={styles.formulaLabel}>Opening</Text><Text style={styles.formulaVal}>{fmtINR(openingN)}</Text></View>
              <View style={styles.formulaRow}><Text style={styles.formulaLabel}>+ Cash Sales</Text><Text style={[styles.formulaVal, { color: colors.success }]}>+ {fmtINR(cashSales)}</Text></View>
              <View style={styles.formulaRow}><Text style={styles.formulaLabel}>− Cash Expenses</Text><Text style={[styles.formulaVal, { color: colors.error }]}>− {fmtINR(cashExpN)}</Text></View>
              <View style={[styles.formulaRow, styles.formulaRowGrand]}>
                <Text style={styles.formulaGrandLabel}>Expected Closing</Text>
                <Text style={styles.formulaGrandVal} testID="expected-closing">{fmtINR(expected)}</Text>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Actual Counter Cash (₹)</Text>
              <Text style={styles.helpText}>Count physical cash in the counter now</Text>
              <TextInput
                testID="actual-input"
                value={actualClosing}
                onChangeText={(v) => setActualClosing(v.replace(/[^0-9.]/g, ''))}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={[styles.input, { fontSize: 20, fontWeight: '800' }]}
              />
            </View>

            {actualN > 0 && (
              <View style={[styles.diffBox, diff === 0 ? styles.diffOk : diff > 0 ? styles.diffExcess : styles.diffShort]}>
                <Ionicons name={diff === 0 ? 'checkmark-circle' : 'alert-circle'} size={22} color={diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.diffTitle, { color: diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error }]}>
                    {diff === 0 ? 'Cash matches' : diff > 0 ? `Excess ${fmtINR(diff)}` : `Short ${fmtINR(Math.abs(diff))}`}
                  </Text>
                  <Text style={styles.diffSub}>
                    Expected {fmtINR(expected)} · Actual {fmtINR(actualN)}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                testID="notes-input"
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. Reason for shortfall"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
                multiline
              />
            </View>
          </View>

          {/* History */}
          {history.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent Closings</Text>
              {history.map(h => (
                <View key={h.id} style={styles.histRow} testID={`hist-${h.date}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histDate}>{h.date}</Text>
                    <Text style={styles.histMeta}>Rev {fmtINR(h.total_revenue)} · by {h.submitted_by_name}</Text>
                  </View>
                  <View style={[styles.diffPill, h.difference === 0 ? { backgroundColor: '#E9F1E7' } : h.difference > 0 ? { backgroundColor: '#FDF3E4' } : { backgroundColor: '#FDE7E7' }]}>
                    <Text style={[styles.diffPillText, { color: h.difference === 0 ? colors.success : h.difference > 0 ? colors.warning : colors.error }]}>
                      {h.difference === 0 ? 'OK' : (h.difference > 0 ? '+' : '') + fmtINR(h.difference)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Sticky footer */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 6, 16) }]}>
          <TouchableOpacity
            testID="share-report-btn"
            onPress={shareReport}
            style={styles.footerSecondary}
          >
            <Ionicons name="logo-whatsapp" size={20} color={colors.brandPrimary} />
            <Text style={styles.footerSecondaryText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="save-closing-btn"
            onPress={save}
            disabled={saving}
            style={[styles.footerPrimary, saving && { opacity: 0.6 }]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name={savedDoc ? 'checkmark-circle-outline' : 'save-outline'} size={20} color="#fff" />
                <Text style={styles.footerPrimaryText}>{savedDoc ? 'Update Closing' : 'Save Closing'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  summaryCard: { backgroundColor: colors.surfaceInverse, padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.md, ...shadows.strong },
  summaryLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 12, letterSpacing: 0.5, fontWeight: '700' },
  summaryVal: { color: colors.brandSecondary, fontSize: 30, fontWeight: '900', marginTop: 4 },
  rowStats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  statBox: { flex: 1, backgroundColor: 'rgba(228,192,112,0.12)', padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(228,192,112,0.3)' },
  statLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '700' },
  statVal: { color: '#fff', fontSize: 13, fontWeight: '800', marginTop: 2 },

  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, gap: spacing.md, ...shadows.card },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface, textTransform: 'uppercase', letterSpacing: 0.5 },
  field: { gap: 4 },
  label: { fontSize: 13, color: colors.onSurface, fontWeight: '700' },
  helpText: { fontSize: 11, color: colors.onSurfaceTertiary },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface, marginTop: 4 },

  formula: { backgroundColor: colors.brandTertiary, padding: spacing.md, borderRadius: radius.sm, gap: 6, borderWidth: 1, borderColor: colors.brandSecondary },
  formulaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  formulaLabel: { fontSize: 13, color: colors.onSurface },
  formulaVal: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  formulaRowGrand: { marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.brandSecondary },
  formulaGrandLabel: { fontSize: 14, fontWeight: '800', color: colors.brandPrimary },
  formulaGrandVal: { fontSize: 18, fontWeight: '900', color: colors.brandPrimary },

  diffBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1 },
  diffOk: { backgroundColor: '#E9F1E7', borderColor: '#C8DDC4' },
  diffExcess: { backgroundColor: '#FDF3E4', borderColor: '#F0DCA6' },
  diffShort: { backgroundColor: '#FDE7E7', borderColor: '#F2B5B5' },
  diffTitle: { fontSize: 14, fontWeight: '800' },
  diffSub: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2 },

  histRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  histDate: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  histMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  diffPill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  diffPillText: { fontSize: 11, fontWeight: '800' },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.lg,
    flexDirection: 'row', gap: spacing.md, ...shadows.strong,
  },
  footerSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary },
  footerSecondaryText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 14 },
  footerPrimary: { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandPrimary, ...shadows.card },
  footerPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
