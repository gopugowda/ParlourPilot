import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Modal, TextInput, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { platformApi } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

type Tenant = any;

export default function PlatformScreen() {
  const { user, logout } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [subEditor, setSubEditor] = useState<{ tenant: Tenant | null; visible: boolean }>({ tenant: null, visible: false });
  const [extendDays, setExtendDays] = useState('30');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([platformApi.tenants(), platformApi.stats()]);
      setTenants(t as any);
      setStats(s);
    } catch (e: any) {
      Alert.alert('Failed to load', e.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusColor = (s: string) =>
    s === 'active' ? colors.success :
    s === 'trialing' ? colors.warning :
    s === 'expired' ? colors.error :
    colors.info;

  const submitSubUpdate = async () => {
    if (!subEditor.tenant) return;
    setBusy(true);
    try {
      const d = parseInt(extendDays, 10);
      await platformApi.setSubscription(subEditor.tenant.id, {
        extend_days: isFinite(d) && d > 0 ? d : undefined,
        subscription_status: 'active',
      });
      setSubEditor({ tenant: null, visible: false });
      await load();
    } catch (e: any) {
      Alert.alert('Failed', e.message || String(e));
    } finally { setBusy(false); }
  };

  const toggleActive = async (tenant: Tenant) => {
    try {
      await platformApi.setSubscription(tenant.id, { is_active: !tenant.is_active });
      await load();
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Image source={require('../assets/images/parlourpilot-logo.png')} style={{ width: 32, height: 32 }} contentFit="contain" />
          <View>
            <Text style={styles.brand}>ParlourPilot</Text>
            <Text style={styles.brandSub}>Platform Admin</Text>
          </View>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* Stats */}
        {stats && (
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.tenants}</Text>
              <Text style={styles.statLabel}>Total Tenants</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.active_tenants}</Text>
              <Text style={styles.statLabel}>Active/Trial</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.expired_tenants}</Text>
              <Text style={styles.statLabel}>Expired</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.users}</Text>
              <Text style={styles.statLabel}>Users</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.bills}</Text>
              <Text style={styles.statLabel}>Bills</Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>Tenants ({tenants.length})</Text>

        {tenants.map(t => {
          const sub = t.subscription || {};
          const statColor = statusColor(sub.status || 'trialing');
          return (
            <View key={t.id} style={styles.tenantCard}>
              <View style={styles.tenantHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tenantName}>{t.business_name}</Text>
                  <Text style={styles.tenantEmail}>{t.email}</Text>
                </View>
                <View style={[styles.statusChip, { backgroundColor: `${statColor}20`, borderColor: statColor }]}>
                  <Text style={[styles.statusText, { color: statColor }]}>{(sub.status || '').toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.tenantMetaRow}>
                <MetaCol label="Users" val={t.user_count ?? 0} />
                <MetaCol label="Bills" val={t.bills_count ?? 0} />
                <MetaCol label="Plan" val={sub.subscription_plan || t.subscription_plan || '—'} />
                <MetaCol label="Days Left" val={sub.days_left ?? '—'} />
              </View>

              <View style={styles.tenantActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => { setSubEditor({ tenant: t, visible: true }); setExtendDays('30'); }}
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.actionText}>Extend</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, !t.is_active && { backgroundColor: '#FEE' }]}
                  onPress={() => toggleActive(t)}
                >
                  <Ionicons name={t.is_active ? 'lock-open-outline' : 'lock-closed-outline'} size={16} color={t.is_active ? colors.success : colors.error} />
                  <Text style={[styles.actionText, { color: t.is_active ? colors.success : colors.error }]}>
                    {t.is_active ? 'Active' : 'Suspended'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Subscription Editor Modal */}
      <Modal visible={subEditor.visible} transparent animationType="slide" onRequestClose={() => setSubEditor({ tenant: null, visible: false })}>
        <Pressable style={styles.backdrop} onPress={() => setSubEditor({ tenant: null, visible: false })}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Extend Subscription</Text>
              <Text style={styles.sheetSub}>{subEditor.tenant?.business_name}</Text>

              <View style={styles.field}>
                <Text style={styles.label}>Extend by (days)</Text>
                <TextInput
                  value={extendDays}
                  onChangeText={setExtendDays}
                  keyboardType="numeric"
                  style={styles.plainInput}
                  placeholder="30"
                />
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <TouchableOpacity style={styles.btnGhost} onPress={() => setSubEditor({ tenant: null, visible: false })}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={submitSubUpdate} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Extend & Activate</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </SafeAreaView>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  brand: { fontSize: 16, fontWeight: '900', color: colors.brandPrimary },
  brandSub: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 1 },
  logoutBtn: { padding: 8 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  statCard: {
    flex: 1, minWidth: '30%', backgroundColor: '#FFFFFF', padding: spacing.md,
    borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  statNum: { fontSize: 22, fontWeight: '900', color: colors.brandPrimary },
  statLabel: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4, fontWeight: '600' },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurfaceSecondary, marginBottom: spacing.md, marginTop: spacing.md },

  tenantCard: {
    backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  tenantHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tenantName: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  tenantEmail: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  statusChip: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  tenantMetaRow: { flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  metaLabel: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '600', textTransform: 'uppercase' },
  metaVal: { fontSize: 13, color: colors.onSurface, fontWeight: '700', marginTop: 2 },
  tenantActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.brandSecondary,
  },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  sheetSub: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },
  field: { gap: spacing.sm },
  label: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: '600' },
  plainInput: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 15, color: colors.onSurface },
  btnPrimary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', ...shadows.card },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnGhost: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 15 },
});
