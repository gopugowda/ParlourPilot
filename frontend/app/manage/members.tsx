import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, Switch, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

type Member = {
  id: string; name: string; phone: string; joined_at: string; expires_at: string;
  active: boolean; notes?: string;
  discount_pct?: number | null;
  status: 'active' | 'expiring_soon' | 'expired' | 'inactive';
  days_left: number | null;
};

export default function MembersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { tenant } = useAuth();
  const [list, setList] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'expiring' | 'expired'>(
    params?.filter === 'expiring' ? 'expiring'
    : params?.filter === 'active' ? 'active'
    : params?.filter === 'expired' ? 'expired'
    : 'all'
  );

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [joinedAt, setJoinedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [discountPct, setDiscountPct] = useState(''); // per-member override
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => { try { setList(await api('/members')); } catch {} };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const openAdd = () => {
    setEditing(null); setName(''); setPhone('');
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1);
    setJoinedAt(today);
    setExpiresAt(nextYear.toISOString().slice(0, 10));
    setDiscountPct('');
    setActive(true); setNotes(''); setErr(null); setEditOpen(true);
  };
  const openEdit = (m: Member) => {
    setEditing(m); setName(m.name); setPhone(m.phone);
    setJoinedAt(m.joined_at || ''); setExpiresAt(m.expires_at || '');
    setDiscountPct((m as any).discount_pct !== null && (m as any).discount_pct !== undefined ? String((m as any).discount_pct) : '');
    setActive(m.active); setNotes(m.notes || ''); setErr(null); setEditOpen(true);
  };

  const save = async () => {
    setErr(null);
    if (!name.trim() || !phone.trim()) { setErr('Name and phone required'); return; }
    // Phone: digits only, 6-15 chars
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 6 || phoneDigits.length > 15) {
      setErr('Phone must be 6-15 digits');
      return;
    }
    let discOverride: number | null = null;
    if (discountPct.trim()) {
      const d = Number(discountPct);
      if (!Number.isFinite(d) || d < 0 || d > 100) { setErr('Discount % must be between 0 and 100'); return; }
      discOverride = d;
    }
    setSaving(true);
    try {
      const body: any = {
        name: name.trim(),
        phone: phoneDigits,
        joined_at: joinedAt,
        expires_at: expiresAt,
        discount_pct: discOverride,
        active,
        notes: notes.trim(),
      };
      if (editing) await api(`/members/${editing.id}`, { method: 'PUT', body });
      else await api('/members', { method: 'POST', body });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false); await load();
    } catch (e: any) { setErr(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (m: Member) => {
    try { await api(`/members/${m.id}`, { method: 'DELETE' }); await load(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  };

  const filtered = list.filter(m => {
    if (filter === 'expiring' && !(m.status === 'expiring_soon' || m.status === 'expired')) return false;
    if (filter === 'active' && !(m.status === 'active' || m.status === 'expiring_soon')) return false;
    if (filter === 'expired' && m.status !== 'expired') return false;
    const s = search.toLowerCase();
    if (!s) return true;
    return m.name.toLowerCase().includes(s) || m.phone.includes(s);
  });

  const expiringCount = list.filter(m => m.status === 'expiring_soon' || m.status === 'expired').length;
  const activeCount = list.filter(m => m.status === 'active' || m.status === 'expiring_soon').length;
  const expiredCount = list.filter(m => m.status === 'expired').length;

  const sendWhatsApp = async (m: Member) => {
    let phoneNum = (m.phone || '').replace(/[^0-9]/g, '');
    if (phoneNum.length === 10) phoneNum = '91' + phoneNum;
    const salon = tenant?.business_name || 'our salon';
    const cityLine = tenant?.city ? `, ${tenant.city}` : '';
    const memberOverride = (m as any).discount_pct;
    const discountPct = (memberOverride !== null && memberOverride !== undefined) ? memberOverride : (tenant?.member_discount_pct ?? 10);
    const minPrice = tenant?.member_min_price ?? 100;
    const msg = m.status === 'expired'
      ? `Hi ${m.name}, your ${salon} yearly membership expired on ${m.expires_at}. Renew today to keep enjoying ${discountPct}% off on all services above ₹${minPrice}. Reply YES to renew. - ${salon}${cityLine}`
      : `Hi ${m.name}, your ${salon} yearly membership expires on ${m.expires_at} (${m.days_left} days left). Renew now to continue enjoying ${discountPct}% off on all services above ₹${minPrice}. - ${salon}${cityLine}`;
    const url = `https://wa.me/${phoneNum}?text=${encodeURIComponent(msg)}`;
    try {
      await Linking.openURL(url);
      Haptics.selectionAsync();
    } catch {}
  };

  const statusInfo = (m: Member) => {
    if (m.status === 'expired') return { color: colors.error, text: 'Expired', bg: '#FDE7E7' };
    if (m.status === 'expiring_soon') return { color: colors.warning, text: `${m.days_left}d left`, bg: '#FDF3E4' };
    if (m.status === 'active') return { color: colors.success, text: 'Active', bg: '#E9F1E7' };
    return { color: colors.onSurfaceTertiary, text: 'Inactive', bg: colors.surfaceTertiary };
  };

  return (
    <View style={styles.root} testID="members-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Members</Text>
          <Text style={styles.headerSub}>{list.length} · {list.filter(m => m.status === 'active' || m.status === 'expiring_soon').length} active</Text>
        </View>
        <TouchableOpacity testID="add-member-header" onPress={openAdd} style={styles.headerBtn}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={colors.onSurfaceTertiary} />
        <TextInput
          testID="members-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or phone"
          placeholderTextColor={colors.onSurfaceTertiary}
          style={styles.searchInput}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flexGrow: 0 }}>
        {[
          { k: 'all', label: `All (${list.length})` },
          { k: 'active', label: `Active (${activeCount})` },
          { k: 'expiring', label: `Expiring (${expiringCount})` },
          { k: 'expired', label: `Expired (${expiredCount})` },
        ].map(c => {
          const active = filter === c.k;
          return (
            <TouchableOpacity
              key={c.k}
              testID={`mfilter-${c.k}`}
              onPress={() => { Haptics.selectionAsync(); setFilter(c.k as any); }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          {filtered.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="star-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No members yet</Text>
              <Text style={styles.emptySub}>Yearly members get 10% off on services above ₹100</Text>
              <TouchableOpacity testID="empty-add" style={styles.ctaBtn} onPress={openAdd}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.ctaBtnText}>Add Member</Text>
              </TouchableOpacity>
            </View>
          )}
          {filtered.map(m => {
            const s = statusInfo(m);
            const showWa = m.status === 'expiring_soon' || m.status === 'expired';
            return (
              <View key={m.id} style={styles.row} testID={`member-row-${m.id}`}>
                <TouchableOpacity
                  onPress={() => openEdit(m)}
                  activeOpacity={0.85}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}
                >
                  <View style={styles.avatar}>
                    <Ionicons name="star" size={16} color={colors.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.name}>{m.name}</Text>
                      {m.discount_pct !== null && m.discount_pct !== undefined && (
                        <View style={styles.discBadge}>
                          <Text style={styles.discBadgeText}>{m.discount_pct}% off</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.meta}>{m.phone} · expires {m.expires_at || '—'}</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
                    <Text style={[styles.statusText, { color: s.color }]}>{s.text}</Text>
                  </View>
                </TouchableOpacity>
                {showWa && (
                  <TouchableOpacity
                    testID={`wa-${m.id}`}
                    onPress={() => sendWhatsApp(m)}
                    style={styles.waBtn}
                  >
                    <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit Member' : 'Add Member'}</Text>
              <View style={styles.field}><Text style={styles.label}>Name</Text><TextInput testID="m-name" value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              <View style={styles.field}><Text style={styles.label}>Phone</Text><TextInput testID="m-phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="10-digit number" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Joined (YYYY-MM-DD)</Text>
                  <TextInput testID="m-joined" value={joinedAt} onChangeText={setJoinedAt} placeholder="2026-01-01" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Expires (YYYY-MM-DD)</Text>
                  <TextInput testID="m-expires" value={expiresAt} onChangeText={setExpiresAt} placeholder="2027-01-01" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>
                  Discount % Override
                  <Text style={{ color: colors.onSurfaceTertiary, fontWeight: '400' }}>
                    {'  '}(leave blank to use salon default {tenant?.member_discount_pct ?? 10}%)
                  </Text>
                </Text>
                <TextInput
                  testID="m-discount"
                  value={discountPct}
                  onChangeText={(v) => setDiscountPct(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="numeric"
                  placeholder="e.g. 20 for Student, 15 for VIP"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>
              <View style={styles.field}><Text style={styles.label}>Notes (optional)</Text><TextInput testID="m-notes" value={notes} onChangeText={setNotes} placeholder="e.g. Family plan, referred by..." placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>Active</Text>
                <Switch testID="m-active" value={active} onValueChange={setActive} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} />
              </View>
              {err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity testID="m-save" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{editing ? 'Update Member' : 'Add Member'}</Text>}
              </TouchableOpacity>
              {editing && (
                <TouchableOpacity testID="m-delete" style={styles.deleteBtn} onPress={() => { remove(editing); setEditOpen(false); }}>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              )}
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

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, borderRadius: radius.sm,
    height: 42, marginHorizontal: spacing.lg, marginVertical: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  meta: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  discBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },
  discBadgeText: { color: colors.brandPrimary, fontSize: 9, fontWeight: '800' },
  statusText: { fontSize: 11, fontWeight: '800' },
  waBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#25D366', alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },

  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: { flexShrink: 0, paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md, maxHeight: '90%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  err: { color: colors.error, fontSize: 13, textAlign: 'center' },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  deleteText: { color: colors.error, fontWeight: '600' },
});
