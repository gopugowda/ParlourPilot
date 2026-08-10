import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput,
  Modal, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const presets = isAdmin ? ADMIN_PRESETS : STAFF_PRESETS;

  const [preset, setPreset] = useState<string>('week');
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [customOpen, setCustomOpen] = useState(false);
  const [data, setData] = useState<{ from: string; to: string; totals: any; rows: Row[] } | null>(null);
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
      const res: any = await api(`/reports/range?${params}`);
      setData(res);
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

      {/* Custom range modal */}
      <Modal visible={customOpen} transparent animationType="slide" onRequestClose={() => setCustomOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCustomOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Custom Date Range</Text>
              <View style={styles.field}>
                <Text style={styles.label}>From (YYYY-MM-DD)</Text>
                <TextInput
                  testID="from-input"
                  value={fromDate}
                  onChangeText={setFromDate}
                  placeholder="2026-01-01"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>To (YYYY-MM-DD)</Text>
                <TextInput
                  testID="to-input"
                  value={toDate}
                  onChangeText={setToDate}
                  placeholder="2026-01-31"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>
              <TouchableOpacity testID="apply-range" style={styles.applyBtn} onPress={applyCustom}>
                <Text style={styles.applyBtnText}>Apply</Text>
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  applyBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
