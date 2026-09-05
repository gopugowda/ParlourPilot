import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Modal, TextInput, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAuth } from '@/src/context/AuthContext';
import { platformApi } from '@/src/api/client';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { useResponsive } from '@/src/hooks/use-responsive';
import { DesktopSidebar } from '@/src/components/DesktopSidebar';

type Tenant = any;

export default function PlatformScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const isSuperAdmin = user?.role === 'platform_admin';
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [subEditor, setSubEditor] = useState<{ tenant: Tenant | null; visible: boolean }>({ tenant: null, visible: false });
  const [extendDays, setExtendDays] = useState('30');
  const [busy, setBusy] = useState(false);

  // Password reset modal state
  const [pwdEditor, setPwdEditor] = useState<{ tenant: Tenant | null; visible: boolean }>({ tenant: null, visible: false });
  const [tenantUsers, setTenantUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  const openPwdEditor = async (tenant: Tenant) => {
    setPwdEditor({ tenant, visible: true });
    setNewPwd(''); setNewPwd2(''); setSelectedUserId(null);
    setTenantUsers([]);
    try {
      const res: any = await platformApi.listTenantUsers(tenant.id);
      const users = res?.users || [];
      setTenantUsers(users);
      // Prefer owner/admin as default
      const owner = users.find((u: any) => u.role === 'owner') || users.find((u: any) => u.role === 'admin') || users[0];
      if (owner) setSelectedUserId(owner.id);
    } catch (e: any) {
      Alert.alert('Failed to load users', e.message || String(e));
    }
  };

  const submitPasswordReset = async () => {
    if (!pwdEditor.tenant) return;
    if (!selectedUserId) { Alert.alert('Choose a user', 'Please select a user to reset password for'); return; }
    if (!newPwd || newPwd.length < 6) { Alert.alert('Weak password', 'Password must be at least 6 characters'); return; }
    if (newPwd !== newPwd2) { Alert.alert('Mismatch', 'Passwords do not match'); return; }
    setPwdBusy(true);
    try {
      const res: any = await platformApi.resetPassword(pwdEditor.tenant.id, {
        user_id: selectedUserId,
        new_password: newPwd,
      });
      Alert.alert('Password reset', `Password updated for ${res.email} (${res.role})`);
      setPwdEditor({ tenant: null, visible: false });
      setNewPwd(''); setNewPwd2('');
    } catch (e: any) {
      Alert.alert('Failed', e.message || String(e));
    } finally { setPwdBusy(false); }
  };

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

  // -------- Tenant lifecycle (Deactivate / Restore / Permanent Delete) ------
  // NOTE: All safety rules are enforced server-side; the mobile UI mirrors
  // them so a single tap can never destroy a tenant.
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);

  // Deactivate (suspend) — requires typed exact business name
  const [suspendModal, setSuspendModal] = useState<{ tenant: Tenant | null; visible: boolean }>({ tenant: null, visible: false });
  const [suspendTypedName, setSuspendTypedName] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const openSuspend = (tenant: Tenant) => {
    if (!isSuperAdmin) { Alert.alert('Restricted', 'Only super admins can change tenant status.'); return; }
    setSuspendTypedName(''); setSuspendReason('');
    setSuspendModal({ tenant, visible: true });
  };
  const submitSuspend = async () => {
    const t = suspendModal.tenant;
    if (!t) return;
    if (lifecycleBusyId === t.id) return; // double-submit guard
    setLifecycleBusyId(t.id);
    try {
      await platformApi.tenantStatus(t.id, {
        action: 'suspend',
        confirm_name: suspendTypedName.trim(),
        reason: suspendReason.trim() || undefined,
      });
      setSuspendModal({ tenant: null, visible: false });
      Alert.alert('Deactivated', `"${t.business_name}" has been deactivated. All data is preserved and can be restored anytime.`);
      await load();
    } catch (e: any) {
      Alert.alert('Failed', e.message || String(e));
    } finally { setLifecycleBusyId(null); }
  };

  // Restore
  const doRestore = (tenant: Tenant) => {
    if (!isSuperAdmin) { Alert.alert('Restricted', 'Only super admins can change tenant status.'); return; }
    Alert.alert(
      'Restore tenant?',
      `Restore "${tenant.business_name}"? This reactivates the tenant and restores user access. All existing data is preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore Tenant',
          onPress: async () => {
            if (lifecycleBusyId === tenant.id) return;
            setLifecycleBusyId(tenant.id);
            try {
              await platformApi.tenantStatus(tenant.id, { action: 'restore' });
              await load();
              Alert.alert('Restored', `"${tenant.business_name}" has been reactivated.`);
            } catch (e: any) {
              Alert.alert('Failed', e.message || String(e));
            } finally { setLifecycleBusyId(null); }
          },
        },
      ],
    );
  };

  // Permanent delete — multi-step
  const [deleteModal, setDeleteModal] = useState<{ tenant: Tenant | null; visible: boolean; step: 1 | 2 }>({ tenant: null, visible: false, step: 1 });
  const [deleteTypedName, setDeleteTypedName] = useState('');
  const [deleteTypedPhrase, setDeleteTypedPhrase] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const openDelete = (tenant: Tenant) => {
    if (!isSuperAdmin) { Alert.alert('Restricted', 'Only super admins can permanently delete tenants.'); return; }
    setDeleteTypedName(''); setDeleteTypedPhrase(''); setDeleteReason('');
    setDeleteModal({ tenant, visible: true, step: 1 });
  };
  const submitDelete = async () => {
    const t = deleteModal.tenant;
    if (!t) return;
    if (lifecycleBusyId === t.id) return;
    setLifecycleBusyId(t.id);
    try {
      await platformApi.deleteTenant(t.id, {
        confirm_name: deleteTypedName.trim(),
        confirm_phrase: deleteTypedPhrase.trim(),
        reason: deleteReason.trim() || undefined,
      });
      setDeleteModal({ tenant: null, visible: false, step: 1 });
      Alert.alert('Deleted', `"${t.business_name}" and all its data have been permanently deleted.`);
      await load();
    } catch (e: any) {
      Alert.alert('Delete failed', e.message || String(e));
    } finally { setLifecycleBusyId(null); }
  };

  const downloadCsvReport = async () => {
    setExporting(true);
    try {
      const res: any = await platformApi.exportCsv();
      const csv: string = res?.csv || '';
      const filename: string = res?.filename || `parlourpilot_tenants_${Date.now()}.csv`;
      if (!csv) {
        Alert.alert('Empty', 'No tenants to export');
        return;
      }
      if (Platform.OS === 'web') {
        // Web: trigger browser download
        try {
          const w: any = typeof window !== 'undefined' ? window : null;
          if (!w) throw new Error('No window');
          const blob = new w.Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = w.URL.createObjectURL(blob);
          const a = w.document.createElement('a');
          a.href = url; a.download = filename;
          w.document.body.appendChild(a);
          a.click();
          w.document.body.removeChild(a);
          w.URL.revokeObjectURL(url);
        } catch (e: any) {
          Alert.alert('Download failed', e.message || String(e));
        }
      } else {
        // Native (iOS/Android): use expo-file-system v19 File API, then share
        try {
          const file = new (FileSystem as any).File((FileSystem as any).Paths.cache, filename);
          try { file.create({ overwrite: true }); } catch {}
          file.write(csv);
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export Tenants CSV', UTI: 'public.comma-separated-values-text' });
          } else {
            Alert.alert('Saved', `CSV saved to ${file.uri}`);
          }
        } catch (e: any) {
          Alert.alert('Save failed', e.message || String(e));
        }
      }
    } catch (e: any) {
      Alert.alert('Export failed', e.message || String(e));
    } finally { setExporting(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <View style={isDesktop ? styles.desktopRow : { flex: 1 }}>
      {isDesktop && <DesktopSidebar mode="platform" />}
      <SafeAreaView style={isDesktop ? styles.desktopMainSA : { flex: 1, backgroundColor: colors.surface }}>
      <View style={isDesktop ? styles.desktopContent : ({ flex: 1 } as any)}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {!isDesktop && <Image source={require('../assets/images/parlourpilot-logo.png')} style={{ width: 32, height: 32 }} contentFit="contain" />}
          <View>
            <Text style={styles.brand}>{isDesktop ? 'Platform Dashboard' : 'ParlourPilot'}</Text>
            <Text style={styles.brandSub}>{isSuperAdmin ? 'Platform Admin' : 'Platform Staff'}</Text>
          </View>
        </View>
        {!isDesktop && (
          <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* Toolbar */}
        <View style={styles.toolbar}>
          <TouchableOpacity
            style={[styles.toolbarBtn, styles.toolbarPrimary]}
            onPress={downloadCsvReport}
            disabled={exporting}
            testID="btn-download-csv"
          >
            {exporting ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="download-outline" size={16} color="#fff" />
                <Text style={styles.toolbarPrimaryText}>Download Report</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toolbarBtn}
            onPress={() => router.push('/platform-users')}
            testID="btn-manage-users"
          >
            <Ionicons name="people-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.toolbarText}>{isSuperAdmin ? 'Manage Users' : 'View Users'}</Text>
          </TouchableOpacity>
        </View>
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
            {(stats.cancelled_pending ?? 0) > 0 && (
              <View style={[styles.statCard, { backgroundColor: '#FFF6E5', borderColor: '#F0DCA6' }]} testID="stat-cancelled-pending">
                <Text style={[styles.statNum, { color: '#A05B00' }]}>{stats.cancelled_pending}</Text>
                <Text style={[styles.statLabel, { color: '#A05B00' }]}>Cancelling</Text>
              </View>
            )}
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

        {isDesktop ? (
          <View style={styles.tableWrap} testID="tenants-table">
            <View style={styles.tableHeader}>
              <Text style={[styles.thCell, { flex: 2.2 }]}>Business</Text>
              <Text style={[styles.thCell, { flex: 2 }]}>Owner / Email</Text>
              <Text style={[styles.thCell, { flex: 1.2 }]}>Phone</Text>
              <Text style={[styles.thCell, { flex: 1.2 }]}>City</Text>
              <Text style={[styles.thCell, { width: 90 }]}>Status</Text>
              <Text style={[styles.thCell, { width: 80 }]}>Plan</Text>
              <Text style={[styles.thCell, { width: 70, textAlign: 'right' }]}>Days</Text>
              <Text style={[styles.thCell, { width: 60, textAlign: 'right' }]}>Users</Text>
              <Text style={[styles.thCell, { width: 60, textAlign: 'right' }]}>Bills</Text>
              <Text style={[styles.thCell, { width: 340 }]}>Actions</Text>
            </View>
            {tenants.map((t, idx) => {
              const sub = t.subscription || {};
              const statColor = statusColor(sub.status || 'trialing');
              return (
                <View key={t.id} style={[styles.tableRow, idx % 2 === 1 && { backgroundColor: '#FBF9F4' }]}>
                  <View style={{ flex: 2.2 }}>
                    <Text style={styles.tdStrong}>{t.business_name}</Text>
                    {t.city ? <Text style={styles.tdSub}>{t.city}{t.country ? ', ' + t.country : ''}</Text> : null}
                  </View>
                  <View style={{ flex: 2 }}>
                    <Text style={styles.tdText}>{t.owner_name || '—'}</Text>
                    <Text style={styles.tdSub}>{t.email}</Text>
                  </View>
                  <Text style={[styles.tdText, { flex: 1.2 }]}>{t.phone || '—'}</Text>
                  <Text style={[styles.tdText, { flex: 1.2 }]}>{t.city || '—'}</Text>
                  <View style={{ width: 90, alignSelf: 'flex-start', gap: 3 }}>
                    {t.is_active === false ? (
                      <View style={[styles.statusChip, { backgroundColor: '#FDECEC', borderColor: colors.error }]} testID={`suspended-badge-${t.id}`}>
                        <Text style={[styles.statusText, { color: colors.error }]}>SUSPENDED</Text>
                      </View>
                    ) : (
                      <View style={[styles.statusChip, { backgroundColor: `${statColor}20`, borderColor: statColor }]}>
                        <Text style={[styles.statusText, { color: statColor }]}>{(sub.status || '').toUpperCase()}</Text>
                      </View>
                    )}
                    {sub.cancellation_pending && (
                      <View style={[styles.statusChip, { backgroundColor: '#FFF6E5', borderColor: '#F0DCA6' }]} testID={`cancelled-badge-${t.id}`}>
                        <Text style={[styles.statusText, { color: '#A05B00' }]}>CANCELLING</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.tdText, { width: 80 }]}>{sub.subscription_plan || t.subscription_plan || 'trial'}</Text>
                  <Text style={[styles.tdText, { width: 70, textAlign: 'right', fontWeight: '700' }]}>{sub.days_left ?? '—'}</Text>
                  <Text style={[styles.tdText, { width: 60, textAlign: 'right' }]}>{t.user_count ?? 0}</Text>
                  <Text style={[styles.tdText, { width: 60, textAlign: 'right' }]}>{t.bills_count ?? 0}</Text>
                  <View style={{ width: 340, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => router.push({ pathname: '/tenant-detail', params: { tid: t.id } })} testID={`view-details-${t.id}`}>
                      <Ionicons name="eye-outline" size={13} color={colors.brandPrimary} />
                      <Text style={styles.actionText}>Details</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => { setSubEditor({ tenant: t, visible: true }); setExtendDays('30'); }}>
                      <Ionicons name="calendar-outline" size={13} color={colors.brandPrimary} />
                      <Text style={styles.actionText}>Extend</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openPwdEditor(t)} testID={`reset-pwd-${t.id}`}>
                      <Ionicons name="key-outline" size={13} color={colors.brandPrimary} />
                      <Text style={styles.actionText}>Reset</Text>
                    </TouchableOpacity>
                    {t.is_active === false ? (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionSuccess]}
                        onPress={() => doRestore(t)}
                        disabled={lifecycleBusyId === t.id}
                        testID={`restore-tenant-${t.id}`}
                      >
                        {lifecycleBusyId === t.id ? <ActivityIndicator color={colors.success} size="small" /> : (
                          <>
                            <Ionicons name="refresh-outline" size={13} color={colors.success} />
                            <Text style={[styles.actionText, { color: colors.success }]}>Restore</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionWarning]}
                        onPress={() => openSuspend(t)}
                        disabled={lifecycleBusyId === t.id}
                        testID={`suspend-tenant-${t.id}`}
                      >
                        <Ionicons name="pause-circle-outline" size={13} color="#A05B00" />
                        <Text style={[styles.actionText, { color: '#A05B00' }]}>Deactivate</Text>
                      </TouchableOpacity>
                    )}
                    {isSuperAdmin && (
                      <TouchableOpacity
                        style={styles.dangerIconBtn}
                        onPress={() => openDelete(t)}
                        disabled={lifecycleBusyId === t.id}
                        testID={`delete-tenant-${t.id}`}
                        accessibilityLabel="Permanently delete tenant"
                      >
                        <Ionicons name="trash-outline" size={13} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
            {tenants.length === 0 && (
              <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
                <Text style={{ color: colors.onSurfaceTertiary }}>No tenants yet.</Text>
              </View>
            )}
          </View>
        ) : (
          tenants.map(t => {
          const sub = t.subscription || {};
          const statColor = statusColor(sub.status || 'trialing');
          return (
            <View key={t.id} style={styles.tenantCard}>
              <View style={styles.tenantHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tenantName}>{t.business_name}</Text>
                  <Text style={styles.tenantEmail}>{t.email}</Text>
                </View>
                <View style={{ gap: 4, alignItems: 'flex-end' }}>
                  {t.is_active === false ? (
                    <View style={[styles.statusChip, { backgroundColor: '#FDECEC', borderColor: colors.error }]} testID={`suspended-badge-mobile-${t.id}`}>
                      <Text style={[styles.statusText, { color: colors.error }]}>SUSPENDED</Text>
                    </View>
                  ) : (
                    <View style={[styles.statusChip, { backgroundColor: `${statColor}20`, borderColor: statColor }]}>
                      <Text style={[styles.statusText, { color: statColor }]}>{(sub.status || '').toUpperCase()}</Text>
                    </View>
                  )}
                  {sub.cancellation_pending && (
                    <View style={[styles.statusChip, { backgroundColor: '#FFF6E5', borderColor: '#F0DCA6' }]} testID={`cancelled-badge-mobile-${t.id}`}>
                      <Text style={[styles.statusText, { color: '#A05B00' }]}>CANCELLING</Text>
                    </View>
                  )}
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
                  onPress={() => router.push({ pathname: '/tenant-detail', params: { tid: t.id } })}
                  testID={`view-details-${t.id}`}
                >
                  <Ionicons name="eye-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.actionText}>View Details</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => { setSubEditor({ tenant: t, visible: true }); setExtendDays('30'); }}
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.actionText}>Extend</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => openPwdEditor(t)}
                  testID={`reset-pwd-${t.id}`}
                >
                  <Ionicons name="key-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.actionText}>Reset Password</Text>
                </TouchableOpacity>
                {t.is_active === false ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionSuccess]}
                    onPress={() => doRestore(t)}
                    disabled={lifecycleBusyId === t.id}
                    testID={`restore-tenant-mobile-${t.id}`}
                  >
                    {lifecycleBusyId === t.id ? <ActivityIndicator color={colors.success} size="small" /> : (
                      <>
                        <Ionicons name="refresh-outline" size={16} color={colors.success} />
                        <Text style={[styles.actionText, { color: colors.success }]}>Restore</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionWarning]}
                    onPress={() => openSuspend(t)}
                    disabled={lifecycleBusyId === t.id}
                    testID={`suspend-tenant-mobile-${t.id}`}
                  >
                    <Ionicons name="pause-circle-outline" size={16} color="#A05B00" />
                    <Text style={[styles.actionText, { color: '#A05B00' }]}>Deactivate</Text>
                  </TouchableOpacity>
                )}
                {isSuperAdmin && (
                  <TouchableOpacity
                    style={styles.dangerIconBtn}
                    onPress={() => openDelete(t)}
                    disabled={lifecycleBusyId === t.id}
                    testID={`delete-tenant-mobile-${t.id}`}
                    accessibilityLabel="Permanently delete tenant"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })
        )}
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

      {/* Password Reset Modal */}
      <Modal visible={pwdEditor.visible} transparent animationType="slide" onRequestClose={() => setPwdEditor({ tenant: null, visible: false })}>
        <Pressable style={styles.backdrop} onPress={() => setPwdEditor({ tenant: null, visible: false })}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Reset User Password</Text>
              <Text style={styles.sheetSub}>{pwdEditor.tenant?.business_name}</Text>

              {/* User selector */}
              <View style={[styles.field, { maxHeight: 200 }]}>
                <Text style={styles.label}>Select User</Text>
                <ScrollView style={{ maxHeight: 160 }}>
                  {tenantUsers.map((u: any) => {
                    const sel = selectedUserId === u.id;
                    return (
                      <TouchableOpacity
                        key={u.id}
                        testID={`pwd-user-${u.id}`}
                        onPress={() => setSelectedUserId(u.id)}
                        style={[styles.userRow, sel && styles.userRowActive]}
                      >
                        <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={16} color={sel ? colors.brandPrimary : colors.onSurfaceTertiary} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.userRowName, sel && { color: colors.brandPrimary }]}>{u.name} <Text style={{ fontSize: 10, fontWeight: '600', color: colors.onSurfaceTertiary }}>· {(u.role || '').toUpperCase()}</Text></Text>
                          <Text style={styles.userRowMeta}>{u.email}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {tenantUsers.length === 0 && (
                    <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12 }}>Loading users…</Text>
                  )}
                </ScrollView>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>New Password (min 6 chars)</Text>
                <TextInput
                  value={newPwd}
                  onChangeText={setNewPwd}
                  secureTextEntry
                  style={styles.plainInput}
                  placeholder="•••••••"
                  autoCapitalize="none"
                  testID="pwd-new"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput
                  value={newPwd2}
                  onChangeText={setNewPwd2}
                  secureTextEntry
                  style={styles.plainInput}
                  placeholder="•••••••"
                  autoCapitalize="none"
                  testID="pwd-confirm"
                />
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <TouchableOpacity style={styles.btnGhost} onPress={() => setPwdEditor({ tenant: null, visible: false })}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={submitPasswordReset} disabled={pwdBusy} testID="pwd-submit">
                  {pwdBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Reset Password</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* ============ Deactivate (Suspend) Modal ============ */}
      <Modal
        visible={suspendModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setSuspendModal({ tenant: null, visible: false })}
      >
        <Pressable style={styles.backdrop} onPress={() => setSuspendModal({ tenant: null, visible: false })}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxHeight: '92%', alignSelf: 'center' }}>
            <Pressable style={[styles.sheet, { flexShrink: 1 }]} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Deactivate tenant</Text>
              <Text style={styles.sheetSub} numberOfLines={2}>
                Tenant: {suspendModal.tenant?.business_name}
              </Text>

              <View style={styles.warningBox} testID="deactivate-warning">
                <Ionicons name="alert-circle-outline" size={20} color="#A05B00" />
                <Text style={styles.warningText}>
                  This will prevent users from accessing this tenant but will NOT permanently delete any data. You can restore it anytime.
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Type the exact business name to confirm</Text>
                <TextInput
                  testID="suspend-confirm-name"
                  value={suspendTypedName}
                  onChangeText={setSuspendTypedName}
                  placeholder={suspendModal.tenant?.business_name || 'Business name'}
                  placeholderTextColor={colors.onSurfaceTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.plainInput}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Reason (optional)</Text>
                <TextInput
                  testID="suspend-reason"
                  value={suspendReason}
                  onChangeText={setSuspendReason}
                  placeholder="e.g. non-payment, requested by owner"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.plainInput}
                />
              </View>

              {(() => {
                const target = (suspendModal.tenant?.business_name || '').trim();
                const disabled = suspendTypedName.trim() !== target || !target || lifecycleBusyId === suspendModal.tenant?.id;
                return (
                  <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                    <TouchableOpacity style={styles.btnGhost} onPress={() => setSuspendModal({ tenant: null, visible: false })}>
                      <Text style={styles.btnGhostText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="suspend-submit"
                      style={[styles.btnWarning, { flex: 1 }, disabled && { opacity: 0.5 }]}
                      onPress={submitSuspend}
                      disabled={disabled}
                    >
                      {lifecycleBusyId === suspendModal.tenant?.id
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={styles.btnPrimaryText}>Deactivate Tenant</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })()}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* ============ Permanent Delete (multi-step) Modal ============ */}
      <Modal
        visible={deleteModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setDeleteModal({ tenant: null, visible: false, step: 1 })}
      >
        <Pressable style={styles.backdrop} onPress={() => setDeleteModal({ tenant: null, visible: false, step: 1 })}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxHeight: '92%', alignSelf: 'center' }}>
            <Pressable style={[styles.sheet, { flexShrink: 1 }]} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={[styles.sheetTitle, { color: colors.error }]}>Permanent delete</Text>
              <Text style={styles.sheetSub} numberOfLines={2}>
                Tenant: {deleteModal.tenant?.business_name}
              </Text>

              {deleteModal.step === 1 ? (
                <>
                  <View style={[styles.warningBox, styles.dangerBox]} testID="delete-warning-1">
                    <Ionicons name="warning-outline" size={22} color={colors.error} />
                    <Text style={[styles.warningText, { color: colors.error }]}>
                      This permanently deletes the tenant &ldquo;{deleteModal.tenant?.business_name}&rdquo; and ALL its data (users, bills, staff, customers, payroll, inventory, reports). This CANNOT be undone.
                      {'\n\n'}
                      Consider using <Text style={{ fontWeight: '900' }}>Deactivate</Text> instead — it hides the tenant but preserves data.
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                    <TouchableOpacity style={styles.btnGhost} onPress={() => setDeleteModal({ tenant: null, visible: false, step: 1 })}>
                      <Text style={styles.btnGhostText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="delete-continue"
                      style={[styles.btnDanger, { flex: 1 }]}
                      onPress={() => setDeleteModal(m => ({ ...m, step: 2 }))}
                    >
                      <Text style={styles.btnPrimaryText}>I understand, continue</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <View style={[styles.warningBox, styles.dangerBox]}>
                    <Ionicons name="lock-closed-outline" size={20} color={colors.error} />
                    <Text style={[styles.warningText, { color: colors.error }]}>
                      Two matching phrases are required. Both are re-validated on the server.
                    </Text>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>Type the exact business name</Text>
                    <TextInput
                      testID="delete-confirm-name"
                      value={deleteTypedName}
                      onChangeText={setDeleteTypedName}
                      placeholder={deleteModal.tenant?.business_name || 'Business name'}
                      placeholderTextColor={colors.onSurfaceTertiary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.plainInput}
                    />
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>Type <Text style={{ fontWeight: '900', color: colors.error }}>DELETE PERMANENTLY</Text> to confirm</Text>
                    <TextInput
                      testID="delete-confirm-phrase"
                      value={deleteTypedPhrase}
                      onChangeText={setDeleteTypedPhrase}
                      placeholder="DELETE PERMANENTLY"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      style={styles.plainInput}
                    />
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>Reason (optional)</Text>
                    <TextInput
                      testID="delete-reason"
                      value={deleteReason}
                      onChangeText={setDeleteReason}
                      placeholder="Why is this tenant being permanently deleted?"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      style={styles.plainInput}
                    />
                  </View>

                  {(() => {
                    const target = (deleteModal.tenant?.business_name || '').trim();
                    const nameOk = deleteTypedName.trim() === target && !!target;
                    const phraseOk = deleteTypedPhrase.trim() === 'DELETE PERMANENTLY';
                    const inFlight = lifecycleBusyId === deleteModal.tenant?.id;
                    const disabled = !nameOk || !phraseOk || inFlight;
                    return (
                      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                        <TouchableOpacity style={styles.btnGhost} onPress={() => setDeleteModal(m => ({ ...m, step: 1 }))}>
                          <Text style={styles.btnGhostText}>Back</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          testID="delete-submit"
                          style={[styles.btnDanger, { flex: 1 }, disabled && { opacity: 0.5 }]}
                          onPress={submitDelete}
                          disabled={disabled}
                        >
                          {inFlight
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={styles.btnPrimaryText}>Permanently Delete Tenant</Text>}
                        </TouchableOpacity>
                      </View>
                    );
                  })()}
                </>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
      </View>
    </SafeAreaView>
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
  tenantActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.brandSecondary,
  },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  actionWarning: { backgroundColor: '#FFF6E5', borderColor: '#F0DCA6' },
  actionSuccess: { backgroundColor: '#E7F5EA', borderColor: '#8BC79B' },
  dangerIconBtn: {
    width: 32, height: 32, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: colors.error,
  },
  warningBox: {
    flexDirection: 'row', gap: 10,
    backgroundColor: '#FFF6E5', borderColor: '#F0DCA6', borderWidth: 1,
    borderRadius: radius.sm, padding: 12,
  },
  dangerBox: { backgroundColor: '#FEE2E2', borderColor: colors.error },
  warningText: { flex: 1, fontSize: 12, color: '#A05B00', fontWeight: '600', lineHeight: 17 },
  btnWarning: { backgroundColor: '#F59E0B', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', ...shadows.card },
  btnDanger: { backgroundColor: colors.error, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', ...shadows.card },

  toolbar: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  toolbarBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FFFFFF', paddingHorizontal: spacing.md, paddingVertical: 12,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  toolbarPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  toolbarText: { fontSize: 13, fontWeight: '700', color: colors.brandPrimary },
  toolbarPrimaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
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
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 6 },
  userRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  userRowName: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  userRowMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  // Desktop layout
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

  // Table styles (desktop tenant list)
  tableWrap: { backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.brandPrimary },
  thCell: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider, minHeight: 56 },
  tdStrong: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  tdText: { fontSize: 12, color: colors.onSurface },
  tdSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
});
