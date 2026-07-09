import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows } from '@/src/theme';

type UserRow = { id: string; name: string; email: string; role: 'admin' | 'staff' };

export default function UsersScreen() {
  const router = useRouter();
  const [list, setList] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [role, setRole] = useState<'admin' | 'staff'>('staff');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => { try { setList(await api('/auth/users')); } catch {} };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const save = async () => {
    setErr(null);
    if (!name.trim() || !email.trim() || pwd.length < 6) {
      setErr('Name, email required. Password ≥ 6 chars.'); return;
    }
    setSaving(true);
    try {
      await api('/auth/register', { method: 'POST', body: { name: name.trim(), email: email.trim().toLowerCase(), password: pwd, role } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpen(false); setName(''); setEmail(''); setPwd(''); setRole('staff');
      await load();
    } catch (e: any) { setErr(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <View style={styles.root} testID="users-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Users</Text>
          <Text style={styles.headerSub}>{list.length} accounts</Text>
        </View>
        <TouchableOpacity testID="add-user-header" onPress={() => setOpen(true)} style={styles.headerBtn}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          {list.map(u => (
            <View key={u.id} style={styles.row} testID={`user-${u.id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{u.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{u.name}</Text>
                <Text style={styles.rowMeta}>{u.email}</Text>
              </View>
              <View style={[styles.rolePill, { backgroundColor: u.role === 'admin' ? colors.brandPrimary : colors.info }]}>
                <Text style={styles.roleText}>{u.role.toUpperCase()}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Add User</Text>
              <View style={styles.field}><Text style={styles.label}>Name</Text><TextInput testID="user-name-input" value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              <View style={styles.field}><Text style={styles.label}>Email</Text><TextInput testID="user-email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="user@salon.com" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              <View style={styles.field}><Text style={styles.label}>Password (≥ 6 chars)</Text><TextInput testID="user-pwd-input" value={pwd} onChangeText={setPwd} secureTextEntry placeholder="••••••" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
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
              {err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity testID="user-save-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Create User</Text>}
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

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brandPrimary, fontWeight: '800', fontSize: 13 },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  rowMeta: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  rolePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  roleText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  roleChip: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  roleChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  roleChipText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  roleChipTextActive: { color: '#fff' },
  err: { color: colors.error, fontSize: 13 },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
