import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

const LOGO = require('../../assets/images/glow-logo-mark.png');

export default function DashboardScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const data = await api('/reports/summary');
      setSummary(data);
    } catch {}
  };

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const isAdmin = user?.role === 'admin';
  const adminActions = [
    { key: 'new', label: 'New Bill', icon: 'add-circle', route: '/(tabs)/new-bill', color: colors.brandPrimary },
    { key: 'hist', label: 'History', icon: 'receipt', route: '/(tabs)/history', color: colors.success },
    { key: 'srv', label: 'Services', icon: 'pricetags', route: '/manage/services', color: colors.warning },
    { key: 'staff', label: 'Staff', icon: 'people', route: '/manage/beauticians', color: colors.info },
  ];
  const staffActions = [
    { key: 'new', label: 'New Bill', icon: 'add-circle', route: '/(tabs)/new-bill', color: colors.brandPrimary },
    { key: 'hist', label: "Today's Bills", icon: 'receipt', route: '/(tabs)/history', color: colors.success },
    { key: 'report', label: 'Daily Report', icon: 'bar-chart', route: '/manage/report', color: colors.warning },
  ];
  const actions = isAdmin ? adminActions : staffActions;

  return (
    <View style={styles.root} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {/* Hero */}
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={['#FAF3E1', '#E4C070', '#D4AC55']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={['top']} style={styles.heroContent}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroBrand}>
                <View style={styles.heroLogoWrap}>
                  <Image source={LOGO} style={styles.heroLogo} contentFit="contain" />
                </View>
                <View>
                  <Text style={styles.heroBrandName}>GLOW UP</Text>
                  <Text style={styles.heroBrandSub}>Hi, {user?.name?.split(' ')[0] || 'there'}</Text>
                </View>
              </View>
              <TouchableOpacity testID="logout-btn" onPress={logout} style={styles.logoutBtn}>
                <Ionicons name="log-out-outline" size={20} color={colors.onSurface} />
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: spacing.xxl }}>
              <Text style={styles.heroLabel}>{"Today's Revenue"}</Text>
              {loading ? (
                <ActivityIndicator color={colors.onSurface} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} />
              ) : (
                <Text style={styles.heroValue} testID="today-revenue">{fmtINR(summary?.today?.total || 0)}</Text>
              )}
              <View style={styles.heroStatsRow}>
                <View style={styles.heroStatChip}>
                  <Ionicons name="receipt-outline" size={14} color={colors.onSurface} />
                  <Text style={styles.heroStatText}>{summary?.today?.count || 0} bills</Text>
                </View>
                <View style={styles.heroStatChip}>
                  <Ionicons name="cash-outline" size={14} color={colors.onSurface} />
                  <Text style={styles.heroStatText}>{fmtINR(summary?.today?.cash || 0)}</Text>
                </View>
                <View style={styles.heroStatChip}>
                  <Ionicons name="qr-code-outline" size={14} color={colors.onSurface} />
                  <Text style={styles.heroStatText}>{fmtINR(summary?.today?.qr || 0)}</Text>
                </View>
                {(summary?.today?.tips || 0) > 0 && (
                  <View style={styles.heroStatChip}>
                    <Ionicons name="heart-outline" size={14} color={colors.onSurface} />
                    <Text style={styles.heroStatText}>Tips {fmtINR(summary?.today?.tips || 0)}</Text>
                  </View>
                )}
                {(summary?.today?.expenses || 0) > 0 && (
                  <View style={styles.heroStatChip}>
                    <Ionicons name="wallet-outline" size={14} color={colors.onSurface} />
                    <Text style={styles.heroStatText}>Exp {fmtINR(summary?.today?.expenses || 0)}</Text>
                  </View>
                )}
              </View>
            </View>
          </SafeAreaView>
        </View>

        {/* Low stock alert */}
        {(summary?.low_stock || []).length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              testID="low-stock-alert"
              style={styles.lowStockCard}
              onPress={() => router.push('/manage/stock' as any)}
              activeOpacity={0.85}
            >
              <View style={styles.lowStockIcon}>
                <Ionicons name="alert-circle" size={22} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.lowStockTitle}>{summary.low_stock.length} item(s) low on stock</Text>
                <Text style={styles.lowStockSub} numberOfLines={1}>
                  {summary.low_stock.map((s: any) => s.name).slice(0, 3).join(', ')}
                  {summary.low_stock.length > 3 ? '...' : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.warning} />
            </TouchableOpacity>
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.grid}>
            {actions.map(a => (
              <TouchableOpacity
                key={a.key}
                testID={`quick-${a.key}`}
                style={styles.gridItem}
                onPress={() => router.push(a.route as any)}
                activeOpacity={0.85}
              >
                <View style={[styles.gridIcon, { backgroundColor: colors.brandTertiary }]}>
                  <Ionicons name={a.icon as any} size={26} color={a.color} />
                </View>
                <Text style={styles.gridLabel}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Month summary — admin only */}
        {isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>This Month</Text>
          <View style={styles.monthCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.monthLabel}>Revenue</Text>
              <Text style={styles.monthValue} testID="month-revenue">{fmtINR(summary?.month?.total || 0)}</Text>
              <Text style={styles.monthSub}>{summary?.month?.count || 0} bills · Exp {fmtINR(summary?.month?.expenses || 0)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.monthLabel}>Net Profit</Text>
              <Text style={[styles.monthValue, { color: (summary?.month?.net || 0) >= 0 ? colors.success : colors.error, fontSize: 20 }]} testID="month-net">
                {fmtINR(summary?.month?.net || 0)}
              </Text>
            </View>
          </View>
        </View>
        )}

        {/* Per beautician */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Performers (This Month)</Text>
          {(summary?.per_beautician_month || []).length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={32} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No sales yet this month</Text>
            </View>
          ) : (
            (summary?.per_beautician_month || []).slice(0, 5).map((b: any, i: number) => (
              <View key={b.name} style={styles.perfRow} testID={`perf-row-${i}`}>
                <View style={styles.perfAvatar}>
                  <Text style={styles.perfInitials}>{b.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.perfName}>{b.name}</Text>
                  <Text style={styles.perfBills}>
                    {b.bills} services{(b.tips || 0) > 0 ? ` · ${fmtINR(b.tips)} tips` : ''}
                  </Text>
                </View>
                <Text style={styles.perfAmount}>{fmtINR(b.amount)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  heroWrap: { height: 280, overflow: 'hidden' },
  heroContent: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.md },
  heroBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroLogoWrap: { width: 52, height: 56, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', ...shadows.card },
  heroLogo: { width: 44, height: 48 },
  heroBrandName: { color: colors.onSurface, fontSize: 20, fontWeight: '900', letterSpacing: 1.5 },
  heroBrandSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2, fontWeight: '600' },
  logoutBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(26,26,26,0.1)' },
  heroLabel: { color: 'rgba(26,26,26,0.65)', fontSize: 12, letterSpacing: 1, fontWeight: '700' },
  heroValue: { color: colors.onSurface, fontSize: 44, fontWeight: '900', marginTop: spacing.xs },
  heroStatsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  heroStatChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(26,26,26,0.08)' },
  heroStatText: { color: colors.onSurface, fontSize: 12, fontWeight: '700' },

  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.onSurface, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gridItem: {
    width: '47%', backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.md, ...shadows.card,
  },
  gridIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 15, fontWeight: '700', color: colors.onSurface },

  monthCard: {
    backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  monthLabel: { fontSize: 13, color: colors.onSurfaceTertiary },
  monthValue: { fontSize: 26, fontWeight: '800', color: colors.onSurface, marginTop: 4 },
  monthSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  monthIconWrap: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },

  perfRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  perfAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  perfInitials: { color: colors.brandPrimary, fontWeight: '800', fontSize: 13 },
  perfName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  perfBills: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  perfAmount: { fontSize: 15, fontWeight: '700', color: colors.success },

  emptyBox: { backgroundColor: colors.surfaceSecondary, padding: spacing.xl, borderRadius: radius.md, alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13 },

  lowStockCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: '#FDF3E4', borderWidth: 1, borderColor: '#F0DCA6',
    padding: spacing.md, borderRadius: radius.md, ...shadows.card,
  },
  lowStockIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(209,142,66,0.15)', alignItems: 'center', justifyContent: 'center' },
  lowStockTitle: { fontSize: 14, fontWeight: '700', color: colors.warning },
  lowStockSub: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
});
