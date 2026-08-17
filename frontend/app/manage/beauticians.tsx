import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { sanitizePhone, PHONE_MAX } from '@/src/utils/validators';

type Beautician = { id: string; name: string; role: string; phone: string; active: boolean };

export default function BeauticiansScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [list, setList] = useState<Beautician[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Beautician | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Stylist');
  const [phone, setPhone] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => { try { setList(await api('/beauticians')); } catch {} };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const openAdd = () => { setEditing(null); setName(''); setRole('Stylist'); setPhone(''); setActive(true); setErr(null); setEditOpen(true); };
  const openEdit = (b: Beautician) => { setEditing(b); setName(b.name); setRole(b.role); setPhone(b.phone || ''); setActive(b.active); setErr(null); setEditOpen(true); };

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try {
      const body = { name: name.trim(), role: role.trim() || 'Stylist', phone: sanitizePhone(phone), active };
      if (editing) await api(`/beauticians/${editing.id}`, { method: 'PUT', body });
      else await api('/beauticians', { method: 'POST', body });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false); await load();
    } catch (e: any) { setErr(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (b: Beautician) => {
    try { await api(`/beauticians/${b.id}`, { method: 'DELETE' }); await load(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  };

  const roleColors: Record<string, string> = {
    Barber: colors.info, Beautician: colors.brandPrimary, Stylist: colors.success,
  };

  return (
    <View style={styles.root} testID="beauticians-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Staff</Text>
          <Text style={styles.headerSub}>{list.length} staff members</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity testID="add-header" onPress={openAdd} style={styles.headerBtn}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          {list.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No staff yet</Text>
              {isAdmin && (
                <TouchableOpacity testID="empty-add" style={styles.ctaBtn} onPress={openAdd}>
                  <Text style={styles.ctaBtnText}>Add first team member</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {list.map(b => (
            <View key={b.id} style={styles.row} testID={`bt-row-${b.id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{b.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{b.name}</Text>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 3 }}>
                  <View style={[styles.rolePill, { backgroundColor: (roleColors[b.role] || colors.info) + '22' }]}>
                    <Text style={[styles.roleText, { color: roleColors[b.role] || colors.info }]}>{b.role}</Text>
                  </View>
                  {!b.active && <Text style={styles.rowMeta}>· Inactive</Text>}
                  {b.phone ? <Text style={styles.rowMeta}>· {b.phone}</Text> : null}
                </View>
              </View>
              {isAdmin && (
                <>
                  <TouchableOpacity testID={`bt-edit-${b.id}`} style={styles.smallBtn} onPress={() => openEdit(b)}>
                    <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity testID={`bt-del-${b.id}`} style={[styles.smallBtn, { backgroundColor: '#FDE7E7' }]} onPress={() => remove(b)}>
                    <Ionicons name="trash" size={14} color={colors.error} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit Staff' : 'Add Staff'}</Text>
              <View style={styles.field}>
                <Text style={styles.label}>Name</Text>
                <TextInput testID="bt-name-input" value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Role</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {['Barber', 'Beautician', 'Stylist'].map(r => (
                    <TouchableOpacity
                      key={r}
                      testID={`role-${r}`}
                      onPress={() => setRole(r)}
                      style={[styles.roleChip, role === r && styles.roleChipActive]}
                    >
                      <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Phone (optional)</Text>
                <TextInput testID="bt-phone-input" value={phone} onChangeText={(v) => setPhone(sanitizePhone(v))} placeholder="10-digit number" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" maxLength={PHONE_MAX} style={styles.input} />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>Active</Text>
                <Switch testID="bt-active-switch" value={active} onValueChange={setActive} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} />
              </View>
              {err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity testID="bt-save-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Add'}</Text>}
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

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brandPrimary, fontWeight: '800', fontSize: 13 },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  rowMeta: { fontSize: 11, color: colors.onSurfaceTertiary },
  rolePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  roleText: { fontSize: 10, fontWeight: '700' },
  smallBtn: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 16, color: colors.onSurfaceTertiary },
  ctaBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },

  roleChip: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  roleChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  roleChipText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  roleChipTextActive: { color: '#fff' },

  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  err: { color: colors.error, fontSize: 13 },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
