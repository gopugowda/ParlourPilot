import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

type Expense = {
  id: string; category: string; description: string; amount: number;
  date: string; notes?: string; created_by_name?: string; created_at: string;
};

const CATEGORY_ICON: Record<string, any> = {
  Material: 'cube-outline',
  Utilities: 'flash-outline',
  Rent: 'home-outline',
  Salary: 'wallet-outline',
  Maintenance: 'construct-outline',
  Other: 'ellipsis-horizontal-outline',
};

export default function ExpensesScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [list, setList] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<string[]>(['Material', 'Utilities', 'Rent', 'Salary', 'Maintenance', 'Other']);
  const [filter, setFilter] = useState<'today' | 'month' | 'all'>('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Editor
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [cat, setCat] = useState('Material');
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const load = async () => {
    try {
      let q = '';
      if (isAdmin) {
        if (filter === 'today') q = `?date=${today}`;
        else if (filter === 'month') q = `?month=${month}`;
      }
      const [rows, cats] = await Promise.all([
        api<Expense[]>(`/expenses${q}`),
        api<string[]>('/expenses/categories').catch(() => categories),
      ]);
      setList(rows || []);
      if (Array.isArray(cats) && cats.length) setCategories(cats);
    } catch {}
  };

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [filter]);
  useFocusEffect(useCallback(() => { load(); }, [filter]));

  const openAdd = () => {
    setEditing(null); setCat('Material'); setDesc(''); setAmt(''); setNotes(''); setErr(null); setEditOpen(true);
  };
  const openEdit = (e: Expense) => {
    if (!isAdmin) return;
    setEditing(e); setCat(e.category); setDesc(e.description);
    setAmt(String(e.amount)); setNotes(e.notes || ''); setErr(null); setEditOpen(true);
  };

  const save = async () => {
    setErr(null);
    if (!desc.trim()) { setErr('Description required'); return; }
    const n = Number(amt);
    if (!(n > 0)) { setErr('Amount must be > 0'); return; }
    setSaving(true);
    try {
      const body = { category: cat, description: desc.trim(), amount: n, notes: notes.trim(), date: editing?.date };
      if (editing) await api(`/expenses/${editing.id}`, { method: 'PUT', body });
      else await api('/expenses', { method: 'POST', body });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false);
      await load();
    } catch (e: any) { setErr(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (e: Expense) => {
    if (!isAdmin) return;
    try { await api(`/expenses/${e.id}`, { method: 'DELETE' }); await load(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  };

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const total = list.reduce((s, e) => s + e.amount, 0);
  const byCat: Record<string, number> = {};
  list.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });

  const chips: { key: any; label: string }[] = isAdmin
    ? [{ key: 'today', label: 'Today' }, { key: 'month', label: 'This Month' }, { key: 'all', label: 'All' }]
    : [{ key: 'today', label: 'Today' }];

  return (
    <View style={styles.root} testID="expenses-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.headerTitle}>Expenses</Text>
            <Text style={styles.headerSub}>{list.length} entries · {fmtINR(total)}</Text>
          </View>
          <TouchableOpacity testID="add-expense-header" onPress={openAdd} style={styles.headerBtn}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {isAdmin && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {chips.map(c => {
              const active = filter === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  testID={`filter-${c.key}`}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => { Haptics.selectionAsync(); setFilter(c.key); }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
        >
          {/* Category summary */}
          {Object.keys(byCat).length > 0 && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Spent</Text>
              <Text style={styles.summaryVal}>{fmtINR(total)}</Text>
              <View style={styles.catRow}>
                {Object.entries(byCat).map(([c, amt]) => (
                  <View key={c} style={styles.catPill}>
                    <Ionicons name={CATEGORY_ICON[c] || 'ellipsis-horizontal-outline'} size={12} color={colors.brandPrimary} />
                    <Text style={styles.catPillText}>{c} · {fmtINR(amt)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {list.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="wallet-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No expenses recorded</Text>
              <Text style={styles.emptySub}>Tap + to add materials, water bill, salary, etc.</Text>
              <TouchableOpacity testID="empty-add" style={styles.ctaBtn} onPress={openAdd}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.ctaBtnText}>Add Expense</Text>
              </TouchableOpacity>
            </View>
          ) : (
            list.map(e => (
              <TouchableOpacity
                key={e.id}
                testID={`exp-row-${e.id}`}
                style={styles.expenseRow}
                activeOpacity={isAdmin ? 0.85 : 1}
                onPress={() => openEdit(e)}
                onLongPress={() => remove(e)}
              >
                <View style={[styles.catIcon, { backgroundColor: colors.brandTertiary }]}>
                  <Ionicons name={CATEGORY_ICON[e.category] || 'ellipsis-horizontal-outline'} size={18} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expDesc}>{e.description}</Text>
                  <Text style={styles.expMeta}>
                    {e.category} · {e.date}{e.created_by_name ? ` · ${e.created_by_name}` : ''}
                  </Text>
                </View>
                <Text style={styles.expAmt}>{fmtINR(e.amount)}</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* Editor Modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit Expense' : 'Add Expense'}</Text>

              <View style={styles.field}>
                <Text style={styles.label}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                  {categories.map(c => (
                    <TouchableOpacity
                      key={c}
                      testID={`cat-${c}`}
                      onPress={() => { Haptics.selectionAsync(); setCat(c); }}
                      style={[styles.catChip, cat === c && styles.catChipActive]}
                    >
                      <Ionicons name={CATEGORY_ICON[c]} size={14} color={cat === c ? '#fff' : colors.brandPrimary} />
                      <Text style={[styles.catChipText, cat === c && styles.catChipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  testID="exp-desc-input"
                  value={desc}
                  onChangeText={setDesc}
                  placeholder="e.g. Shampoo stock, Electricity bill"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Amount (₹)</Text>
                <TextInput
                  testID="exp-amount-input"
                  value={amt}
                  onChangeText={(v) => setAmt(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Notes (optional)</Text>
                <TextInput
                  testID="exp-notes-input"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="e.g. Paid by owner in cash"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
              </View>

              {err && <Text style={styles.err}>{err}</Text>}

              <TouchableOpacity testID="exp-save-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Add Expense'}</Text>
                )}
              </TouchableOpacity>

              {editing && isAdmin && (
                <TouchableOpacity testID="exp-delete-btn" style={styles.deleteBtn} onPress={() => { remove(editing); setEditOpen(false); }}>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                  <Text style={styles.deleteBtnText}>Delete</Text>
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
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: spacing.md },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary, ...shadows.card },

  chipRow: { gap: spacing.sm, paddingRight: spacing.md },
  chip: {
    flexShrink: 0, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill,
    justifyContent: 'center', backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff' },

  summaryCard: {
    backgroundColor: colors.surfaceInverse, padding: spacing.lg, borderRadius: radius.md,
    marginBottom: spacing.lg, ...shadows.strong,
  },
  summaryLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, letterSpacing: 0.5 },
  summaryVal: { color: colors.brandSecondary, fontSize: 30, fontWeight: '900', marginTop: 4 },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  catPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(228,192,112,0.15)', borderWidth: 1, borderColor: 'rgba(228,192,112,0.3)' },
  catPillText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  expenseRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card,
  },
  catIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  expDesc: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  expMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  expAmt: { fontSize: 15, fontWeight: '800', color: colors.error },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md, maxHeight: '90%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },

  catChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },
  catChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  catChipText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  catChipTextActive: { color: '#fff' },

  err: { color: colors.error, fontSize: 13, textAlign: 'center' },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  deleteBtnText: { color: colors.error, fontWeight: '600' },
});
