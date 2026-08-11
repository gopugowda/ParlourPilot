import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import { rowsToCsv, shareCsv, sharePdf, printOrShareHtml, buildReportHtml } from '@/src/utils/exportShare';

type Preset = 'today' | 'week' | 'month' | 'last_month';

type StaffRow = {
  beautician_id: string | null;
  beautician_name: string;
  role: string;
  revenue: number;
  tips: number;
  earnings: number;
  services: number;
  appointments: number;
  avg_ticket: number;
  trend: { date: string; value: number }[];
};

type StaffPerf = {
  from: string;
  to: string;
  days: string[];
  rows: StaffRow[];
  totals: { revenue: number; tips: number; earnings: number; services: number; appointments: number };
  top_performer: StaffRow | null;
};

// Palette used for chart bars — cycled by index
const PALETTE = ['#C42032', '#D96B3E', '#E4A34C', '#4A9B5C', '#3F7EB3', '#8A5CB8', '#B84E7A', '#5C7A94'];

export default function StaffPerformanceScreen() {
  const router = useRouter();
  const { user, tenant } = useAuth();
  const isOwner = user?.role === 'admin' || user?.role === 'owner';

  const [preset, setPreset] = useState<Preset>('month');
  const [data, setData] = useState<StaffPerf | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const load = async (p: Preset = preset) => {
    setLoading(true);
    try {
      const res: any = await api(`/reports/staff-performance?preset=${p}`);
      setData(res);
    } catch (e: any) {
      // Non-fatal; ScrollView will show error inline
      setData({ from: '', to: '', days: [], rows: [], totals: { revenue: 0, tips: 0, earnings: 0, services: 0, appointments: 0 }, top_performer: null });
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { if (isOwner) load(preset); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [preset]);

  // Aggregated daily trend across ALL staff — powers the top-level bar chart
  const aggregateTrend = useMemo(() => {
    if (!data) return [] as { date: string; value: number }[];
    const map: Record<string, number> = {};
    data.days.forEach(d => { map[d] = 0; });
    data.rows.forEach(row => {
      row.trend.forEach(t => { map[t.date] = (map[t.date] || 0) + t.value; });
    });
    return data.days.map(d => ({ date: d, value: Math.round((map[d] || 0) * 100) / 100 }));
  }, [data]);

  const maxDay = Math.max(1, ...aggregateTrend.map(t => t.value));
  const maxRevenue = Math.max(1, ...(data?.rows.map(r => r.earnings) || [1]));

  // ---- Export helpers ----
  const buildExport = () => {
    const headers = ['Rank', 'Staff', 'Role', 'Services', 'Appointments', 'Revenue (₹)', 'Tips (₹)', 'Earnings (₹)', 'Avg Ticket (₹)'];
    const rows = (data?.rows || []).map((r, i) => [
      i + 1, r.beautician_name, r.role || '—', r.services, r.appointments, r.revenue, r.tips, r.earnings, r.avg_ticket,
    ]);
    const t = data?.totals || { revenue: 0, tips: 0, earnings: 0, services: 0, appointments: 0 };
    const totalRow = ['TOTAL', '', '', t.services, t.appointments, t.revenue, t.tips, t.earnings, ''];
    return { headers, rows, totalRow };
  };

  const doExportCsv = async () => {
    setShareOpen(false);
    if (!data) return;
    const { headers, rows, totalRow } = buildExport();
    const csv = rowsToCsv(headers, [...rows, totalRow]);
    await shareCsv(csv, `staff_performance_${data.from}_${data.to}.csv`);
  };

  const buildHtml = () => {
    const { headers, rows, totalRow } = buildExport();
    const t = data?.totals || { revenue: 0, tips: 0, earnings: 0, services: 0, appointments: 0 };
    return buildReportHtml({
      title: 'Staff Performance Report',
      subtitle: `${data?.from} → ${data?.to}`,
      brand: { name: tenant?.business_name, color: (tenant as any)?.brand_color || '#C42032', logo: (tenant as any)?.logo || null },
      summary: [
        { label: 'Total Earnings', value: `₹${t.earnings.toLocaleString('en-IN')}` },
        { label: 'Services', value: String(t.services) },
        { label: 'Appointments', value: String(t.appointments) },
        { label: 'Tips', value: `₹${t.tips.toLocaleString('en-IN')}` },
        { label: 'Top Performer', value: data?.top_performer?.beautician_name || '—' },
      ],
      columns: headers,
      rows,
      totalRow,
      footer: 'Payroll reference report',
    });
  };

  const doSharePdf = async () => {
    setShareOpen(false);
    if (!data) return;
    await sharePdf(buildHtml(), `staff_performance_${data.from}_${data.to}.pdf`);
  };

  const doPrint = async () => {
    setShareOpen(false);
    if (!data) return;
    await printOrShareHtml(buildHtml(), `staff_performance_${data.from}_${data.to}.pdf`);
  };

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.centerRoot}>
        <Ionicons name="lock-closed-outline" size={40} color={colors.onSurfaceTertiary} />
        <Text style={styles.blockTitle}>Owner Access Only</Text>
        <Text style={styles.blockText}>Staff Performance is available to owners and admins.</Text>
        <TouchableOpacity style={styles.blockBtn} onPress={() => router.back()}>
          <Text style={styles.blockBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const top = data?.top_performer;

  return (
    <View style={styles.root} testID="staff-performance-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Staff Performance</Text>
          <Text style={styles.headerSub}>{data ? `${data.from} → ${data.to}` : 'Pick a period'}</Text>
        </View>
        <TouchableOpacity testID="share-btn" style={styles.shareBtn} onPress={() => setShareOpen(true)}>
          <Ionicons name="share-outline" size={18} color="#fff" />
          <Text style={styles.shareBtnText}>Export</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Period chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {([
          { k: 'today', label: 'Today' },
          { k: 'week', label: 'Last 7 Days' },
          { k: 'month', label: 'This Month' },
          { k: 'last_month', label: 'Last Month' },
        ] as { k: Preset; label: string }[]).map(({ k, label }) => (
          <TouchableOpacity
            key={k}
            testID={`preset-${k}`}
            style={[styles.chip, preset === k && styles.chipActive]}
            onPress={() => { Haptics.selectionAsync(); setPreset(k); }}
          >
            <Text style={[styles.chipText, preset === k && styles.chipTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(preset); }} />}
      >
        {loading && !data ? (
          <View style={styles.centerBox}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <>
            {/* Top Performer Card */}
            {top && top.earnings > 0 && (
              <View style={styles.topCard} testID="top-performer-card">
                <View style={styles.topBadge}>
                  <Ionicons name="trophy" size={14} color="#8A5A00" />
                  <Text style={styles.topBadgeText}>TOP PERFORMER</Text>
                </View>
                <Text style={styles.topName}>{top.beautician_name}</Text>
                {top.role ? <Text style={styles.topRole}>{top.role}</Text> : null}
                <View style={styles.topStats}>
                  <View style={styles.topStat}>
                    <Text style={styles.topStatVal}>{fmtINR(top.earnings)}</Text>
                    <Text style={styles.topStatLabel}>Earnings</Text>
                  </View>
                  <View style={styles.topStatDivider} />
                  <View style={styles.topStat}>
                    <Text style={styles.topStatVal}>{top.appointments}</Text>
                    <Text style={styles.topStatLabel}>Appointments</Text>
                  </View>
                  <View style={styles.topStatDivider} />
                  <View style={styles.topStat}>
                    <Text style={styles.topStatVal}>{top.services}</Text>
                    <Text style={styles.topStatLabel}>Services</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Totals summary */}
            <View style={styles.summaryGrid}>
              <SummaryCard label="Total Earnings" value={fmtINR(data?.totals.earnings || 0)} />
              <SummaryCard label="Services" value={String(data?.totals.services || 0)} />
              <SummaryCard label="Appointments" value={String(data?.totals.appointments || 0)} />
              <SummaryCard label="Tips" value={fmtINR(data?.totals.tips || 0)} />
            </View>

            {/* Trend Chart */}
            {aggregateTrend.length > 1 && (
              <View style={styles.chartCard} testID="trend-chart">
                <Text style={styles.cardTitle}>Team Earnings Trend</Text>
                <Text style={styles.cardSub}>Combined revenue + tips per day</Text>
                <View style={styles.chartArea}>
                  {aggregateTrend.map((t, i) => {
                    const h = Math.max(4, (t.value / maxDay) * 140);
                    const isMax = t.value > 0 && t.value === maxDay;
                    return (
                      <View key={t.date} style={styles.chartCol}>
                        <Text style={styles.chartBarVal}>{t.value > 0 ? (t.value >= 1000 ? `${Math.round(t.value / 100) / 10}k` : String(Math.round(t.value))) : ''}</Text>
                        <View style={[styles.chartBar, { height: h, backgroundColor: isMax ? colors.brandPrimary : `${colors.brandPrimary}80` }]} />
                        <Text style={styles.chartXLabel}>{t.date.slice(5)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Staff list with revenue bars */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Staff Ranking</Text>
              <Text style={styles.cardSub}>Sorted by earnings (revenue + tips)</Text>
              {data && data.rows.length > 0 ? data.rows.map((r, i) => {
                const pct = Math.max(2, Math.round((r.earnings / maxRevenue) * 100));
                const barColor = PALETTE[i % PALETTE.length];
                const isTop = i === 0 && r.earnings > 0;
                return (
                  <View key={(r.beautician_id || r.beautician_name) + i} style={styles.staffRow} testID={`staff-row-${i}`}>
                    <View style={styles.staffRowHeader}>
                      <View style={styles.staffRank}>
                        {isTop ? (
                          <Ionicons name="trophy" size={14} color="#B58900" />
                        ) : (
                          <Text style={styles.staffRankText}>#{i + 1}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.staffName}>{r.beautician_name}</Text>
                        <Text style={styles.staffMeta}>
                          {r.role ? r.role + ' · ' : ''}{r.appointments} appt{r.appointments === 1 ? '' : 's'} · {r.services} service{r.services === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.staffEarnings}>{fmtINR(r.earnings)}</Text>
                        {r.tips > 0 && <Text style={styles.staffTips}>incl. {fmtINR(r.tips)} tips</Text>}
                      </View>
                    </View>
                    <View style={styles.staffBarTrack}>
                      <View style={[styles.staffBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
                    </View>
                    {r.avg_ticket > 0 && (
                      <Text style={styles.staffAvg}>Avg ticket: {fmtINR(r.avg_ticket)}</Text>
                    )}
                  </View>
                );
              }) : (
                <View style={styles.empty}>
                  <Ionicons name="people-outline" size={32} color={colors.onSurfaceTertiary} />
                  <Text style={styles.emptyText}>No performance data for this period.</Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Export sheet */}
      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Export Payroll Report</Text>
            <Text style={styles.sheetSub}>{data?.from} → {data?.to}</Text>

            <TouchableOpacity style={styles.sheetOpt} onPress={doExportCsv} testID="export-csv">
              <View style={[styles.sheetOptIcon, { backgroundColor: '#DFF3E1' }]}><Ionicons name="grid-outline" size={20} color="#2E7D32" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptLabel}>CSV (Excel)</Text>
                <Text style={styles.sheetOptHint}>For payroll import & spreadsheet analysis</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetOpt} onPress={doSharePdf} testID="export-pdf">
              <View style={[styles.sheetOptIcon, { backgroundColor: '#FDE9E9' }]}><Ionicons name="document-text-outline" size={20} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptLabel}>PDF</Text>
                <Text style={styles.sheetOptHint}>Formatted document with branding</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetOpt} onPress={doPrint} testID="export-print">
              <View style={[styles.sheetOptIcon, { backgroundColor: '#E3EDF7' }]}><Ionicons name="print-outline" size={20} color="#3F6C9C" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptLabel}>Print</Text>
                <Text style={styles.sheetOptHint}>Open system printer dialog</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetCancel} onPress={() => setShareOpen(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sumCard}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: { padding: 4 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 1 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
  shareBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  chipsRow: { padding: spacing.md, gap: spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  centerBox: { alignItems: 'center', paddingVertical: 40 },
  centerRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.surface, gap: spacing.md },
  blockTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface },
  blockText: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },
  blockBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radius.md, marginTop: spacing.md },
  blockBtnText: { color: '#fff', fontWeight: '700' },

  // Top performer card
  topCard: {
    backgroundColor: '#FFF8E7',
    borderWidth: 1, borderColor: '#F0D89A',
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.card,
  },
  topBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: '#F0D89A', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  topBadgeText: { fontSize: 10, fontWeight: '900', color: '#8A5A00', letterSpacing: 1 },
  topName: { fontSize: 22, fontWeight: '900', color: colors.onSurface, marginTop: spacing.sm },
  topRole: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2, fontWeight: '600' },
  topStats: { flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: '#F0D89A' },
  topStat: { flex: 1, alignItems: 'center' },
  topStatVal: { fontSize: 18, fontWeight: '900', color: colors.brandPrimary },
  topStatLabel: { fontSize: 10, color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2, fontWeight: '700' },
  topStatDivider: { width: 1, backgroundColor: '#F0D89A' },

  // Summary grid
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  sumCard: { flex: 1, minWidth: 140, backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  sumLabel: { fontSize: 10, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  sumValue: { fontSize: 18, fontWeight: '800', color: colors.onSurface, marginTop: 4 },

  // Chart card
  chartCard: { backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md, ...shadows.card },
  chartArea: { flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.md, height: 180, gap: 4 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  chartBarVal: { fontSize: 9, color: colors.onSurfaceSecondary, fontWeight: '700', marginBottom: 2, height: 12 },
  chartBar: { width: '80%', borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 2 },
  chartXLabel: { fontSize: 9, color: colors.onSurfaceTertiary, marginTop: 4 },

  card: { backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadows.card },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  cardSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  // Staff row
  staffRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 6 },
  staffRowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  staffRank: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  staffRankText: { fontSize: 11, fontWeight: '900', color: colors.onSurfaceSecondary },
  staffName: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  staffMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  staffEarnings: { fontSize: 15, fontWeight: '900', color: colors.brandPrimary },
  staffTips: { fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 1 },
  staffBarTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: 'hidden' },
  staffBarFill: { height: '100%', borderRadius: 3 },
  staffAvg: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { fontSize: 13, color: colors.onSurfaceTertiary },

  // Export sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end', alignItems: 'center' } as any,
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    ...(Platform.OS === 'web' ? { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 } : {}),
    padding: spacing.lg, gap: spacing.sm, width: '100%', maxWidth: 480, alignSelf: 'center',
  } as any,
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  sheetSub: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center', marginBottom: spacing.sm },
  sheetOpt: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' },
  sheetOptIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sheetOptLabel: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  sheetOptHint: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  sheetCancel: { paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  sheetCancelText: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
});
