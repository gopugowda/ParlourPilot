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
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

type Service = { id: string; name: string; price: number; category: string; tax_percentage?: number; active: boolean };

export default function ServicesScreen() {
  const router = useRouter();
  const [list, setList] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('General');
  const [taxPct, setTaxPct] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try { setList(await api('/services')); } catch {}
  };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const openAdd = () => {
    setEditing(null); setName(''); setPrice(''); setCategory('General'); setTaxPct(''); setActive(true); setErr(null); setEditOpen(true);
  };
  const openEdit = (s: Service) => {
    setEditing(s); setName(s.name); setPrice(String(s.price)); setCategory(s.category);
    setTaxPct(s.tax_percentage ? String(s.tax_percentage) : '');
    setActive(s.active); setErr(null); setEditOpen(true);
  };

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Name required'); return; }
    const p = Number(price);
    if (!(p > 0)) { setErr('Price must be > 0'); return; }
    const tx = Number(taxPct);
    if (taxPct && (!Number.isFinite(tx) || tx < 0 || tx > 100)) { setErr('Tax % must be between 0 and 100'); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(), price: p,
        category: category.trim() || 'General',
        tax_percentage: Number.isFinite(tx) ? tx : 0,
        active,
      };
      if (editing) await api(`/services/${editing.id}`, { method: 'PUT', body });
      else await api('/services', { method: 'POST', body });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false);
      await load();
    } catch (e: any) { setErr(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (s: Service) => {
    try { await api(`/services/${s.id}`, { method: 'DELETE' }); await load(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  };

  return (
    <View style={styles.root} testID="services-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Services</Text>
          <Text style={styles.headerSub}>{list.length} services</Text>
        </View>
        <TouchableOpacity testID="add-service-header" onPress={openAdd} style={styles.headerBtn}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          {list.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="pricetags-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No services yet</Text>
              <TouchableOpacity testID="empty-add" style={styles.ctaBtn} onPress={openAdd}>
                <Text style={styles.ctaBtnText}>Add first service</Text>
              </TouchableOpacity>
            </View>
          )}
          {list.map(s => (
            <View key={s.id} style={styles.row} testID={`svc-row-${s.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{s.name}</Text>
                <Text style={styles.rowMeta}>
                  {s.category}
                  {(s.tax_percentage ?? 0) > 0 ? ` · Tax ${s.tax_percentage}%` : ''}
                  {!s.active && ' · Inactive'}
                </Text>
              </View>
              <Text style={styles.rowPrice}>{fmtINR(s.price)}</Text>
              <TouchableOpacity testID={`svc-edit-${s.id}`} style={styles.smallBtn} onPress={() => openEdit(s)}>
                <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
              </TouchableOpacity>
              <TouchableOpacity testID={`svc-del-${s.id}`} style={[styles.smallBtn, { backgroundColor: '#FDE7E7' }]} onPress={() => remove(s)}>
                <Ionicons name="trash" size={14} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit Service' : 'Add Service'}</Text>
              <View style={styles.field}>
                <Text style={styles.label}>Name</Text>
                <TextInput testID="svc-name-input" value={name} onChangeText={setName} placeholder="e.g. Haircut (Men)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Price (₹)</Text>
                  <TextInput testID="svc-price-input" value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Tax %</Text>
                  <TextInput testID="svc-tax-input" value={taxPct} onChangeText={(v) => setTaxPct(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>
                <View style={[styles.field, { flex: 1.2 }]}>
                  <Text style={styles.label}>Category</Text>
                  <TextInput testID="svc-category-input" value={category} onChangeText={setCategory} placeholder="Hair / Skin ..." placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>Active</Text>
                <Switch testID="svc-active-switch" value={active} onValueChange={setActive} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} />
              </View>
              {err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity testID="svc-save-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
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
  rowName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  rowMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowPrice: { fontSize: 14, fontWeight: '700', color: colors.brandPrimary, marginRight: spacing.sm },
  smallBtn: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 16, color: colors.onSurfaceTertiary },
  ctaBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  err: { color: colors.error, fontSize: 13 },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
