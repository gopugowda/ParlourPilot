import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
  Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api, appointmentApi } from '@/src/api/client';
import { useAuth, useBrand, PermissionKey } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import StaffDashboard from '@/src/components/StaffDashboard';

const LOGO = require('../../assets/images/parlourpilot-logo.png');

// Thin dispatcher — routes staff-role non-owners to the Staff Dashboard, everyone
// else to the existing owner/admin management dashboard. Kept as a wrapper so that
// each inner component owns its own hook order (React rules of hooks).
export default function DashboardScreen() {
  const { user } = useAuth();
  if (user && user.role === 'staff' && !user.is_owner) {
    return <StaffDashboard />;
  }
  return <OwnerDashboard />;
}

function OwnerDashboard() {
  const { user, tenant, subscription, branches, currentBranchId, selectBranch, logout, refreshTenant, refreshBranches, can, firstAccessibleRoute } = useAuth();
  const { brandColor, brandTextColor } = useBrand();
  // Compute a darker shade for the hero gradient
  const hexToRgb = (h: string) => { const n = parseInt(h.replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };
  const shade = (h: string, f: number) => {
    const { r, g, b } = hexToRgb(h);
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
    return `#${[c(r), c(g), c(b)].map(x => x.toString(16).padStart(2, '0')).join('')}`;
  };
  const brandDark = shade(brandColor, -0.35);
  const brandLight = shade(brandColor, 0.15);
  const router = useRouter();
  const [summary, setSummary] = useState<any>(null);
  const [aptStats, setAptStats] = useState<{ today: number; week: number; upcoming: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const [data, apts] = await Promise.all([
        api('/reports/summary'),
        appointmentApi.stats().catch(() => null),
        // Refresh tenant + branches so logo/brand changes from web app propagate.
        refreshTenant().catch(() => null),
        refreshBranches().catch(() => null),
      ]);
      setSummary(data);
      setAptStats(apts as any);
    } catch {}
  };

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));
  // Refetch when branch selection changes
  useEffect(() => { load(); }, [currentBranchId]);

  // Redirect if the user lacks 'reports' — they shouldn't land here.
  useEffect(() => {
    if (!user) return;
    if (!can('reports')) {
      const first = firstAccessibleRoute();
      if (first && first !== '/(tabs)') router.replace(first as any);
    }
  }, [user, can, firstAccessibleRoute, router]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

  // Compute effective logo: current branch's logo → tenant logo → app default
  const currentBranch = branches.find(b => b.id === currentBranchId);
  const effectiveLogoUri = currentBranch?.logo || tenant?.logo || null;

  const adminActions = [
    { key: 'new', label: 'New Bill', icon: 'add-circle', route: '/(tabs)/new-bill', color: colors.brandPrimary, perm: 'new_bill' as PermissionKey },
    { key: 'hist', label: 'History', icon: 'receipt', route: '/(tabs)/history', color: colors.success, perm: 'bills' as PermissionKey },
    { key: 'srv', label: 'Services', icon: 'pricetags', route: '/manage/services', color: colors.warning, perm: 'services' as PermissionKey },
    { key: 'team', label: 'Team', icon: 'people', route: '/manage/beauticians', color: colors.info },
  ];
  const staffActions = [
    { key: 'new', label: 'New Bill', icon: 'add-circle', route: '/(tabs)/new-bill', color: colors.brandPrimary, perm: 'new_bill' as PermissionKey },
    { key: 'hist', label: "Today's Bills", icon: 'receipt', route: '/(tabs)/history', color: colors.success, perm: 'bills' as PermissionKey },
    { key: 'report', label: 'Daily Report', icon: 'bar-chart', route: '/manage/report', color: colors.warning, perm: 'reports' as PermissionKey },
  ];
  const actions = (isAdmin ? adminActions : staffActions).filter(a => !a.perm || can(a.perm));

  return (
    <View style={styles.root} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {/* Hero */}
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={[brandDark, brandColor, brandLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={['top']} style={styles.heroContent}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroBrand}>
                <View style={styles.heroLogoWrap}>
                  <Image
                    source={effectiveLogoUri ? { uri: effectiveLogoUri } : LOGO}
                    style={styles.heroLogo}
                    contentFit="contain"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.heroBrandName, { color: brandTextColor }]} numberOfLines={1}>
                    {tenant?.business_name || 'ParlourPilot'}
                  </Text>
                  <Text style={[styles.heroBrandSub, { color: brandTextColor, opacity: 0.85 }]}>
                    Hi, {user?.name?.split(' ')[0] || 'there'}
                    {subscription?.status === 'trialing' && subscription?.days_left !== null && subscription?.days_left !== undefined
                      ? `  · ${subscription.days_left}d trial left`
                      : ''}
                  </Text>
                  {branches.length > 0 && isAdmin && can('multi_branch') && (
                    <TouchableOpacity
                      testID="branch-switcher"
                      onPress={() => setShowBranchPicker(true)}
                      style={styles.branchSwitcher}
                    >
                      <Ionicons name="business-outline" size={12} color={brandTextColor} />
                      <Text style={[styles.branchSwitcherText, { color: brandTextColor }]} numberOfLines={1}>
                        {branches.find(b => b.id === currentBranchId)?.name || 'All Branches'}
                      </Text>
                      <Ionicons name="chevron-down" size={12} color={brandTextColor} />
                    </TouchableOpacity>
                  )}
                  {branches.length > 0 && (!isAdmin || !can('multi_branch')) && currentBranchId && (
                    <View style={styles.branchStatic}>
                      <Ionicons name="business-outline" size={11} color={brandTextColor} />
                      <Text style={[styles.branchSwitcherText, { color: brandTextColor }]} numberOfLines={1}>
                        {branches.find(b => b.id === currentBranchId)?.name || ''}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <TouchableOpacity testID="logout-btn" onPress={logout} style={styles.logoutBtn}>
                <Ionicons name="log-out-outline" size={20} color={brandTextColor} />
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: spacing.xl }}>
              <Text style={[styles.heroLabel, { color: brandTextColor, opacity: 0.85 }]}>{"Today's Revenue"}</Text>
              {loading ? (
                <ActivityIndicator color={brandTextColor} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} />
              ) : (
                <Text style={[styles.heroValue, { color: brandTextColor }]} testID="today-revenue">{fmtINR(summary?.today?.total || 0)}</Text>
              )}
              <View style={styles.heroStatsRow}>
                <View style={[styles.heroStatChip, { backgroundColor: brandTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)' }]}>
                  <Ionicons name="receipt-outline" size={14} color={brandTextColor} />
                  <Text style={[styles.heroStatText, { color: brandTextColor }]}>{summary?.today?.count || 0} bills</Text>
                </View>
                <View style={[styles.heroStatChip, { backgroundColor: brandTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)' }]}>
                  <Ionicons name="cash-outline" size={14} color={brandTextColor} />
                  <Text style={[styles.heroStatText, { color: brandTextColor }]}>{fmtINR(summary?.today?.cash || 0)}</Text>
                </View>
                <View style={[styles.heroStatChip, { backgroundColor: brandTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)' }]}>
                  <Ionicons name="qr-code-outline" size={14} color={brandTextColor} />
                  <Text style={[styles.heroStatText, { color: brandTextColor }]}>{fmtINR(summary?.today?.qr || 0)}</Text>
                </View>
                {(summary?.today?.tips || 0) > 0 && (
                  <View style={[styles.heroStatChip, { backgroundColor: brandTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)' }]}>
                    <Ionicons name="heart-outline" size={14} color={brandTextColor} />
                    <Text style={[styles.heroStatText, { color: brandTextColor }]}>Tips {fmtINR(summary?.today?.tips || 0)}</Text>
                  </View>
                )}
                {(summary?.today?.expenses || 0) > 0 && (
                  <View style={[styles.heroStatChip, { backgroundColor: brandTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)' }]}>
                    <Ionicons name="wallet-outline" size={14} color={brandTextColor} />
                    <Text style={[styles.heroStatText, { color: brandTextColor }]}>Exp {fmtINR(summary?.today?.expenses || 0)}</Text>
                  </View>
                )}
              </View>
            </View>
          </SafeAreaView>
        </View>

        {/* Expiring members alert — admin only */}
        {isAdmin && (summary?.expiring_members || []).length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              testID="expiring-members-alert"
              style={styles.expMemCard}
              onPress={() => router.push('/manage/members?filter=expiring' as any)}
              activeOpacity={0.85}
            >
              <View style={styles.expMemIcon}>
                <Ionicons name="star" size={22} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.expMemTitle}>
                  {summary.expiring_members.length} member{summary.expiring_members.length > 1 ? 's' : ''} expiring / expired
                </Text>
                <Text style={styles.expMemSub} numberOfLines={1}>
                  {summary.expiring_members.slice(0, 3).map((m: any) => `${m.name}${m.days_left != null && m.days_left >= 0 ? ` (${m.days_left}d)` : ' (expired)'}`).join(', ')}
                  {summary.expiring_members.length > 3 ? '...' : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.brandPrimary} />
            </TouchableOpacity>
          </View>
        )}

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

        {/* Schedule (appointments) widget */}
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.sectionTitle}>Schedule</Text>
            <TouchableOpacity onPress={() => router.push('/manage/appointments' as any)} testID="view-schedule">
              <Text style={styles.linkText}>View all →</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.aptCard}>
            <View style={styles.aptStatRow}>
              <TouchableOpacity style={styles.aptStat} onPress={() => router.push('/manage/appointments' as any)} activeOpacity={0.85}>
                <Ionicons name="today-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.aptStatNum}>{aptStats?.today ?? 0}</Text>
                <Text style={styles.aptStatLabel}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.aptStat} onPress={() => router.push('/manage/appointments' as any)} activeOpacity={0.85}>
                <Ionicons name="calendar-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.aptStatNum}>{aptStats?.week ?? 0}</Text>
                <Text style={styles.aptStatLabel}>Next 7d</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.aptAddBtn} onPress={() => router.push('/manage/appointments' as any)} testID="dashboard-new-apt">
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.aptAddText}>New</Text>
              </TouchableOpacity>
            </View>
            {(aptStats?.upcoming || []).length > 0 ? (
              <View style={{ marginTop: spacing.md, gap: 6 }}>
                {aptStats!.upcoming.slice(0, 3).map((a: any) => {
                  const t = (() => { try { return new Date(a.scheduled_start).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return a.scheduled_start; } })();
                  return (
                    <TouchableOpacity key={a.id} style={styles.upcomingRow} onPress={() => router.push('/manage/appointments' as any)} activeOpacity={0.85}>
                      <Text style={styles.upcomingTime}>{t}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.upcomingName} numberOfLines={1}>{a.customer_name}</Text>
                        <Text style={styles.upcomingMeta} numberOfLines={1}>
                          {a.beautician_name || 'Any staff'}
                          {a.service_names && a.service_names.length > 0 ? ` · ${a.service_names.join(', ')}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.aptEmpty}>No upcoming appointments — tap New to book one.</Text>
            )}
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

      {/* Branch Picker Modal */}
      <Modal visible={showBranchPicker} transparent animationType="fade" onRequestClose={() => setShowBranchPicker(false)}>
        <Pressable style={brancherStyles.backdrop} onPress={() => setShowBranchPicker(false)}>
          <Pressable style={brancherStyles.sheet} onPress={() => {}}>
            <Text style={brancherStyles.title}>Switch Branch</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              <TouchableOpacity
                style={[brancherStyles.item, currentBranchId === null && brancherStyles.itemActive]}
                onPress={async () => { await selectBranch(null); setShowBranchPicker(false); }}
              >
                <Ionicons name="globe-outline" size={18} color={colors.brandPrimary} />
                <Text style={brancherStyles.itemName}>All Branches (Aggregate)</Text>
                {currentBranchId === null && <Ionicons name="checkmark" size={18} color={colors.brandPrimary} />}
              </TouchableOpacity>
              {branches.map(b => (
                <TouchableOpacity
                  key={b.id}
                  style={[brancherStyles.item, currentBranchId === b.id && brancherStyles.itemActive]}
                  onPress={async () => { await selectBranch(b.id); setShowBranchPicker(false); }}
                >
                  <Ionicons name="business-outline" size={18} color={colors.brandPrimary} />
                  <View style={{ flex: 1 }}>
                    <Text style={brancherStyles.itemName}>{b.name}</Text>
                    {b.is_head && <Text style={brancherStyles.itemBadge}>HEAD BRANCH</Text>}
                  </View>
                  {currentBranchId === b.id && <Ionicons name="checkmark" size={18} color={colors.brandPrimary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => router.push('/manage/branches')} style={brancherStyles.manageBtn}>
              <Ionicons name="settings-outline" size={16} color={colors.brandPrimary} />
              <Text style={brancherStyles.manageText}>Manage Branches</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const brancherStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  sheet: { width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 16, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  itemActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary },
  itemName: { fontSize: 14, fontWeight: '600', color: colors.onSurface, flex: 1 },
  itemBadge: { fontSize: 9, fontWeight: '900', color: colors.brandPrimary, letterSpacing: 0.5 },
  manageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.brandTertiary },
  manageText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 13 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  heroWrap: { minHeight: 260, overflow: 'hidden', position: 'relative' },
  heroContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.md },
  heroBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  heroLogoWrap: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', padding: 4,
  },
  heroLogo: { width: 38, height: 38 },
  heroBrandName: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 0.3 },
  heroBrandSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2, fontWeight: '600' },
  branchSwitcher: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6, alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    maxWidth: 200,
  },
  branchStatic: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start' },
  branchSwitcherText: { color: '#fff', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  logoutBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  heroLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 12, letterSpacing: 1, fontWeight: '700' },
  heroValue: { color: '#FFFFFF', fontSize: 44, fontWeight: '900', marginTop: spacing.xs },
  heroStatsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  heroStatChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  heroStatText: { color: '#fff', fontSize: 12, fontWeight: '700' },

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

  expMemCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary,
    padding: spacing.md, borderRadius: radius.md, ...shadows.card,
  },
  expMemIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(184,138,60,0.15)', alignItems: 'center', justifyContent: 'center' },
  expMemTitle: { fontSize: 14, fontWeight: '700', color: colors.brandPrimary },
  expMemSub: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  linkText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  aptCard: { backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm, ...shadows.card },
  aptStatRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  aptStat: { flex: 1, alignItems: 'center', backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingVertical: 10, gap: 2 },
  aptStatNum: { fontSize: 22, fontWeight: '900', color: colors.brandPrimary },
  aptStatLabel: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 0.5 },
  aptAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  aptAddText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  aptEmpty: { textAlign: 'center', color: colors.onSurfaceTertiary, fontSize: 12, marginTop: spacing.md },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: 8, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm },
  upcomingTime: { fontSize: 11, fontWeight: '800', color: colors.brandPrimary, minWidth: 90 },
  upcomingName: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  upcomingMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
});
