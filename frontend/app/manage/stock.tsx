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
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

type StockItem = {
  id: string; name: string; unit: string;
  current_qty: number; min_qty: number; unit_cost: number;
  low_stock: boolean; notes?: string;
};

const UNITS = ['piece', 'ml', 'g', 'kg', 'L', 'pack', 'bottle'];

export default function StockScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [list, setList] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low'>('all');

  // Item editor
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('piece');
  const [curQty, setCurQty] = useState('0');
  const [minQty, setMinQty] = useState('0');
  const [unitCost, setUnitCost] = useState('0');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Movement sheet
  const [mvOpen, setMvOpen] = useState<{ item: StockItem; type: 'purchase' | 'use' } | null>(null);
  const [mvQty, setMvQty] = useState('');
  const [mvUnitCost, setMvUnitCost] = useState('');
  const [mvSaving, setMvSaving] = useState(false);
  const [mvErr, setMvErr] = useState<string | null>(null);

  const load = async () => {
    try { setList(await api('/stock')); } catch {}
  };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const openAdd = () => {
    setEditing(null); setName(''); setUnit('piece'); setCurQty('0'); setMinQty('0'); setUnitCost('0'); setErr(null); setEditOpen(true);
  };
  const openEdit = (it: StockItem) => {
    if (!isAdmin) return;
    setEditing(it); setName(it.name); setUnit(it.unit);
    setCurQty(String(it.current_qty)); setMinQty(String(it.min_qty));
    setUnitCost(String(it.unit_cost)); setErr(null); setEditOpen(true);
  };

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try {
      const body = { name: name.trim(), unit, current_qty: Number(curQty) || 0, min_qty: Number(minQty) || 0, unit_cost: Number(unitCost) || 0 };
      if (editing) await api(`/stock/${editing.id}`, { method: 'PUT', body });
      else await api('/stock', { method: 'POST', body });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false); await load();
    } catch (e: any) { setErr(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (it: StockItem) => {
    try { await api(`/stock/${it.id}`, { method: 'DELETE' }); await load(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  };

  const openMovement = (item: StockItem, type: 'purchase' | 'use') => {
    setMvOpen({ item, type });
    setMvQty(''); setMvErr(null);
    setMvUnitCost(String(item.unit_cost || ''));
  };

  const saveMovement = async () => {
    if (!mvOpen) return;
    setMvErr(null);
    const q = Number(mvQty);
    if (!(q > 0)) { setMvErr('Qty must be > 0'); return; }
    if (mvOpen.type === 'use' && q > mvOpen.item.current_qty) {
      setMvErr(`Only ${mvOpen.item.current_qty} ${mvOpen.item.unit} in stock`); return;
    }
    setMvSaving(true);
    try {
      await api('/stock/movement', {
        method: 'POST',
        body: {
          item_id: mvOpen.item.id, type: mvOpen.type, qty: q,
          unit_cost: mvOpen.type === 'purchase' ? Number(mvUnitCost) || 0 : undefined,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMvOpen(null);
      await load();
    } catch (e: any) { setMvErr(e.message || 'Failed'); }
    finally { setMvSaving(false); }
  };

  const filtered = list
    .filter(it => filter === 'all' || it.low_stock)
    .filter(it => !search || it.name.toLowerCase().includes(search.toLowerCase()));

  const lowCount = list.filter(i => i.low_stock).length;
  const inventoryValue = list.reduce((s, i) => s + i.current_qty * i.unit_cost, 0);

  return (
    <View style={styles.root} testID="stock-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Stock</Text>
          <Text style={styles.headerSub}>{list.length} items · {lowCount} low</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity testID="add-item-btn" onPress={openAdd} style={styles.headerBtn}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={colors.onSurfaceTertiary} />
        <TextInput
          testID="stock-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search items"
          placeholderTextColor={colors.onSurfaceTertiary}
          style={styles.searchInput}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }} style={{ flexGrow: 0, marginBottom: spacing.md }}>
        {[{ k: 'all', label: `All (${list.length})` }, { k: 'low', label: `Low Stock (${lowCount})` }].map(c => {
          const active = filter === c.k;
          return (
            <TouchableOpacity
              key={c.k}
              testID={`filter-${c.k}`}
              onPress={() => setFilter(c.k as any)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl }}>
          {list.length > 0 && isAdmin && (
            <View style={styles.valueCard}>
              <Text style={styles.valueLabel}>Inventory Value</Text>
              <Text style={styles.valueVal}>{fmtINR(inventoryValue)}</Text>
            </View>
          )}

          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>{list.length === 0 ? 'No items yet' : 'Nothing here'}</Text>
              {isAdmin && list.length === 0 && (
                <TouchableOpacity testID="empty-add" style={styles.ctaBtn} onPress={openAdd}>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.ctaBtnText}>Add first item</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            filtered.map(it => (
              <View key={it.id} style={styles.row} testID={`stock-row-${it.id}`}>
                <TouchableOpacity
                  activeOpacity={isAdmin ? 0.7 : 1}
                  onPress={() => openEdit(it)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}
                >
                  <View style={[styles.icon, it.low_stock && { backgroundColor: '#FDF3E4' }]}>
                    <Ionicons name="cube" size={18} color={it.low_stock ? colors.warning : colors.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{it.name}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                      <Text style={styles.itemMeta}>{it.current_qty} {it.unit}</Text>
                      {it.low_stock && (
                        <View style={styles.lowPill}>
                          <Ionicons name="alert-circle" size={10} color={colors.warning} />
                          <Text style={styles.lowPillText}>Low (min {it.min_qty})</Text>
                        </View>
                      )}
                      {isAdmin && it.unit_cost > 0 && <Text style={styles.itemMeta}>· {fmtINR(it.unit_cost)}/{it.unit}</Text>}
                    </View>
                  </View>
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <TouchableOpacity testID={`use-${it.id}`} style={styles.actionBtn} onPress={() => openMovement(it, 'use')}>
                    <Ionicons name="remove" size={16} color={colors.error} />
                  </TouchableOpacity>
                  {isAdmin && (
                    <TouchableOpacity testID={`buy-${it.id}`} style={[styles.actionBtn, { backgroundColor: colors.brandPrimary }]} onPress={() => openMovement(it, 'purchase')}>
                      <Ionicons name="add" size={16} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Item Editor */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit Item' : 'Add Item'}</Text>
              <View style={styles.field}><Text style={styles.label}>Name</Text><TextInput testID="s-name" value={name} onChangeText={setName} placeholder="e.g. Shampoo" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
              <View style={styles.field}>
                <Text style={styles.label}>Unit</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {UNITS.map(u => (
                    <TouchableOpacity key={u} testID={`unit-${u}`} onPress={() => setUnit(u)} style={[styles.unitChip, unit === u && styles.unitChipActive]}>
                      <Text style={[styles.unitChipText, unit === u && styles.unitChipTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Current Qty</Text>
                  <TextInput testID="s-cur" value={curQty} onChangeText={(v) => setCurQty(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" style={styles.input} />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Min Qty (alert)</Text>
                  <TextInput testID="s-min" value={minQty} onChangeText={(v) => setMinQty(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" style={styles.input} />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Unit Cost (₹)</Text>
                <TextInput testID="s-cost" value={unitCost} onChangeText={(v) => setUnitCost(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" style={styles.input} />
              </View>
              {err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity testID="s-save" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Add Item'}</Text>}
              </TouchableOpacity>
              {editing && isAdmin && (
                <TouchableOpacity testID="s-delete" style={styles.deleteBtn} onPress={() => { remove(editing); setEditOpen(false); }}>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                  <Text style={styles.deleteText}>Delete Item</Text>
                </TouchableOpacity>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Movement Sheet */}
      <Modal visible={!!mvOpen} transparent animationType="slide" onRequestClose={() => setMvOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMvOpen(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>
                {mvOpen?.type === 'purchase' ? 'Purchase Stock' : 'Use Stock'}
              </Text>
              {mvOpen && (
                <>
                  <Text style={styles.mvItem}>{mvOpen.item.name} · Currently {mvOpen.item.current_qty} {mvOpen.item.unit}</Text>
                  <View style={styles.field}>
                    <Text style={styles.label}>Qty ({mvOpen.item.unit})</Text>
                    <TextInput testID="mv-qty" value={mvQty} onChangeText={(v) => setMvQty(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} autoFocus />
                  </View>
                  {mvOpen.type === 'purchase' && (
                    <>
                      <View style={styles.field}>
                        <Text style={styles.label}>Unit Cost (₹)</Text>
                        <TextInput testID="mv-cost" value={mvUnitCost} onChangeText={(v) => setMvUnitCost(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                      </View>
                      <View style={styles.mvSummary}>
                        <Text style={styles.mvSummaryText}>Total Cost: {fmtINR((Number(mvQty) || 0) * (Number(mvUnitCost) || 0))}</Text>
                        <Text style={styles.mvSummaryHint}>Auto-adds to Material expenses</Text>
                      </View>
                    </>
                  )}
                  {mvErr && <Text style={styles.err}>{mvErr}</Text>}
                  <TouchableOpacity testID="mv-save" style={[styles.saveBtn, mvOpen.type === 'use' && { backgroundColor: colors.error }]} onPress={saveMovement} disabled={mvSaving}>
                    {mvSaving ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.saveBtnText}>
                        {mvOpen.type === 'purchase' ? 'Add to Stock' : 'Use from Stock'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
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

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, borderRadius: radius.sm, height: 42, marginHorizontal: spacing.lg, marginVertical: spacing.md },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },

  chip: { flexShrink: 0, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff' },

  valueCard: { backgroundColor: colors.surfaceInverse, padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.md, ...shadows.strong },
  valueLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, letterSpacing: 0.5, fontWeight: '700' },
  valueVal: { color: colors.brandSecondary, fontSize: 26, fontWeight: '900', marginTop: 4 },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card },
  icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  itemMeta: { fontSize: 11, color: colors.onSurfaceTertiary },
  lowPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: '#FDF3E4', borderWidth: 1, borderColor: '#F0DCA6' },
  lowPillText: { fontSize: 10, fontWeight: '800', color: colors.warning },
  actionBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 16, color: colors.onSurfaceTertiary },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 4 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },

  unitChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },
  unitChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  unitChipText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  unitChipTextActive: { color: '#fff' },

  mvItem: { fontSize: 13, color: colors.onSurfaceSecondary, textAlign: 'center', marginTop: -4 },
  mvSummary: { backgroundColor: colors.brandTertiary, padding: spacing.md, borderRadius: radius.sm, gap: 4 },
  mvSummaryText: { fontSize: 14, fontWeight: '800', color: colors.brandPrimary },
  mvSummaryHint: { fontSize: 11, color: colors.onSurfaceTertiary },

  err: { color: colors.error, fontSize: 13, textAlign: 'center' },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  deleteText: { color: colors.error, fontWeight: '600' },
});
