import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
  RefreshControl, TextInput, Modal, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { platformApi } from '@/src/api/client';
import { colors, spacing, radius, shadows } from '@/src/theme';

type PUser = {
  id: string;
  name: string;
  email: string;
  role: 'platform_admin' | 'platform_staff';
  is_active?: boolean;
  created_at?: string;
};

export default function PlatformUsersScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const isSuperAdmin = user?.role === 'platform_admin';
  const [users, setUsers] = useState<PUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'platform_staff' as 'platform_admin' | 'platform_staff' });
  const [busy, setBusy] = useState(false);

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<PUser | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res: any = await platformApi.listPlatformUsers();
      setUsers(res?.users || []);
    } catch (e: any) {
      Alert.alert('Failed', e.message || String(e));
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitCreate = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      Alert.alert('Missing', 'Please fill name, email and password'); return;
    }
    if (form.password.length < 6) { Alert.alert('Weak password', 'Min 6 chars'); return; }
    setBusy(true);
    try {
      await platformApi.createPlatformUser({
        name: form.name.trim(), email: form.email.trim().toLowerCase(),
        password: form.password, role: form.role,
      });
      setShowCreate(false); setForm({ name: '', email: '', password: '', role: 'platform_staff' });
      await load();
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
    finally { setBusy(false); }
  };

  const toggleRole = async (u: PUser) => {
    if (!isSuperAdmin) return;
    const newRole = u.role === 'platform_admin' ? 'platform_staff' : 'platform_admin';
    try {
      await platformApi.updatePlatformUser(u.id, { role: newRole });
      await load();
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
  };

  const toggleActive = async (u: PUser) => {
    if (!isSuperAdmin) return;
    try {
      await platformApi.updatePlatformUser(u.id, { is_active: !u.is_active });
      await load();
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
  };

  const confirmDelete = (u: PUser) => {
    if (!isSuperAdmin) return;
    if (u.id === user?.id) { Alert.alert('Not allowed', 'Cannot delete your own account'); return; }
    Alert.alert('Delete User?', `Remove "${u.name}" (${u.email})?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await platformApi.deletePlatformUser(u.id); await load(); }
        catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
      } },
    ]);
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    if (newPwd.length < 6) { Alert.alert('Weak password', 'Min 6 chars'); return; }
    if (newPwd !== newPwd2) { Alert.alert('Mismatch', 'Passwords do not match'); return; }
    setResetBusy(true);
    try {
      await platformApi.resetPlatformUserPassword(resetTarget.id, newPwd);
      Alert.alert('Password reset', `Password updated for ${resetTarget.email}`);
      setResetTarget(null); setNewPwd(''); setNewPwd2('');
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
    finally { setResetBusy(false); }
  };

  if (loading) {
    return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Platform Users</Text>
          <Text style={styles.headerSub}>{isSuperAdmin ? 'Manage admin/staff accounts' : 'View only'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {isSuperAdmin && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)} testID="btn-add-platform-user">
            <Ionicons name="person-add-outline" size={18} color="#fff" />
            <Text style={styles.addBtnText}>New Platform User</Text>
          </TouchableOpacity>
        )}

        {users.map(u => {
          const isMe = u.id === user?.id;
          const isAdmin = u.role === 'platform_admin';
          return (
            <View key={u.id} style={styles.userCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={[styles.avatar, isAdmin ? styles.avatarAdmin : styles.avatarStaff]}>
                  <Ionicons name={isAdmin ? 'shield-checkmark' : 'person'} size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={styles.userName}>{u.name}</Text>
                    {isMe && <Text style={styles.meTag}>YOU</Text>}
                    {u.is_active === false && <Text style={styles.inactiveTag}>DISABLED</Text>}
                  </View>
                  <Text style={styles.userEmail}>{u.email}</Text>
                  <View style={[styles.roleChip, isAdmin ? styles.roleChipAdmin : styles.roleChipStaff]}>
                    <Text style={[styles.roleChipText, isAdmin ? { color: '#8A0E1D' } : { color: '#3A3937' }]}>
                      {isAdmin ? 'SUPER ADMIN' : 'PLATFORM STAFF'}
                    </Text>
                  </View>
                </View>
              </View>

              {isSuperAdmin && (
                <View style={styles.userActions}>
                  <TouchableOpacity style={styles.actBtn} onPress={() => toggleRole(u)}>
                    <Ionicons name="swap-vertical-outline" size={14} color={colors.brandPrimary} />
                    <Text style={styles.actBtnText}>{isAdmin ? 'Make Staff' : 'Make Admin'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actBtn} onPress={() => setResetTarget(u)}>
                    <Ionicons name="key-outline" size={14} color={colors.brandPrimary} />
                    <Text style={styles.actBtnText}>Reset Pwd</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actBtn, !u.is_active && { backgroundColor: '#FEE' }]} onPress={() => toggleActive(u)}>
                    <Ionicons name={u.is_active ? 'lock-open-outline' : 'lock-closed-outline'} size={14} color={u.is_active ? colors.success : colors.error} />
                    <Text style={[styles.actBtnText, { color: u.is_active ? colors.success : colors.error }]}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </Text>
                  </TouchableOpacity>
                  {!isMe && (
                    <TouchableOpacity style={[styles.actBtn, styles.actBtnDanger]} onPress={() => confirmDelete(u)}>
                      <Ionicons name="trash-outline" size={14} color={colors.error} />
                      <Text style={[styles.actBtnText, { color: colors.error }]}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Create Modal */}
      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowCreate(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>New Platform User</Text>
              <View style={styles.field}>
                <Text style={styles.label}>Name</Text>
                <TextInput value={form.name} onChangeText={(v) => setForm(f => ({ ...f, name: v }))} style={styles.input} placeholder="John Doe" testID="pu-name" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput value={form.email} onChangeText={(v) => setForm(f => ({ ...f, email: v }))} style={styles.input} placeholder="john@parlourpilot.com" autoCapitalize="none" keyboardType="email-address" testID="pu-email" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Password (min 6)</Text>
                <TextInput value={form.password} onChangeText={(v) => setForm(f => ({ ...f, password: v }))} style={styles.input} placeholder="•••••••" secureTextEntry autoCapitalize="none" testID="pu-password" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Role</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {(['platform_staff', 'platform_admin'] as const).map(r => {
                    const sel = form.role === r;
                    return (
                      <TouchableOpacity key={r} style={[styles.roleBtn, sel && styles.roleBtnActive]} onPress={() => setForm(f => ({ ...f, role: r }))} testID={`pu-role-${r}`}>
                        <Text style={[styles.roleBtnText, sel && { color: '#fff' }]}>{r === 'platform_admin' ? 'Super Admin' : 'Staff'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.hint}>
                  {form.role === 'platform_admin'
                    ? 'Full access: can delete tenants & manage users'
                    : 'Restricted: cannot delete tenants or manage platform users'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                <TouchableOpacity style={styles.btnGhost} onPress={() => setShowCreate(false)}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={submitCreate} disabled={busy} testID="pu-submit">
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Create User</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Reset Password Modal */}
      <Modal visible={!!resetTarget} transparent animationType="slide" onRequestClose={() => setResetTarget(null)}>
        <Pressable style={styles.backdrop} onPress={() => setResetTarget(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Reset Password</Text>
              <Text style={styles.sheetSub}>{resetTarget?.email}</Text>
              <View style={styles.field}>
                <Text style={styles.label}>New Password</Text>
                <TextInput value={newPwd} onChangeText={setNewPwd} style={styles.input} placeholder="•••••••" secureTextEntry autoCapitalize="none" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Confirm</Text>
                <TextInput value={newPwd2} onChangeText={setNewPwd2} style={styles.input} placeholder="•••••••" secureTextEntry autoCapitalize="none" />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                <TouchableOpacity style={styles.btnGhost} onPress={() => setResetTarget(null)}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={submitReset} disabled={resetBusy}>
                  {resetBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Reset</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.onSurfaceTertiary },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md,
    marginBottom: spacing.md, ...shadows.card,
  },
  addBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  userCard: {
    backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarAdmin: { backgroundColor: colors.brandPrimary },
  avatarStaff: { backgroundColor: '#6B6862' },
  userName: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  userEmail: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  roleChip: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  roleChipAdmin: { backgroundColor: '#FDECEE' },
  roleChipStaff: { backgroundColor: '#EEE' },
  roleChipText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  meTag: { fontSize: 9, fontWeight: '900', color: colors.brandPrimary, backgroundColor: colors.brandTertiary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, letterSpacing: 1 },
  inactiveTag: { fontSize: 9, fontWeight: '900', color: colors.error, backgroundColor: '#FEE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, letterSpacing: 1 },

  userActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  actBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.brandSecondary,
  },
  actBtnDanger: { backgroundColor: '#FEE2E2', borderColor: colors.error },
  actBtnText: { fontSize: 11, fontWeight: '700', color: colors.brandPrimary },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  sheetSub: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },
  field: { gap: spacing.sm },
  label: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 15, color: colors.onSurface },
  hint: { fontSize: 11, color: colors.onSurfaceTertiary, fontStyle: 'italic', marginTop: 4 },
  roleBtn: { flex: 1, backgroundColor: colors.surfaceTertiary, paddingVertical: 12, borderRadius: radius.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  roleBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  roleBtnText: { fontSize: 13, fontWeight: '700', color: colors.onSurface },

  btnPrimary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', ...shadows.card },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnGhost: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 15 },
});
