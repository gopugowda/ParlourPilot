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
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

type Gender = 'ladies' | 'men' | 'unisex';
type Service = {
  id: string; name: string; price: number;
  additional_price?: number; gender?: Gender;
  category: string; tax_percentage?: number; active: boolean;
};

export default function ServicesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [list, setList] = useState<Service[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [additionalPrice, setAdditionalPrice] = useState('');
  const [gender, setGender] = useState<Gender>('unisex');
  const [category, setCategory] = useState('General');
  const [taxPct, setTaxPct] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<'all' | Gender>('all');

  const load = async () => {
    try {
      const [svcs, cats] = await Promise.all([
        api('/services'),
        api('/services/categories').catch(() => []),
      ]);
      setList(svcs);
      setCategories(Array.isArray(cats) ? cats : []);
    } catch {}
  };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const openAdd = () => {
    setEditing(null); setName(''); setPrice(''); setAdditionalPrice('');
    setGender('unisex'); setCategory('General'); setTaxPct(''); setActive(true);
    setErr(null); setEditOpen(true);
  };
  const openEdit = (s: Service) => {
    setEditing(s); setName(s.name); setPrice(String(s.price));
    setAdditionalPrice(s.additional_price ? String(s.additional_price) : '');
    setGender((s.gender as Gender) || 'unisex');
    setCategory(s.category);
    setTaxPct(s.tax_percentage ? String(s.tax_percentage) : '');
    setActive(s.active); setErr(null); setEditOpen(true);
  };

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Name required'); return; }
    const p = Number(price);
    if (!(p > 0)) { setErr('Price must be > 0'); return; }
    const ap = Number(additionalPrice);
    if (additionalPrice && (!Number.isFinite(ap) || ap < 0)) {
      setErr('Additional price must be 0 or greater'); return;
    }
    const tx = Number(taxPct);
    if (taxPct && (!Number.isFinite(tx) || tx < 0 || tx > 100)) { setErr('Tax % must be between 0 and 100'); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(), price: p,
        additional_price: Number.isFinite(ap) ? ap : 0,
        gender,
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
        {isAdmin && (
          <TouchableOpacity testID="add-service-header" onPress={openAdd} style={styles.headerBtn}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          {/* Gender filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }} style={{ flexGrow: 0 }}>
            {([
              { k: 'all', label: `All (${list.length})` },
              { k: 'ladies', label: `Ladies (${list.filter(x => (x.gender || 'unisex') === 'ladies').length})` },
              { k: 'men', label: `Men (${list.filter(x => (x.gender || 'unisex') === 'men').length})` },
              { k: 'unisex', label: `Unisex (${list.filter(x => (x.gender || 'unisex') === 'unisex').length})` },
            ] as const).map(c => (
              <TouchableOpacity
                key={c.k}
                testID={`svc-gender-filter-${c.k}`}
                onPress={() => { Haptics.selectionAsync(); setGenderFilter(c.k as any); }}
                style={[styles.filterChip, genderFilter === c.k && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, genderFilter === c.k && styles.filterChipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {list.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="pricetags-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No services yet</Text>
              {isAdmin && (
                <TouchableOpacity testID="empty-add" style={styles.ctaBtn} onPress={openAdd}>
                  <Text style={styles.ctaBtnText}>Add first service</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {list
            .filter(s => genderFilter === 'all' || (s.gender || 'unisex') === genderFilter)
            .map(s => {
              const g = (s.gender || 'unisex') as Gender;
              const gCol = g === 'ladies' ? '#D9337B' : g === 'men' ? '#2E6BE6' : colors.brandPrimary;
              return (
                <View key={s.id} style={styles.row} testID={`svc-row-${s.id}`}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.rowName}>{s.name}</Text>
                      <View style={[styles.genderPill, { backgroundColor: `${gCol}18`, borderColor: `${gCol}55` }]}>
                        <Text style={[styles.genderPillText, { color: gCol }]}>{g === 'ladies' ? 'Ladies' : g === 'men' ? 'Men' : 'Unisex'}</Text>
                      </View>
                    </View>
                    <Text style={styles.rowMeta}>
                      {s.category}
                      {(s.tax_percentage ?? 0) > 0 ? ` · Tax ${s.tax_percentage}%` : ''}
                      {(s.additional_price ?? 0) > 0 ? ` · +${fmtINR(s.additional_price || 0)} add-on` : ''}
                      {!s.active && ' · Inactive'}
                    </Text>
                  </View>
                  <Text style={styles.rowPrice}>{fmtINR(s.price)}</Text>
                  {isAdmin && (
                    <>
                      <TouchableOpacity testID={`svc-edit-${s.id}`} style={styles.smallBtn} onPress={() => openEdit(s)}>
                        <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
                      </TouchableOpacity>
                      <TouchableOpacity testID={`svc-del-${s.id}`} style={[styles.smallBtn, { backgroundColor: '#FDE7E7' }]} onPress={() => remove(s)}>
                        <Ionicons name="trash" size={14} color={colors.error} />
                      </TouchableOpacity>
                    </>
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
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
                <View style={styles.handle} />
                <Text style={styles.sheetTitle}>{editing ? 'Edit service' : 'Add service'}</Text>
                <View style={styles.field}>
                  <Text style={styles.label}>Service name</Text>
                  <TextInput testID="svc-name-input" value={name} onChangeText={setName} placeholder="e.g. Hair Spa" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>

                {/* Service type (optional) — Ladies / Men / Unisex */}
                <View style={styles.field}>
                  <Text style={styles.label}>Service type (optional)</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                    {(['unisex', 'ladies', 'men'] as Gender[]).map(g => (
                      <TouchableOpacity
                        key={g}
                        testID={`svc-gender-${g}`}
                        onPress={() => { Haptics.selectionAsync(); setGender(g); }}
                        style={[styles.segment, gender === g && styles.segmentActive]}
                      >
                        <Ionicons
                          name={g === 'ladies' ? 'female-outline' : g === 'men' ? 'male-outline' : 'people-outline'}
                          size={14}
                          color={gender === g ? '#fff' : colors.onSurfaceTertiary}
                        />
                        <Text style={[styles.segmentText, gender === g && styles.segmentTextActive]}>
                          {g === 'ladies' ? 'Ladies' : g === 'men' ? 'Men' : 'Unisex'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Pricing */}
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>Base price (₹)</Text>
                    <TextInput testID="svc-price-input" value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                  </View>
                  <View style={[styles.field, { flex: 0.8 }]}>
                    <Text style={styles.label}>Tax %</Text>
                    <TextInput testID="svc-tax-input" value={taxPct} onChangeText={(v) => setTaxPct(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                  </View>
                </View>

                {/* Variable price toggle */}
                <View style={styles.variableRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Variable price</Text>
                    <Text style={styles.helpText}>Allow an extra amount on top of base price at billing</Text>
                  </View>
                  <Switch
                    testID="svc-variable-price"
                    value={(Number(additionalPrice) || 0) > 0}
                    onValueChange={(on) => setAdditionalPrice(on ? (additionalPrice || '100') : '')}
                    trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
                  />
                </View>
                {(Number(additionalPrice) || 0) > 0 && (
                  <View style={styles.field}>
                    <Text style={styles.label}>Suggested add-on (₹)</Text>
                    <TextInput
                      testID="svc-additional-price-input"
                      value={additionalPrice}
                      onChangeText={(v) => setAdditionalPrice(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      style={styles.input}
                    />
                  </View>
                )}

                {/* Pick or Type Category */}
                <View style={styles.field}>
                  <Text style={styles.label}>Category (pick or type)</Text>
                  <TextInput
                    testID="svc-category-input"
                    value={category}
                    onChangeText={setCategory}
                    placeholder="Type or pick below"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.input}
                  />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                    {categories.map(c => (
                      <TouchableOpacity
                        key={c}
                        testID={`svc-cat-chip-${c}`}
                        onPress={() => { Haptics.selectionAsync(); setCategory(c); }}
                        style={[styles.catChip, category === c && styles.catChipActive]}
                      >
                        <Text style={[styles.catChipText, category === c && styles.catChipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.switchRow}>
                  <Text style={styles.label}>Active</Text>
                  <Switch testID="svc-active-switch" value={active} onValueChange={setActive} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} />
                </View>
                {err && <Text style={styles.err}>{err}</Text>}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity onPress={() => setEditOpen(false)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity testID="svc-save-btn" style={[styles.saveBtn, { flex: 1 }]} onPress={save} disabled={saving}>
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  err: { color: colors.error, fontSize: 13 },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  cancelBtnText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 15 },
  variableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  helpText: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  genderPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1 },
  genderPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },

  segment: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  segmentText: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceSecondary },
  segmentTextActive: { color: '#fff' },

  filterChip: { flexShrink: 0, paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterChipText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  filterChipTextActive: { color: '#fff' },

  catChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  catChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  catChipText: { fontSize: 11, fontWeight: '600', color: colors.onSurfaceSecondary },
  catChipTextActive: { color: '#fff' },
});
