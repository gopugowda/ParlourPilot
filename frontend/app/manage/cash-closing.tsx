import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Share, Modal, Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Calendar } from 'react-native-calendars';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

function formatPrettyDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

export default function CashClosingScreen() {
  const router = useRouter();
  const { user, tenant } = useAuth();
  const insets = useSafeAreaInsets();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
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
    setLoading(true);
    try {
      const [s, h]: any = await Promise.all([
        api(`/cash-closing/summary?date=${selectedDate}`),
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
        setSavedDoc(null);
        setOpening(String(s.suggested_opening || 0));
        setCashExpenses(String(s.total_expenses || 0));
        setActualClosing('');
        setNotes('');
      }
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [selectedDate]);

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
          date: selectedDate,
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
Date: ${selectedDate}
Submitted by: ${user?.name}

*Business*
Total Revenue: ${fmtINR(summary.total_revenue)}
Cash Sales: ${fmtINR(summary.cash_sales)}
QR / Online Sales: ${fmtINR(summary.upi_sales)}
Tips: ${fmtINR(summary.tips)}
Bills: ${summary.bills_count}

*Cash Counter*
Opening Balance: ${fmtINR(openingN)}
+ Cash Sales: ${fmtINR(cashSales)}
- Cash Expenses: ${fmtINR(cashExpN)}
Expected in drawer: ${fmtINR(expected)}
Actual cash counted: ${fmtINR(actualN)}
${diff === 0 ? 'BALANCED ✓' : diff > 0 ? `Variance: +${fmtINR(diff)} (excess)` : `Variance: ${fmtINR(diff)} (short)`}

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
          <Text style={styles.headerSub}>End-of-day cash reconciliation.</Text>
        </View>
        <TouchableOpacity
          testID="cc-date-chip"
          onPress={() => { Haptics.selectionAsync(); setDatePickerOpen(true); }}
          style={styles.dateChip}
        >
          <Ionicons name="calendar-outline" size={14} color={colors.brandPrimary} />
          <Text style={styles.dateChipText}>{formatPrettyDate(selectedDate)}</Text>
        </TouchableOpacity>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
          {/* 3-tile row: Cash sales / QR sales / Total sales (highlighted) — matches web */}
          <View style={styles.tilesRow}>
            <View style={styles.tile} testID="tile-cash">
              <Text style={styles.tileLabel}>Cash sales</Text>
              <Text style={styles.tileValue}>{fmtINR(cashSales)}</Text>
            </View>
            <View style={styles.tile} testID="tile-qr">
              <Text style={styles.tileLabel}>QR sales</Text>
              <Text style={styles.tileValue}>{fmtINR(summary?.upi_sales || 0)}</Text>
            </View>
            <View style={[styles.tile, styles.tileHighlight]} testID="tile-total">
              <Text style={[styles.tileLabel, { color: '#FDF3E1' }]}>Total sales</Text>
              <Text style={[styles.tileValue, { color: '#fff' }]}>{fmtINR(summary?.total_revenue || 0)}</Text>
            </View>
          </View>

          {/* Secondary line: tips + bills (mobile-only convenience) */}
          <View style={styles.secondaryLine} testID="secondary-line">
            <Text style={styles.secondaryText}>
              Tips {fmtINR(summary?.tips || 0)}  ·  {summary?.bills_count || 0} bills
            </Text>
          </View>

          {/* Web-parity input grid: 2-col rows */}
          <View style={styles.card}>
            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>Opening balance</Text>
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
              <View style={styles.gridField}>
                <Text style={styles.label}>Cash expenses</Text>
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
            </View>

            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>Actual cash counted</Text>
                <TextInput
                  testID="actual-input"
                  value={actualClosing}
                  onChangeText={(v) => setActualClosing(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>Notes</Text>
                <TextInput
                  testID="notes-input"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Optional"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>
            </View>

            {/* Formula card (mobile-only convenience) */}
            <View style={styles.formula}>
              <View style={styles.formulaRow}><Text style={styles.formulaLabel}>Opening</Text><Text style={styles.formulaVal}>{fmtINR(openingN)}</Text></View>
              <View style={styles.formulaRow}><Text style={styles.formulaLabel}>+ Cash Sales</Text><Text style={[styles.formulaVal, { color: colors.success }]}>+ {fmtINR(cashSales)}</Text></View>
              <View style={styles.formulaRow}><Text style={styles.formulaLabel}>− Cash Expenses</Text><Text style={[styles.formulaVal, { color: colors.error }]}>− {fmtINR(cashExpN)}</Text></View>
              <View style={[styles.formulaRow, styles.formulaRowGrand]}>
                <Text style={styles.formulaGrandLabel}>Expected in drawer</Text>
                <Text style={styles.formulaGrandVal} testID="expected-closing">{fmtINR(expected)}</Text>
              </View>
            </View>
          </View>

          {/* History */}
          {history.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent closings</Text>
              {history.map(h => (
                <TouchableOpacity
                  key={h.id}
                  style={styles.histRow}
                  testID={`hist-${h.date}`}
                  onPress={() => { Haptics.selectionAsync(); setSelectedDate(h.date); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histDate}>{formatPrettyDate(h.date)}</Text>
                    <Text style={styles.histMeta}>Rev {fmtINR(h.total_revenue)} · by {h.submitted_by_name}</Text>
                  </View>
                  <View style={[styles.diffPill, h.difference === 0 ? { backgroundColor: '#E9F1E7' } : h.difference > 0 ? { backgroundColor: '#FDF3E4' } : { backgroundColor: '#FDE7E7' }]}>
                    <Text style={[styles.diffPillText, { color: h.difference === 0 ? colors.success : h.difference > 0 ? colors.warning : colors.error }]}>
                      {h.difference === 0 ? 'Balanced' : (h.difference > 0 ? '+' : '') + fmtINR(h.difference)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Sticky footer — Expected + Variance + Close day (web parity) */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 6, 16) }]}>
          <View style={styles.footerStats}>
            <View style={styles.footerStat}>
              <Text style={styles.footerStatLabel}>Expected in drawer</Text>
              <Text style={styles.footerStatValue}>{fmtINR(expected)}</Text>
            </View>
            <View style={styles.footerStat}>
              <Text style={styles.footerStatLabel}>
                Variance <Text style={{ color: diff === 0 ? colors.success : diff > 0 ? colors.warning : colors.error, fontWeight: '800' }}>
                  {diff === 0 ? '(Balanced)' : diff > 0 ? '(Excess)' : '(Short)'}
                </Text>
              </Text>
              <Text style={[styles.footerStatValue, { color: diff === 0 ? colors.onSurface : diff > 0 ? colors.warning : colors.error }]}>
                {diff === 0 ? '₹0' : (diff > 0 ? '+' : '') + fmtINR(diff)}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity
              testID="share-report-btn"
              onPress={shareReport}
              style={styles.footerSecondary}
            >
              <Ionicons name="logo-whatsapp" size={18} color={colors.brandPrimary} />
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
                  <Ionicons name={savedDoc ? 'checkmark-circle-outline' : 'lock-closed-outline'} size={18} color="#fff" />
                  <Text style={styles.footerPrimaryText}>{savedDoc ? 'Update' : 'Close day'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Date picker modal */}
      <Modal visible={datePickerOpen} transparent animationType="fade" onRequestClose={() => setDatePickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDatePickerOpen(false)}>
          <Pressable style={styles.datePickerSheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Pick a date</Text>
            <Calendar
              testID="cc-calendar"
              current={selectedDate}
              maxDate={todayIso}
              onDayPress={(d) => {
                Haptics.selectionAsync();
                setSelectedDate(d.dateString);
                setDatePickerOpen(false);
              }}
              markedDates={{ [selectedDate]: { selected: true, selectedColor: colors.brandPrimary } }}
              theme={{
                backgroundColor: colors.surface,
                calendarBackground: colors.surface,
                selectedDayBackgroundColor: colors.brandPrimary,
                selectedDayTextColor: '#fff',
                todayTextColor: colors.brandPrimary,
                dayTextColor: colors.onSurface,
                monthTextColor: colors.onSurface,
                arrowColor: colors.brandPrimary,
              }}
            />
            <TouchableOpacity style={styles.datePickerClose} onPress={() => setDatePickerOpen(false)}>
              <Text style={styles.datePickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  dateChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill, ...shadows.sm },
  dateChipText: { fontSize: 12, fontWeight: '700', color: colors.onSurface },

  tilesRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  tileHighlight: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary, ...shadows.card },
  tileLabel: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  tileValue: { fontSize: 18, fontWeight: '800', color: colors.onSurface, marginTop: 4 },

  secondaryLine: { alignItems: 'center', paddingVertical: 6, marginBottom: spacing.md },
  secondaryText: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '600' },

  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, gap: spacing.md, ...shadows.card },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface, textTransform: 'uppercase', letterSpacing: 0.5 },
  gridRow: { flexDirection: 'row', gap: spacing.md },
  gridField: { flex: 1, gap: 6 },
  field: { gap: 4 },
  label: { fontSize: 13, color: colors.onSurface, fontWeight: '700' },
  helpText: { fontSize: 11, color: colors.onSurfaceTertiary },
  input: { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },

  formula: { backgroundColor: colors.brandTertiary, padding: spacing.md, borderRadius: radius.sm, gap: 6, borderWidth: 1, borderColor: colors.brandSecondary, marginTop: 4 },
  formulaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  formulaLabel: { fontSize: 13, color: colors.onSurface },
  formulaVal: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  formulaRowGrand: { marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.brandSecondary },
  formulaGrandLabel: { fontSize: 14, fontWeight: '800', color: colors.brandPrimary },
  formulaGrandVal: { fontSize: 18, fontWeight: '900', color: colors.brandPrimary },

  histRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  histDate: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  histMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  diffPill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  diffPillText: { fontSize: 11, fontWeight: '800' },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    gap: spacing.md, ...shadows.strong,
  },
  footerStats: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.brandSecondary },
  footerStat: { flex: 1 },
  footerStatLabel: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  footerStatValue: { fontSize: 18, fontWeight: '900', color: colors.onSurface, marginTop: 2 },

  footerSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary },
  footerSecondaryText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 14 },
  footerPrimary: { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.brandPrimary, ...shadows.card },
  footerPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  datePickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md, marginTop: 'auto', maxWidth: 480, width: '100%', alignSelf: 'center' },
  datePickerClose: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  datePickerCloseText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 14 },
});
