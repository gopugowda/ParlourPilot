import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Modal, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Calendar } from 'react-native-calendars';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import { rowsToCsv, shareCsv, sharePdf, printOrShareHtml, buildReportHtml } from '@/src/utils/exportShare';

type Row = { date: string; total: number; count: number; cash: number; qr: number; tips: number; expenses: number; net: number };

const ADMIN_PRESETS = [
  { k: 'today', label: 'Today' },
  { k: 'yesterday', label: 'Yesterday' },
  { k: 'week', label: 'Last 7 Days' },
  { k: 'month', label: 'This Month' },
  { k: 'last_month', label: 'Last Month' },
  { k: 'custom', label: 'Custom' },
];

const STAFF_PRESETS = [
  { k: 'today', label: 'Today' },
  { k: 'yesterday', label: 'Yesterday' },
];

export default function ReportScreen() {
  const router = useRouter();
  const { user, tenant } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const presets = isAdmin ? ADMIN_PRESETS : STAFF_PRESETS;

  const [preset, setPreset] = useState<string>('week');
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [customOpen, setCustomOpen] = useState(false);
  const [pickingField, setPickingField] = useState<'from' | 'to'>('from');
  const [shareOpen, setShareOpen] = useState(false);
  const [data, setData] = useState<{ from: string; to: string; totals: any; rows: Row[] } | null>(null);
  const [genderData, setGenderData] = useState<{ total_revenue: number; top_segment: string | null; segments: { key: string; label: string; revenue: number; count: number; share_pct: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) setPreset('today');
  }, [isAdmin]);

  const load = async () => {
    setLoading(true);
    try {
      const params = preset === 'custom'
        ? `preset=custom&from_date=${fromDate}&to_date=${toDate}`
        : `preset=${preset}`;
      const [res, gender] = await Promise.all([
        api(`/reports/range?${params}`),
        api(`/reports/revenue-by-gender?${params}`).catch(() => null),
      ]);
      setData(res as any);
      setGenderData(gender as any);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [preset, fromDate, toDate]);
  useFocusEffect(useCallback(() => { load(); }, [preset, fromDate, toDate]));

  const maxTotal = Math.max(1, ...(data?.rows || []).map(r => r.total));

  const applyCustom = () => {
    setPreset('custom');
    setCustomOpen(false);
    Haptics.selectionAsync();
  };

  const currentRangeLabel = () => {
    const p = presets.find(x => x.k === preset)?.label || 'Range';
    return data ? `${p} (${data.from} → ${data.to})` : p;
  };

  const buildExport = () => {
    const rows = data?.rows || [];
    const headers = isAdmin
      ? ['Date', 'Bills', 'Cash', 'UPI/QR', 'Total', 'Tips', 'Expenses', 'Net']
      : ['Date', 'Bills', 'Cash', 'UPI/QR', 'Total'];
    const dataRows: (string | number)[][] = rows.map(r => isAdmin
      ? [r.date, r.count, r.cash, r.qr, r.total, r.tips || 0, r.expenses || 0, r.net]
      : [r.date, r.count, r.cash, r.qr, r.total]);
    const t = data?.totals || {};
    const totalRow: (string | number)[] = isAdmin
      ? ['TOTAL', t.count || 0, t.cash || 0, t.qr || 0, t.total || 0, t.tips || 0, t.expenses || 0, t.net || 0]
      : ['TOTAL', t.count || 0, t.cash || 0, t.qr || 0, t.total || 0];
    return { headers, dataRows, totalRow, t };
  };

  const doShareCsv = async () => {
    setShareOpen(false);
    if (!data) return;
    const { headers, dataRows, totalRow } = buildExport();
    const csv = rowsToCsv(headers, [...dataRows, totalRow]);
    const fname = `report_${data.from}_${data.to}.csv`;
    await shareCsv(csv, fname);
  };

  const buildHtml = () => {
    const { headers, dataRows, totalRow, t } = buildExport();
    const summary = isAdmin ? [
      { label: 'Total Revenue', value: `₹${(t.total || 0).toLocaleString('en-IN')}` },
      { label: 'Bills', value: String(t.count || 0) },
      { label: 'Cash', value: `₹${(t.cash || 0).toLocaleString('en-IN')}` },
      { label: 'UPI/QR', value: `₹${(t.qr || 0).toLocaleString('en-IN')}` },
      { label: 'Expenses', value: `₹${(t.expenses || 0).toLocaleString('en-IN')}` },
      { label: 'Net', value: `₹${(t.net || 0).toLocaleString('en-IN')}` },
    ] : [
      { label: 'Total', value: `₹${(t.total || 0).toLocaleString('en-IN')}` },
      { label: 'Bills', value: String(t.count || 0) },
    ];
    return buildReportHtml({
      title: 'Sales Report',
      subtitle: `${data?.from} → ${data?.to}`,
      brand: { name: tenant?.business_name, color: (tenant as any)?.brand_color || '#C42032', logo: (tenant as any)?.logo || null },
      summary,
      columns: headers,
      rows: dataRows,
      totalRow,
    });
  };

  const doSharePdf = async () => {
    setShareOpen(false);
    if (!data) return;
    const html = buildHtml();
    await sharePdf(html, `report_${data.from}_${data.to}.pdf`);
  };

  const doPrint = async () => {
    setShareOpen(false);
    if (!data) return;
    await printOrShareHtml(buildHtml(), `report_${data.from}_${data.to}.pdf`);
  };

  return (
    <View style={styles.root} testID="report-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Report</Text>
          <Text style={styles.headerSub}>{isAdmin ? 'Pick a range' : 'Last 2 days'}</Text>
        </View>
        <TouchableOpacity
          testID="share-report-btn"
          onPress={() => { Haptics.selectionAsync(); setShareOpen(true); }}
          style={styles.shareBtn}
          disabled={!data || (data?.rows?.length || 0) === 0}
        >
          <Ionicons name="share-outline" size={18} color="#fff" />
          <Text style={styles.shareBtnText}>Share</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Preset chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flexGrow: 0 }}>
        {presets.map(p => {
          const active = preset === p.k;
          return (
            <TouchableOpacity
              key={p.k}
              testID={`preset-${p.k}`}
              onPress={() => {
                Haptics.selectionAsync();
                if (p.k === 'custom') { setCustomOpen(true); return; }
                setPreset(p.k);
              }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>
              {data ? `${data.from} → ${data.to}` : ''}
            </Text>
            <Text style={styles.summaryVal}>{fmtINR(data?.totals?.total || 0)}</Text>
            <View style={styles.summaryStats}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Bills</Text>
                <Text style={styles.statVal}>{data?.totals?.count || 0}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Cash</Text>
                <Text style={styles.statVal}>{fmtINR(data?.totals?.cash || 0)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>UPI</Text>
                <Text style={styles.statVal}>{fmtINR(data?.totals?.qr || 0)}</Text>
              </View>
              {isAdmin && (
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Net</Text>
                  <Text style={[styles.statVal, { color: (data?.totals?.net || 0) >= 0 ? '#A8DAA0' : '#FF9999' }]}>
                    {fmtINR(data?.totals?.net || 0)}
                  </Text>
                </View>
              )}
            </View>
            {isAdmin && (data?.totals?.expenses || 0) > 0 && (
              <Text style={styles.expLine}>Expenses: {fmtINR(data?.totals?.expenses || 0)} · Tips: {fmtINR(data?.totals?.tips || 0)}</Text>
            )}
          </View>

          {/* Type Revenue Split — Ladies / Men / Unisex */}
          {isAdmin && genderData && (genderData.total_revenue > 0 ? (
            <View style={styles.genderCard} testID="revenue-by-gender-card">
              <View style={styles.genderHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="people-circle-outline" size={18} color={colors.brandPrimary} />
                  <Text style={styles.genderTitle}>Revenue by Segment</Text>
                </View>
                {genderData.top_segment && (
                  <View style={styles.topBadge}>
                    <Ionicons name="trophy" size={11} color="#B77400" />
                    <Text style={styles.topBadgeText}>
                      Top: {genderData.segments.find(s => s.key === genderData.top_segment)?.label}
                    </Text>
                  </View>
                )}
              </View>
              {genderData.segments.map(s => {
                const isTop = s.key === genderData.top_segment;
                const color = s.key === 'ladies' ? '#D9337B' : s.key === 'men' ? '#2E6BE6' : colors.brandPrimary;
                return (
                  <View key={s.key} style={styles.genderRow} testID={`rev-gender-${s.key}`}>
                    <View style={styles.genderRowHead}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.genderDot, { backgroundColor: color }]} />
                        <Text style={[styles.genderLabel, isTop && { color, fontWeight: '800' }]}>{s.label}</Text>
                        <Text style={styles.genderCount}>· {s.count} items</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.genderAmt, isTop && { color, fontWeight: '800' }]}>{fmtINR(s.revenue)}</Text>
                        <Text style={styles.genderShare}>{s.share_pct.toFixed(1)}%</Text>
                      </View>
                    </View>
                    <View style={styles.gTrack}>
                      <View style={[styles.gFill, { width: `${Math.min(100, s.share_pct)}%`, backgroundColor: color }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={[styles.genderCard, { alignItems: 'center', paddingVertical: spacing.lg }]} testID="revenue-by-gender-empty">
              <Ionicons name="people-circle-outline" size={28} color={colors.onSurfaceTertiary} />
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 6 }}>
                No segmented revenue yet — tag services with Ladies / Men / Unisex.
              </Text>
            </View>
          ))}

          {(data?.rows || []).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="bar-chart-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No data in range</Text>
            </View>
          ) : (data?.rows || []).map(r => (
            <View key={r.date} style={styles.row} testID={`report-${r.date}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowDate}>{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' })}</Text>
                <Text style={styles.rowMeta}>
                  {r.count} bills · Cash {fmtINR(r.cash)} · QR {fmtINR(r.qr)}
                  {isAdmin && r.expenses > 0 ? ` · Exp ${fmtINR(r.expenses)}` : ''}
                </Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(r.total / maxTotal) * 100}%` }]} />
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.rowTotal}>{fmtINR(r.total)}</Text>
                {isAdmin && r.expenses > 0 && (
                  <Text style={[styles.rowNet, { color: r.net >= 0 ? colors.success : colors.error }]}>
                    Net {fmtINR(r.net)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Custom range modal — with calendar */}
      <Modal visible={customOpen} transparent animationType="slide" onRequestClose={() => setCustomOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCustomOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Custom Date Range</Text>

              <View style={styles.dateSwitchRow}>
                <TouchableOpacity
                  testID="pick-from"
                  onPress={() => setPickingField('from')}
                  style={[styles.dateSwitch, pickingField === 'from' && styles.dateSwitchActive]}
                >
                  <Text style={styles.dateSwitchLabel}>FROM</Text>
                  <Text style={[styles.dateSwitchValue, pickingField === 'from' && { color: '#fff' }]}>{fromDate}</Text>
                </TouchableOpacity>
                <Ionicons name="arrow-forward" size={16} color={colors.onSurfaceTertiary} />
                <TouchableOpacity
                  testID="pick-to"
                  onPress={() => setPickingField('to')}
                  style={[styles.dateSwitch, pickingField === 'to' && styles.dateSwitchActive]}
                >
                  <Text style={styles.dateSwitchLabel}>TO</Text>
                  <Text style={[styles.dateSwitchValue, pickingField === 'to' && { color: '#fff' }]}>{toDate}</Text>
                </TouchableOpacity>
              </View>

              <Calendar
                testID="range-calendar"
                current={pickingField === 'from' ? fromDate : toDate}
                maxDate={today}
                onDayPress={(day) => {
                  Haptics.selectionAsync();
                  if (pickingField === 'from') {
                    setFromDate(day.dateString);
                    // If from > to, reset to
                    if (day.dateString > toDate) setToDate(day.dateString);
                    setPickingField('to');
                  } else {
                    // Ensure to >= from
                    if (day.dateString < fromDate) setFromDate(day.dateString);
                    setToDate(day.dateString);
                  }
                }}
                markingType="period"
                markedDates={buildMarkedRange(fromDate, toDate)}
                theme={{
                  backgroundColor: colors.surface,
                  calendarBackground: colors.surface,
                  textSectionTitleColor: colors.onSurfaceSecondary,
                  selectedDayBackgroundColor: colors.brandPrimary,
                  selectedDayTextColor: '#fff',
                  todayTextColor: colors.brandPrimary,
                  dayTextColor: colors.onSurface,
                  monthTextColor: colors.onSurface,
                  arrowColor: colors.brandPrimary,
                  textDayFontWeight: '500' as any,
                  textMonthFontWeight: '700' as any,
                }}
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setCustomOpen(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="apply-range" style={[styles.applyBtn, { flex: 1 }]} onPress={applyCustom}>
                  <Text style={styles.applyBtnText}>Apply Range</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Share options sheet */}
      <Modal visible={shareOpen} transparent animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.actionSheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Share Report</Text>
            <Text style={styles.sheetSub}>{currentRangeLabel()}</Text>
            <TouchableOpacity testID="share-csv" style={styles.actionBtn} onPress={doShareCsv}>
              <View style={[styles.actionIcon, { backgroundColor: '#DDF3E4' }]}>
                <Ionicons name="grid-outline" size={20} color="#207447" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>CSV (Excel)</Text>
                <Text style={styles.actionDesc}>Spreadsheet format for analysis</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity testID="share-pdf" style={styles.actionBtn} onPress={doSharePdf}>
              <View style={[styles.actionIcon, { backgroundColor: '#FFE5E5' }]}>
                <Ionicons name="document-text-outline" size={20} color="#C42032" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>PDF</Text>
                <Text style={styles.actionDesc}>Formatted document with your branding</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity testID="share-print" style={styles.actionBtn} onPress={doPrint}>
              <View style={[styles.actionIcon, { backgroundColor: '#E5EEFF' }]}>
                <Ionicons name="print-outline" size={20} color="#2551B4" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>Print</Text>
                <Text style={styles.actionDesc}>Open printer dialog</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShareOpen(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// Build marked dates for react-native-calendars period selection
function buildMarkedRange(from: string, to: string): Record<string, any> {
  const marked: Record<string, any> = {};
  if (!from) return marked;
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return marked;
  if (from === to) {
    marked[from] = { startingDay: true, endingDay: true, color: '#C42032', textColor: '#fff' };
    return marked;
  }
  const cur = new Date(start.getTime());
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    const isStart = iso === from;
    const isEnd = iso === to;
    marked[iso] = {
      startingDay: isStart, endingDay: isEnd,
      color: '#C42032', textColor: '#fff',
    };
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return marked;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: 'center' },
  chip: { flexShrink: 0, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff' },

  summary: { backgroundColor: colors.surfaceInverse, borderRadius: radius.md, padding: spacing.xl, marginBottom: spacing.lg, ...shadows.strong },
  summaryLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11, letterSpacing: 0.5, fontWeight: '700' },
  summaryVal: { color: colors.brandSecondary, fontSize: 32, fontWeight: '900', marginTop: 4 },
  summaryStats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  statBox: { flex: 1, backgroundColor: 'rgba(228,192,112,0.12)', padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(228,192,112,0.3)' },
  statLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  statVal: { color: '#fff', fontSize: 12, fontWeight: '800', marginTop: 2 },
  expLine: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: spacing.md, fontWeight: '600' },

  genderCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, ...shadows.sm, gap: spacing.sm },
  genderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  genderTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  topBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: '#FFF3D6', borderWidth: 1, borderColor: '#F0DCA6' },
  topBadgeText: { fontSize: 10, fontWeight: '700', color: '#B77400' },
  genderRow: { gap: 4 },
  genderRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  genderDot: { width: 8, height: 8, borderRadius: 4 },
  genderLabel: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  genderCount: { fontSize: 10, color: colors.onSurfaceTertiary },
  genderAmt: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  genderShare: { fontSize: 10, color: colors.onSurfaceTertiary },
  gTrack: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 3, overflow: 'hidden' },
  gFill: { height: '100%', borderRadius: 3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  rowDate: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  rowMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowTotal: { fontSize: 15, fontWeight: '800', color: colors.brandPrimary },
  rowNet: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  barTrack: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.brandPrimary, borderRadius: 3 },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 14 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  applyBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  cancelBtnText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 14 },

  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  dateSwitchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  dateSwitch: { flex: 1, backgroundColor: colors.surfaceTertiary, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  dateSwitchActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  dateSwitchLabel: { fontSize: 9, color: colors.onSurfaceTertiary, fontWeight: '800', letterSpacing: 1 },
  dateSwitchValue: { fontSize: 14, color: colors.onSurface, fontWeight: '700', marginTop: 2 },

  sheetSub: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center', marginTop: -6 },
  actionSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm, maxWidth: 480, width: '100%', alignSelf: 'center', marginTop: 'auto' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  actionDesc: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
});
