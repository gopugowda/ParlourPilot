import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

type UserRow = { id: string; name: string; email: string; role: 'admin' | 'staff'; branch_id?: string | null };

export default function UsersScreen() {
  const router = useRouter();
  const { user: me, branches } = useAuth();
  const [list, setList] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor (create/edit)
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [role, setRole] = useState<'admin' | 'staff'>('staff');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const branchNameById = (bid?: string | null) => {
    if (!bid) return null;
    const b = (branches || []).find((br: any) => br.id === bid);
    return b ? (b as any).name : null;
  };

  // Reset password
  const [pwdOpen, setPwdOpen] = useState<UserRow | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  const load = async () => { try { setList(await api('/auth/users')); } catch {} };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const openAdd = () => {
    setEditing(null); setName(''); setEmail(''); setPwd(''); setRole('staff');
    // Default to head branch (or first) for staff
    const defaultBid = (branches && branches.length > 0)
      ? ((branches as any[]).find(b => b.is_head) || branches[0]).id
      : null;
    setBranchId(defaultBid);
    setErr(null); setEditOpen(true);
  };
  const openEdit = (u: UserRow) => {
    setEditing(u); setName(u.name); setEmail(u.email); setPwd(''); setRole(u.role);
    setBranchId(u.branch_id || null);
    setErr(null); setEditOpen(true);
  };

  const save = async () => {
    setErr(null);
    if (!name.trim() || !email.trim()) { setErr('Name and email required'); return; }
    if (!editing && pwd.length < 6) { setErr('Password ≥ 6 chars'); return; }
    if (role === 'staff' && !branchId) { setErr('Staff must be assigned to a branch'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api(`/auth/users/${editing.id}`, {
          method: 'PUT',
          body: { name: name.trim(), email: email.trim().toLowerCase(), role, branch_id: branchId },
        });
      } else {
        await api('/auth/register', {
          method: 'POST',
          body: { name: name.trim(), email: email.trim().toLowerCase(), password: pwd, role, branch_id: branchId },
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false);
      await load();
    } catch (e: any) { setErr(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (u: UserRow) => {
    try { await api(`/auth/users/${u.id}`, { method: 'DELETE' }); await load(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }
    catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message || 'Delete failed');
    }
  };

  const submitReset = async () => {
    if (!pwdOpen) return;
    setPwdErr(null); setPwdMsg(null);
    if (newPwd.length < 6) { setPwdErr('Password ≥ 6 chars'); return; }
    setPwdBusy(true);
    try {
      await api(`/auth/users/${pwdOpen.id}/reset-password`, { method: 'POST', body: { new_password: newPwd } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPwdMsg(`Password reset for ${pwdOpen.name}. Share the new password securely.`);
      setNewPwd('');
      setTimeout(() => { setPwdOpen(null); setPwdMsg(null); }, 1500);
    } catch (e: any) { setPwdErr(e.message || 'Failed'); }
    finally { setPwdBusy(false); }
  };

  return (
    <View style={styles.root} testID="users-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Users</Text>
          <Text style={styles.headerSub}>{list.length} accounts</Text>
        </View>
        <TouchableOpacity testID="add-user-header" onPress={openAdd} style={styles.headerBtn}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          {list.map(u => (
            <View key={u.id} style={styles.row} testID={`user-${u.id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{u.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</Text>
              </View>
              <View style={styles.rowMain}>
                <View style={styles.rowNameLine}>
                  <Text style={styles.rowName} numberOfLines={1}>{u.name}</Text>
                  <View style={[styles.rolePill, { backgroundColor: (u.role === 'admin' || u.role === 'owner') ? colors.brandPrimary : colors.info }]}>
                    <Text style={styles.roleText}>{u.role.toUpperCase()}</Text>
                  </View>
                  {u.id === me?.id && <Text style={styles.youTag}>YOU</Text>}
                </View>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {u.email}
                  {branchNameById(u.branch_id) ? ` · ${branchNameById(u.branch_id)}` : (u.role !== 'staff' ? ' · All branches' : '')}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <TouchableOpacity testID={`u-edit-${u.id}`} style={styles.actionBtn} onPress={() => openEdit(u)}>
                  <Ionicons name="pencil" size={13} color={colors.brandPrimary} />
                </TouchableOpacity>
                <TouchableOpacity testID={`u-pwd-${u.id}`} style={styles.actionBtn} onPress={() => { setPwdOpen(u); setNewPwd(''); setPwdErr(null); setPwdMsg(null); }}>
                  <Ionicons name="key-outline" size={13} color={colors.brandPrimary} />
                </TouchableOpacity>
                {u.id !== me?.id && (
                  <TouchableOpacity testID={`u-del-${u.id}`} style={[styles.actionBtn, { backgroundColor: '#FDE7E7' }]} onPress={() => remove(u)}>
                    <Ionicons name="trash" size={13} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
          {err && <Text style={styles.err}>{err}</Text>}
        </ScrollView>
      )}

      {/* Add / Edit User Modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit User' : 'Add User'}</Text>
              <View style={styles.field}><Text style={styles.label}>Name</Text><TextInput testID="user-name-input" value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              <View style={styles.field}><Text style={styles.label}>Email</Text><TextInput testID="user-email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="user@salon.com" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              {!editing && (
                <View style={styles.field}><Text style={styles.label}>Password (≥ 6 chars)</Text><TextInput testID="user-pwd-input" value={pwd} onChangeText={setPwd} secureTextEntry placeholder="••••••" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              )}
              <View style={styles.field}>
                <Text style={styles.label}>Role</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {(['staff', 'admin'] as const).map(r => (
                    <TouchableOpacity key={r} testID={`role-${r}`} onPress={() => setRole(r)} style={[styles.roleChip, role === r && styles.roleChipActive]}>
                      <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>{r.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Branch assignment */}
              <View style={styles.field}>
                <Text style={styles.label}>
                  {role === 'staff' ? 'Assign to Branch *' : 'Home Branch (optional)'}
                </Text>
                {role !== 'staff' && (
                  <TouchableOpacity
                    testID="branch-all"
                    onPress={() => setBranchId(null)}
                    style={[styles.branchChip, branchId === null && styles.branchChipActive, { marginBottom: 6 }]}
                  >
                    <Ionicons name={branchId === null ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={branchId === null ? '#fff' : colors.brandPrimary} />
                    <Text style={[styles.branchChipText, branchId === null && styles.branchChipTextActive]}>All Branches (Owner)</Text>
                  </TouchableOpacity>
                )}
                <ScrollView style={{ maxHeight: 160 }}>
                  {(branches || []).map((b: any) => {
                    const selected = branchId === b.id;
                    return (
                      <TouchableOpacity
                        key={b.id}
                        testID={`branch-opt-${b.id}`}
                        onPress={() => setBranchId(b.id)}
                        style={[styles.branchChip, selected && styles.branchChipActive]}
                      >
                        <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={selected ? '#fff' : colors.brandPrimary} />
                        <Text style={[styles.branchChipText, selected && styles.branchChipTextActive]}>
                          {b.name}{b.is_head ? ' · HEAD' : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {(branches || []).length === 0 && (
                  <Text style={styles.err}>No branches available. Please create one first.</Text>
                )}
              </View>
              {err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity testID="user-save-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{editing ? 'Update User' : 'Create User'}</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Reset Password Modal */}
      <Modal visible={!!pwdOpen} transparent animationType="slide" onRequestClose={() => setPwdOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPwdOpen(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Reset Password</Text>
              <Text style={styles.sheetHint}>Set a new password for {pwdOpen?.name} ({pwdOpen?.email}).</Text>
              <View style={styles.field}>
                <Text style={styles.label}>New Password</Text>
                <TextInput testID="reset-new-pwd" value={newPwd} onChangeText={setNewPwd} secureTextEntry placeholder="••••••" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              </View>
              {pwdErr && <Text style={styles.err}>{pwdErr}</Text>}
              {pwdMsg && (
                <View style={styles.infoBox}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={styles.infoText}>{pwdMsg}</Text>
                </View>
              )}
              <TouchableOpacity testID="reset-submit-btn" style={styles.saveBtn} onPress={submitReset} disabled={pwdBusy}>
                {pwdBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Reset Password</Text>}
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
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card },
  rowMain: { flex: 1, minWidth: 0 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowActions: { flexDirection: 'row', gap: 4, flexShrink: 0 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brandPrimary, fontWeight: '800', fontSize: 13 },
  rowName: { fontSize: 14, fontWeight: '700', color: colors.onSurface, flexShrink: 1 },
  rowMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 3 },
  youTag: { fontSize: 9, fontWeight: '800', color: colors.brandPrimary, backgroundColor: colors.brandTertiary, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  rolePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  roleText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  actionBtn: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  err: { color: colors.error, fontSize: 13, textAlign: 'center', marginTop: spacing.md },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  sheetHint: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  roleChip: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  roleChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  roleChipText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  roleChipTextActive: { color: '#fff' },
  branchChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
    marginBottom: 6,
  },
  branchChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  branchChipText: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary, flex: 1 },
  branchChipTextActive: { color: '#fff', fontWeight: '700' },
  infoBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#E9F1E7', borderWidth: 1, borderColor: '#C8DDC4', padding: spacing.md, borderRadius: radius.sm },
  infoText: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
