import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { pickLogTimestamp, pickLogStaffName, fmtLocalTime } from '@/src/utils/attendance';

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
  const [from, setFrom] = useState(daysAgoISO(7));
  const [to, setTo] = useState(todayISO());
  const [logDate, setLogDate] = useState(todayISO());
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);

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

  const totalHours = summary.reduce((a, b) => a + (b.total_hours || 0), 0);
  const totalOT = summary.reduce((a, b) => a + (b.overtime_hours || 0), 0);

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
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        {/* Summary range */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary (per staff)</Text>
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>From</Text>
              <TextInput testID="range-from" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>To</Text>
              <TextInput testID="range-to" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            </View>
          </View>
          {loading ? <ActivityIndicator color={colors.brandPrimary} /> : (
            <>
              <View style={styles.totalsRow}>
                <View style={styles.totalPill}>
                  <Text style={styles.totalLabel}>Total hours</Text>
                  <Text style={styles.totalVal}>{totalHours.toFixed(1)}</Text>
                </View>
                <View style={[styles.totalPill, { backgroundColor: '#FEF3E4', borderColor: '#F59E0B33' }]}>
                  <Text style={[styles.totalLabel, { color: '#B45309' }]}>Overtime</Text>
                  <Text style={[styles.totalVal, { color: '#B45309' }]}>{totalOT.toFixed(1)}</Text>
                </View>
              </View>
              {summary.length === 0 ? (
                <Text style={styles.empty}>No punches in this range.</Text>
              ) : summary.map((r, i) => (
                <View key={i} style={styles.tableRow} testID={`sum-row-${i}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.staffName}>{r.staff_name}</Text>
                    {r.employee_id ? <Text style={styles.meta}>{r.employee_id} · {r.days} day(s)</Text> : <Text style={styles.meta}>{r.days} day(s)</Text>}
                  </View>
                  <Text style={styles.numCell}>{(r.total_hours || 0).toFixed(1)}h</Text>
                  <Text style={[styles.numCell, { color: '#B45309', fontWeight: '800' }]}>{(r.overtime_hours || 0).toFixed(1)}h</Text>
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
          {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.md }} /> : (
            logs.length === 0 ? <Text style={styles.empty}>No punches on this date.</Text> :
            logs.map((l, i) => (
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
});
