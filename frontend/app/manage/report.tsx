import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

export default function DailyReportScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setRows(await api('/reports/daily?days=30')); } catch {} finally { setLoading(false); }
    })();
  }, []);

  const totalMonth = rows.reduce((s, r) => s + r.total, 0);
  const maxTotal = Math.max(1, ...rows.map(r => r.total));

  return (
    <View style={styles.root} testID="report-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Daily Report</Text>
          <Text style={styles.headerSub}>Last 30 days</Text>
        </View>
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>30-Day Revenue</Text>
            <Text style={styles.summaryVal}>{fmtINR(totalMonth)}</Text>
            <Text style={styles.summarySub}>{rows.reduce((s, r) => s + r.count, 0)} bills</Text>
          </View>

          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="bar-chart-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No data yet</Text>
            </View>
          ) : rows.map(r => (
            <View key={r.date} style={styles.row} testID={`report-${r.date}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowDate}>{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' })}</Text>
                <Text style={styles.rowMeta}>{r.count} bills · Cash {fmtINR(r.cash)} · QR {fmtINR(r.qr)}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(r.total / maxTotal) * 100}%` }]} />
                </View>
              </View>
              <Text style={styles.rowTotal}>{fmtINR(r.total)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  summary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.xl, marginBottom: spacing.lg, ...shadows.strong },
  summaryLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, letterSpacing: 0.5 },
  summaryVal: { color: '#fff', fontSize: 32, fontWeight: '800', marginTop: 4 },
  summarySub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  rowDate: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  rowMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowTotal: { fontSize: 15, fontWeight: '800', color: colors.brandPrimary },

  barTrack: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.brandPrimary, borderRadius: 3 },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 14 },
});
