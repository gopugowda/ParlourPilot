import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { pickLogTimestamp, pickLogStaffName, fmtLocalTime } from '@/src/utils/attendance';
import {
  DatePresetChips, rangeFromPreset, ReportToolbar, ExportMenu, ReportEmptyState,
  type DatePreset, type ExportAction,
} from '@/src/components/ReportKit';
import { rowsToCsv, shareCsv, sharePdf, printOrShareHtml, buildReportHtml } from '@/src/utils/exportShare';
import { hm } from '@/src/utils/time';

type SummaryRow = {
  staff_name: string; employee_id?: string; total_hours: number; overtime_hours: number; days: number;
};
type LogRow = {
  staff_name?: string; name?: string; staffName?: string; user_name?: string;
  staff_id?: string; employee_id?: string;
  action: 'check_in' | 'check_out' | 'break_start' | 'break_end';
  ts?: string; timestamp?: string; time?: string; created_at?: string;
  distance_m?: number; within_geofence?: boolean;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
// Uses the dayjs helper so backend microsecond ISO strings parse reliably on Hermes,
// and honours the canonical `ts` alias when present.
const fmtTime = (iso?: string) => fmtLocalTime(iso || '');

export default function AttendanceReportScreen() {
  const router = useRouter();
  const { tenant } = useAuth();
  const [from, setFrom] = useState(daysAgoISO(7));
  const [to, setTo] = useState(todayISO());
  const [preset, setPreset] = useState<DatePreset>('last7');
  const [logDate, setLogDate] = useState(todayISO());
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [staffFilter, setStaffFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | LogRow['action']>('all');
  const [exportOpen, setExportOpen] = useState(false);

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    if (p !== 'custom') {
      const r = rangeFromPreset(p);
      if (r) { setFrom(r.from); setTo(r.to); setLogDate(r.to); }
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        api<SummaryRow[]>(`/attendance/summary?from=${from}&to=${to}`).catch(() => [] as SummaryRow[]),
        api<LogRow[]>(`/attendance/logs?date=${logDate}`).catch(() => [] as LogRow[]),
      ]);
      setSummary(Array.isArray(s) ? s : []);
      setLogs(Array.isArray(l) ? l : []);
    } finally { setLoading(false); }
  }, [from, to, logDate]);
  useEffect(() => { load(); }, [load]);

  const filteredSummary = summary.filter(r =>
    !staffFilter || (r.staff_name || '').toLowerCase().includes(staffFilter.toLowerCase())
  );
  const filteredLogs = logs.filter(l => {
    const nm = pickLogStaffName(l) || '';
    if (staffFilter && !nm.toLowerCase().includes(staffFilter.toLowerCase())) return false;
    if (actionFilter !== 'all' && l.action !== actionFilter) return false;
    return true;
  });

  const totalHours = filteredSummary.reduce((a, b) => a + (b.total_hours || 0), 0);
  const totalOT = filteredSummary.reduce((a, b) => a + (b.overtime_hours || 0), 0);

  // ---- Export ----------------------------------------------------------
  const dateSuffix = () => `${from}_${to}`;
  const filterCount = (staffFilter ? 1 : 0) + (actionFilter !== 'all' ? 1 : 0);
  const doExport = async (a: ExportAction) => {
    if (a === 'csv') {
      const summaryCsv = rowsToCsv(
        ['Staff', 'Employee ID', 'Days', 'Total Hours', 'Overtime Hours'],
        filteredSummary.map(r => [r.staff_name || '', r.employee_id || '', r.days, (r.total_hours || 0).toFixed(2), (r.overtime_hours || 0).toFixed(2)]),
      );
      await shareCsv(summaryCsv, `attendance_summary_${dateSuffix()}.csv`);
      return;
    }
    const html = buildReportHtml({
      title: 'Attendance Report',
      subtitle: `${from} → ${to}${staffFilter ? ` · "${staffFilter}"` : ''}`,
      brand: { name: tenant?.business_name, color: colors.brandPrimary, logo: (tenant as any)?.logo || null },
      summary: [
        { label: 'Staff', value: String(filteredSummary.length) },
        { label: 'Total Hours', value: hm(totalHours) },
        { label: 'Overtime', value: hm(totalOT) },
      ],
      columns: ['Staff', 'Employee ID', 'Days', 'Hours', 'Overtime'],
      rows: filteredSummary.map(r => [
        r.staff_name || '', r.employee_id || '', r.days,
        (r.total_hours || 0).toFixed(2), (r.overtime_hours || 0).toFixed(2),
      ]),
      totalRow: ['Total', '', filteredSummary.reduce((s, r) => s + (r.days || 0), 0), totalHours.toFixed(2), totalOT.toFixed(2)],
    });
    if (a === 'pdf') { await sharePdf(html, `attendance_${dateSuffix()}.pdf`); return; }
    await printOrShareHtml(html, `attendance_${dateSuffix()}.pdf`);
  };

  return (
    <View style={styles.root} testID="attendance-report">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Attendance Report</Text>
          <Text style={styles.headerSub}>Summary + activity log</Text>
        </View>
        <ReportToolbar
          filterCount={filterCount}
          onOpenFilters={() => { /* handled inline via chips below */ }}
          onOpenMenu={() => setExportOpen(true)}
          filterTestID="att-filter-btn"
          menuTestID="att-menu-btn"
        />
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        {/* Date preset chips */}
        <DatePresetChips value={preset} onChange={applyPreset} testID="att-preset" />

        {/* Summary range */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary (per staff)</Text>
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>From</Text>
              <TextInput testID="range-from" value={from} onChangeText={(v) => { setFrom(v); setPreset('custom'); }} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>To</Text>
              <TextInput testID="range-to" value={to} onChangeText={(v) => { setTo(v); setPreset('custom'); }} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            </View>
          </View>
          <Text style={styles.label}>Staff search</Text>
          <TextInput
            testID="att-staff-search"
            value={staffFilter}
            onChangeText={setStaffFilter}
            placeholder="Filter by staff name"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
          />
          {loading ? <ActivityIndicator color={colors.brandPrimary} /> : (
            <>
              <View style={styles.totalsRow}>
                <View style={styles.totalPill}>
                  <Text style={styles.totalLabel}>Total hours</Text>
                  <Text style={styles.totalVal}>{hm(totalHours)}</Text>
                </View>
                {totalOT > 0 && (
                  <View style={[styles.totalPill, { backgroundColor: '#FEF3E4', borderColor: '#F59E0B33' }]}>
                    <Text style={[styles.totalLabel, { color: '#B45309' }]}>Overtime</Text>
                    <Text style={[styles.totalVal, { color: '#B45309' }]}>{hm(totalOT)}</Text>
                  </View>
                )}
              </View>
              {filteredSummary.length === 0 ? (
                <ReportEmptyState
                  icon="time-outline"
                  message={summary.length === 0
                    ? 'No punches in this range.'
                    : 'No attendance records found for the selected filters.'}
                  onReset={summary.length > 0 ? () => { setStaffFilter(''); setActionFilter('all'); } : undefined}
                />
              ) : filteredSummary.map((r, i) => (
                <View key={i} style={styles.tableRow} testID={`sum-row-${i}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.staffName}>{r.staff_name}</Text>
                    {r.employee_id ? <Text style={styles.meta}>{r.employee_id} · {r.days} day(s)</Text> : <Text style={styles.meta}>{r.days} day(s)</Text>}
                  </View>
                  <Text style={styles.numCell}>{hm(r.total_hours)}</Text>
                  {(r.overtime_hours || 0) > 0 ? (
                    <Text style={[styles.numCell, { color: '#B45309', fontWeight: '800' }]}>{hm(r.overtime_hours)}</Text>
                  ) : (
                    <Text style={[styles.numCell, { color: colors.onSurfaceTertiary }]}>—</Text>
                  )}
                </View>
              ))}
            </>
          )}
        </View>

        {/* Activity log — pick date */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Activity log</Text>
          <Text style={styles.label}>Date</Text>
          <TextInput testID="log-date" value={logDate} onChangeText={setLogDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }} style={{ flexGrow: 0 }}>
            {(['all', 'check_in', 'check_out', 'break_start', 'break_end'] as const).map(k => {
              const selected = actionFilter === k;
              const lbl = k === 'all' ? 'All' : prettyAction(k as any);
              return (
                <TouchableOpacity key={k} onPress={() => setActionFilter(k as any)} style={[styles.actionChip, selected && styles.actionChipActive]}>
                  <Text style={[styles.actionChipText, selected && styles.actionChipTextActive]}>{lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.md }} /> : (
            filteredLogs.length === 0 ? (
              <ReportEmptyState
                icon="finger-print-outline"
                message={logs.length === 0
                  ? 'No punches on this date.'
                  : 'No attendance records found for the selected filters.'}
                onReset={logs.length > 0 ? () => { setStaffFilter(''); setActionFilter('all'); } : undefined}
              />
            ) :
            filteredLogs.map((l, i) => (
              <View key={i} style={styles.logRow} testID={`log-row-${i}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.staffName}>{pickLogStaffName(l) || l.staff_id || '—'}</Text>
                  <Text style={styles.meta}>{prettyAction(l.action)} · {fmtTime(pickLogTimestamp(l))}</Text>
                </View>
                {typeof l.distance_m === 'number' && (
                  <View style={[styles.distPill, {
                    backgroundColor: l.within_geofence === false ? '#FDECEC' : colors.brandTertiary,
                    borderColor:     l.within_geofence === false ? colors.error : colors.brandSecondary,
                  }]}>
                    <Text style={[styles.distText, { color: l.within_geofence === false ? colors.error : colors.brandPrimary }]}>
                      {Math.round(l.distance_m)}m{l.within_geofence === false ? ' · outside' : ''}
                    </Text>
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <ExportMenu
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export Attendance"
        subtitle={`${from} → ${to} · ${filteredSummary.length} staff`}
        onPick={doExport}
      />
    </View>
  );
}

function prettyAction(a: LogRow['action']): string {
  return a === 'check_in' ? 'Check In'
    : a === 'check_out' ? 'Check Out'
    : a === 'break_start' ? 'Break Start' : 'Break End';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadows.card },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  label: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '700', textTransform: 'uppercase' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm, fontSize: 13, color: colors.onSurface },
  dateRow: { flexDirection: 'row', gap: spacing.sm },

  totalsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  totalPill: { flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },
  totalLabel: { fontSize: 11, color: colors.brandPrimary, fontWeight: '700' },
  totalVal: { fontSize: 18, fontWeight: '800', color: colors.brandPrimary },

  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm },
  staffName: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  meta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  numCell: { width: 60, textAlign: 'right', fontSize: 13, color: colors.onSurface, fontWeight: '700' },
  empty: { color: colors.onSurfaceTertiary, fontSize: 12 },

  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  distPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  distText: { fontSize: 10, fontWeight: '800' },
  actionChip: {
    paddingHorizontal: 10, height: 30, borderRadius: radius.pill,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  actionChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actionChipText: { fontSize: 11, fontWeight: '600', color: colors.onSurfaceSecondary },
  actionChipTextActive: { color: '#fff' },
});
