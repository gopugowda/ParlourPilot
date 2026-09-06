/**
 * Per-staff Payroll & Performance detail — attendance days + bills for the
 * selected period. Consumes the shared backend, no calculation on-device.
 *
 * Endpoint: GET /api/reports/staff-performance/{beautician_id}/detail
 *   ?preset=today|week|month|last_month  OR
 *   ?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * Safe ISO parsing (iOS/Safari) via `parseTimestamp` — handles microsecond ISO.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import { parseTimestamp, fmtLocalTime } from '@/src/utils/attendance';
import { hm } from '@/src/utils/time';

type AttendanceDay = {
  date: string;
  check_in?: string;
  check_out?: string;
  hours: number;
  overtime: number;
  late?: boolean;
};
type Bill = {
  date: string;
  bill_no?: string | number;
  customer_name?: string;
  services?: string[];
  revenue: number;
  tips?: number;
};
type DetailResponse = {
  beautician_id: string;
  beautician_name?: string;
  role?: string;
  from: string;
  to: string;
  attendance_days: AttendanceDay[];
  bills: Bill[];
};

const fmtDay = (iso?: string) => {
  const d = parseTimestamp(iso);
  return d ? d.format('ddd, MMM D') : (iso || '—');
};

export default function PayrollDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isOwner = !!user?.is_owner;
  const allowed = isOwner;

  const params = useLocalSearchParams<{ id: string; from?: string; to?: string; preset?: string }>();
  const beauticianId = String(params.id || '');
  const from = String(params.from || '');
  const to = String(params.to || '');

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!allowed || !beauticianId) { setLoading(false); return; }
    setLoading(true);
    try {
      const qs = from && to ? `?from_date=${from}&to_date=${to}` : '?preset=month';
      const res: any = await api(`/reports/staff-performance/${beauticianId}/detail${qs}`);
      if (res) setData(res);
    } catch {
      setData(null);
    } finally { setLoading(false); }
  }, [allowed, beauticianId, from, to]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const totalRevenue = (data?.bills || []).reduce((s, b) => s + (b.revenue || 0), 0);
  const totalTips = (data?.bills || []).reduce((s, b) => s + (b.tips || 0), 0);
  const totalHours = (data?.attendance_days || []).reduce((s, d) => s + (d.hours || 0), 0);

  return (
    <View style={styles.root} testID="payroll-detail-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{data?.beautician_name || 'Staff detail'}</Text>
          {data && <Text style={styles.headerSub}>{data.from} → {data.to}</Text>}
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
        ) : !data ? (
          <View style={styles.emptyBox}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyText}>No detail available for this staff / period.</Text>
          </View>
        ) : (
          <>
            {/* Summary */}
            <View style={styles.sumRow}>
              <View style={styles.sumBox}>
                <Text style={styles.sumLabel}>Hours</Text>
                <Text style={styles.sumValue}>{hm(totalHours)}</Text>
              </View>
              <View style={styles.sumBox}>
                <Text style={styles.sumLabel}>Revenue</Text>
                <Text style={styles.sumValue}>{fmtINR(totalRevenue)}</Text>
              </View>
              <View style={styles.sumBox}>
                <Text style={styles.sumLabel}>Tips</Text>
                <Text style={styles.sumValue}>{fmtINR(totalTips)}</Text>
              </View>
            </View>

            {/* Attendance */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Attendance ({data.attendance_days.length})</Text>
              {data.attendance_days.length === 0 ? (
                <Text style={styles.subtle}>No attendance recorded in this period.</Text>
              ) : (
                data.attendance_days.map((d, i) => (
                  <View key={d.date + i} style={styles.attRow} testID={`att-row-${i}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attDate}>{fmtDay(d.date)}</Text>
                      <Text style={styles.attMeta}>
                        {d.check_in ? `In ${fmtLocalTime(d.check_in)}` : 'No check-in'}
                        {d.check_out ? ` · Out ${fmtLocalTime(d.check_out)}` : ''}
                        {d.late ? ' · Late' : ''}
                      </Text>
                    </View>
                    <View style={styles.attHoursCol}>
                      <Text style={styles.attHours}>{hm(d.hours)}</Text>
                      {(d.overtime || 0) > 0 && (
                        <Text style={styles.attOt}>+{hm(d.overtime)} OT</Text>
                      )}
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Bills */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Bills ({data.bills.length})</Text>
              {data.bills.length === 0 ? (
                <Text style={styles.subtle}>No bills in this period.</Text>
              ) : (
                data.bills.map((b, i) => (
                  <View key={(b.bill_no ?? '') + '_' + i} style={styles.billRow} testID={`bill-row-${i}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.billCust} numberOfLines={1}>
                        {b.customer_name || 'Walk-in'} {b.bill_no ? `· #${b.bill_no}` : ''}
                      </Text>
                      <Text style={styles.billMeta} numberOfLines={1}>
                        {fmtDay(b.date)}{b.services && b.services.length ? ' · ' + b.services.join(', ') : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.billRev}>{fmtINR(b.revenue || 0)}</Text>
                      {(b.tips || 0) > 0 && <Text style={styles.billTip}>+{fmtINR(b.tips!)} tip</Text>}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  loadingBox: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  emptyText: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },
  subtle: { fontSize: 12, color: colors.onSurfaceTertiary, paddingVertical: spacing.sm, textAlign: 'center' },

  sumRow: { flexDirection: 'row', gap: spacing.sm },
  sumBox: { flex: 1, padding: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.brandSecondary },
  sumLabel: { fontSize: 10, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  sumValue: { fontSize: 16, fontWeight: '900', color: colors.brandPrimary, marginTop: 4 },

  section: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadows.card },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface, marginBottom: 4 },

  attRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  attDate: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  attMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  attHoursCol: { alignItems: 'flex-end' },
  attHours: { fontSize: 13, fontWeight: '800', color: colors.brandPrimary },
  attOt: { fontSize: 10, fontWeight: '700', color: colors.warning },

  billRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  billCust: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  billMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  billRev: { fontSize: 13, fontWeight: '800', color: colors.success },
  billTip: { fontSize: 10, fontWeight: '700', color: colors.info, marginTop: 2 },
});
