import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { platformApi } from '@/src/api/client';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { useResponsive } from '@/src/hooks/use-responsive';
import { DesktopSidebar } from '@/src/components/DesktopSidebar';

export default function TenantDetailScreen() {
  const { tid } = useLocalSearchParams<{ tid?: string }>();
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    if (!tid) return;
    try {
      const res: any = await platformApi.tenantDetail(String(tid));
      setData(res);
    } catch (e: any) {
      Alert.alert('Failed to load', e.message || String(e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [tid]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </SafeAreaView>
    );
  }

  const tenant = data?.tenant || {};
  const branches = data?.branches || [];
  const history = data?.subscription_history || [];
  const sub = tenant.subscription || {};
  const statusColor = sub.status === 'active' ? colors.success
    : sub.status === 'trialing' ? colors.warning
    : sub.status === 'expired' ? colors.error : colors.info;

  return (
    <View style={isDesktop ? styles.desktopRow : { flex: 1 }}>
      {isDesktop && <DesktopSidebar mode="platform" />}
      <SafeAreaView style={isDesktop ? styles.desktopMainSA : { flex: 1, backgroundColor: colors.surface }}>
      <View style={isDesktop ? styles.desktopContent : ({ flex: 1 } as any)}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="btn-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Tenant Details</Text>
          <Text style={styles.headerSub}>{tenant.business_name}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* Business Info */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="business-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>Business Info</Text>
            <View style={[styles.statusChip, { backgroundColor: `${statusColor}20`, borderColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{(sub.status || '').toUpperCase()}</Text>
            </View>
          </View>
          <View style={styles.infoList}>
            <InfoRow label="Business Name" value={tenant.business_name} />
            <InfoRow label="Owner" value={tenant.owner_name} />
            <InfoRow label="Email" value={tenant.email} />
            <InfoRow label="Phone" value={tenant.phone || '—'} />
            <InfoRow label="City" value={`${tenant.city || '—'}${tenant.country ? ', ' + tenant.country : ''}`} />
            <InfoRow label="Plan" value={sub.subscription_plan || tenant.subscription_plan || 'trial'} />
            <InfoRow label="Days Left" value={String(sub.days_left ?? '—')} />
            <InfoRow label="Sub End" value={(sub.subscription_end_date || sub.trial_end_date || '').slice(0, 10) || '—'} />
          </View>
          <View style={styles.metaRow}>
            <MetaCol label="Users" val={tenant.user_count ?? 0} />
            <MetaCol label="Bills" val={tenant.bills_count ?? 0} />
            <MetaCol label="Branches" val={branches.length} />
          </View>
        </View>

        {/* Subscription History */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="time-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>Subscription History</Text>
            <View style={styles.countPill}><Text style={styles.countPillText}>{history.length}</Text></View>
          </View>
          {history.length === 0 && (
            <Text style={styles.emptyText}>No history yet.</Text>
          )}
          {history.map((h: any, idx: number) => (
            <View key={`${h.type}-${idx}`} style={styles.historyRow}>
              <View style={[styles.historyDot, { backgroundColor: iconColor(h.type) }]}>
                <Ionicons name={iconName(h.type) as any} size={12} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyTitle}>{humanType(h.type)}</Text>
                <Text style={styles.historyDetail}>{h.details}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                  <Text style={styles.historyMeta}>{(h.date || '').slice(0, 10)}</Text>
                  {h.actor && <Text style={styles.historyMeta}>· by {h.actor}</Text>}
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Branches */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="storefront-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>Branches</Text>
            <View style={styles.countPill}><Text style={styles.countPillText}>{branches.length}</Text></View>
          </View>
          {branches.length === 0 && <Text style={styles.emptyText}>No branches yet.</Text>}
          {branches.map((b: any) => {
            const addr = [b.address, b.city, b.state, b.postal_code, b.country].filter(Boolean).join(', ');
            return (
              <View key={b.id} style={styles.branchRow}>
                <View style={styles.branchIconWrap}>
                  <Ionicons name={b.is_head ? 'star' : 'business'} size={16} color={b.is_head ? '#D18E42' : colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={styles.branchName}>{b.name}</Text>
                    {b.is_head && <Text style={styles.headTag}>HEAD</Text>}
                    {!b.active && <Text style={styles.inactiveTag}>INACTIVE</Text>}
                  </View>
                  {!!addr && <Text style={styles.branchAddr}>{addr}</Text>}
                  <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: 4, flexWrap: 'wrap' }}>
                    {!!b.phone && <Text style={styles.branchMeta}>📞 {b.phone}</Text>}
                    {!!b.email && <Text style={styles.branchMeta}>✉️ {b.email}</Text>}
                    {!!b.subscription_plan && <Text style={styles.branchMeta}>💳 {b.subscription_plan}</Text>}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
      </View>
    </SafeAreaView>
    </View>
  );
}

function iconName(t: string) {
  if (t === 'trial_started') return 'gift-outline';
  if (t === 'payment') return 'card-outline';
  return 'refresh-outline';
}
function iconColor(t: string) {
  if (t === 'trial_started') return colors.warning;
  if (t === 'payment') return colors.success;
  return colors.brandPrimary;
}
function humanType(t: string) {
  if (t === 'trial_started') return 'Trial Started';
  if (t === 'payment') return 'Payment Received';
  if (t === 'subscription_updated') return 'Subscription Updated';
  return t.replace(/_/g, ' ');
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
  );
}

function MetaCol({ label, val }: { label: string; val: any }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaVal}>{String(val)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopRow: {
    flex: 1, flexDirection: 'row',
    ...(Platform.OS === 'web' ? ({ height: '100vh' as any }) : {}),
  } as any,
  desktopMainSA: {
    flex: 1, backgroundColor: colors.surface,
    ...(Platform.OS === 'web' ? ({ overflowY: 'auto' as any, height: '100vh' as any }) : {}),
  } as any,
  desktopContent: {
    flex: 1, width: '100%', maxWidth: 1200, alignSelf: 'center',
  } as any,
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.onSurfaceTertiary },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.onSurface },
  countPill: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  countPillText: { fontSize: 11, color: colors.brandPrimary, fontWeight: '800' },
  statusChip: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  infoList: { alignSelf: 'center', width: '100%', maxWidth: 560 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  infoLabel: { width: 140, fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  infoValue: { flex: 1, fontSize: 13, color: colors.onSurface, fontWeight: '600', textAlign: 'right' },

  metaRow: { flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  metaLabel: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '600', textTransform: 'uppercase' },
  metaVal: { fontSize: 15, color: colors.onSurface, fontWeight: '800', marginTop: 2 },

  emptyText: { fontSize: 12, color: colors.onSurfaceTertiary, fontStyle: 'italic', paddingVertical: spacing.sm },

  historyRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  historyDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  historyTitle: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  historyDetail: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  historyMeta: { fontSize: 11, color: colors.onSurfaceTertiary },

  branchRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  branchIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  branchName: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  branchAddr: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  branchMeta: { fontSize: 11, color: colors.onSurfaceTertiary },
  headTag: { fontSize: 9, fontWeight: '900', color: '#D18E42', backgroundColor: '#FFF3E0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, letterSpacing: 1 },
  inactiveTag: { fontSize: 9, fontWeight: '900', color: colors.error, backgroundColor: '#FEE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, letterSpacing: 1 },
});
