import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Calendar } from 'react-native-calendars';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR, getCurrencySymbol } from '@/src/theme';
import { rowsToCsv, shareCsv, sharePdf, printOrShareHtml, buildReportHtml } from '@/src/utils/exportShare';
import {
  type ExpensePaymentToken,
  EXPENSE_PAYMENT_OPTIONS,
  paymentLabel,
  toExpenseToken,
} from '@/src/utils/paymentModes';

type Expense = {
  id: string; category: string; description: string; amount: number;
  date: string; payment_mode?: string; notes?: string;
  created_by_name?: string; created_at: string;
};

const CATEGORY_ICON: Record<string, any> = {
  Material: 'cube-outline',
  Utilities: 'flash-outline',
  Rent: 'home-outline',
  Salary: 'wallet-outline',
  Maintenance: 'construct-outline',
  Other: 'ellipsis-horizontal-outline',
};

const PAY_ICON: Record<ExpensePaymentToken, any> = {
  cash: 'cash-outline',
  card: 'card-outline',
  upi: 'qr-code-outline',
  bank: 'business-outline',
  other: 'ellipsis-horizontal-outline',
};

export default function ExpensesScreen() {
  const { user, tenant } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [list, setList] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<string[]>(['Material', 'Utilities', 'Rent', 'Salary', 'Maintenance', 'Other']);
  const [filter, setFilter] = useState<'today' | 'month' | 'all'>('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Editor
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [cat, setCat] = useState('Material');
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [expDate, setExpDate] = useState<string>('');
  const [payMode, setPayMode] = useState<ExpensePaymentToken>('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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
    setEditing(null); setCat('Material'); setDesc(''); setAmt('');
    setExpDate(today); setPayMode('cash');
    setNotes(''); setErr(null); setEditOpen(true);
  };
  const openEdit = (e: Expense) => {
    if (!isAdmin) return;
    setEditing(e); setCat(e.category); setDesc(e.description);
    setAmt(String(e.amount));
    setExpDate(e.date || today);
    setPayMode(toExpenseToken(e.payment_mode));
    setNotes(e.notes || ''); setErr(null); setEditOpen(true);
  };

  const save = async () => {
    setErr(null);
    if (!cat.trim()) { setErr('Category required'); return; }
    if (!desc.trim()) { setErr('Description required'); return; }
    const n = Number(amt);
    if (!(n > 0)) { setErr('Amount must be > 0'); return; }
    if (!expDate) { setErr('Date required'); return; }
    setSaving(true);
    try {
      const body = {
        category: cat.trim(),
        description: desc.trim(),
        amount: n,
        date: expDate,
        payment_mode: toExpenseToken(payMode),
        notes: notes.trim(),
      };
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

  const rangeLabel = filter === 'today' ? 'Today' : filter === 'month' ? 'This Month' : 'All';
  const dateSuffix = filter === 'today' ? today : filter === 'month' ? month : 'all';

  const buildRows = () => {
    const headers = ['Date', 'Category', 'Description', 'Amount (INR)', 'Notes', 'By'];
    const dataRows: (string | number)[][] = list.map(e => [
      e.date, e.category, e.description, e.amount, e.notes || '', e.created_by_name || '',
    ]);
    const totalRow: (string | number)[] = ['TOTAL', '', '', total, '', ''];
    return { headers, dataRows, totalRow };
  };

  const doShareCsv = async () => {
    setShareOpen(false);
    if (!list.length) return;
    const { headers, dataRows, totalRow } = buildRows();
    const csv = rowsToCsv(headers, [...dataRows, totalRow]);
    await shareCsv(csv, `expenses_${dateSuffix}.csv`);
  };

  const buildHtml = () => {
    const { headers, dataRows, totalRow } = buildRows();
    const summary = [
      { label: 'Range', value: rangeLabel },
      { label: 'Entries', value: String(list.length) },
      { label: 'Total Spent', value: `${getCurrencySymbol()}${total.toLocaleString('en-IN')}` },
      ...Object.entries(byCat).slice(0, 3).map(([c, a]) => ({ label: c, value: `${getCurrencySymbol()}${(a as number).toLocaleString('en-IN')}` })),
    ];
    return buildReportHtml({
      title: 'Expenses Report',
      subtitle: rangeLabel,
      brand: { name: tenant?.business_name, color: (tenant as any)?.brand_color || '#C42032', logo: (tenant as any)?.logo || null },
      summary,
      columns: headers,
      rows: dataRows,
      totalRow,
    });
  };

  const doSharePdf = async () => {
    setShareOpen(false);
    if (!list.length) return;
    await sharePdf(buildHtml(), `expenses_${dateSuffix}.pdf`);
  };

  const doPrint = async () => {
    setShareOpen(false);
    if (!list.length) return;
    await printOrShareHtml(buildHtml(), `expenses_${dateSuffix}.pdf`);
  };

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
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              testID="share-expenses-btn"
              onPress={() => { Haptics.selectionAsync(); setShareOpen(true); }}
              style={[styles.headerBtn, { backgroundColor: '#6B6862' }]}
              disabled={list.length === 0}
            >
              <Ionicons name="share-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity testID="add-expense-header" onPress={openAdd} style={styles.headerBtn}>
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
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
                <Text style={styles.ctaBtnText}>Add expense</Text>
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
                    {e.category} · {e.date}
                    {e.payment_mode ? ` · ${paymentLabel(e.payment_mode)}` : ''}
                    {e.created_by_name ? ` · ${e.created_by_name}` : ''}
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
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
                <View style={styles.handle} />
                <Text style={styles.sheetTitle}>{editing ? 'Edit expense' : 'Add expense'}</Text>
                <Text style={styles.sheetSubtitle}>Category-tagged daily expenses (type a custom category to add your own).</Text>

              <View style={styles.field}>
                <Text style={styles.label}>
                  Category (pick or type custom) <Text style={styles.req}>*</Text>
                </Text>
                <TextInput
                  testID="exp-category-input"
                  value={cat}
                  onChangeText={setCat}
                  placeholder="e.g. Rent, Electricity, Marketing"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: 6 }}>
                  {categories.map(c => (
                    <TouchableOpacity
                      key={c}
                      testID={`cat-${c}`}
                      onPress={() => { Haptics.selectionAsync(); setCat(c); }}
                      style={[styles.catChip, cat === c && styles.catChipActive]}
                    >
                      <Ionicons name={CATEGORY_ICON[c] || 'pricetag-outline'} size={14} color={cat === c ? '#fff' : colors.brandPrimary} />
                      <Text style={[styles.catChipText, cat === c && styles.catChipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Amount ({getCurrencySymbol()}) <Text style={styles.req}>*</Text></Text>
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
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Date</Text>
                  <TouchableOpacity
                    testID="exp-date-pick"
                    style={[styles.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
                    onPress={() => { Haptics.selectionAsync(); setDatePickerOpen(true); }}
                  >
                    <Ionicons name="calendar-outline" size={16} color={colors.onSurfaceTertiary} />
                    <Text style={{ fontSize: 14, color: expDate ? colors.onSurface : colors.onSurfaceTertiary }}>
                      {expDate || 'Pick a date'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Payment mode <Text style={styles.req}>*</Text></Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                  {EXPENSE_PAYMENT_OPTIONS.map(m => (
                    <TouchableOpacity
                      key={m}
                      testID={`paymode-${m}`}
                      onPress={() => { Haptics.selectionAsync(); setPayMode(m); }}
                      style={[styles.catChip, payMode === m && styles.catChipActive]}
                    >
                      <Ionicons name={PAY_ICON[m]} size={14} color={payMode === m ? '#fff' : colors.brandPrimary} />
                      <Text style={[styles.catChipText, payMode === m && styles.catChipTextActive]}>{paymentLabel(m)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Description <Text style={styles.req}>*</Text></Text>
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
                <Text style={styles.label}>Notes (optional)</Text>
                <TextInput
                  testID="exp-notes-input"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="e.g. Paid by owner in cash"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={[styles.input, { minHeight: 60 }]}
                  multiline
                />
              </View>

              {err && <Text style={styles.err}>{err}</Text>}

              <TouchableOpacity testID="exp-save-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>{editing ? 'Save' : 'Add expense'}</Text>
                )}
              </TouchableOpacity>

              {editing && isAdmin && (
                <TouchableOpacity testID="exp-delete-btn" style={styles.deleteBtn} onPress={() => { remove(editing); setEditOpen(false); }}>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </TouchableOpacity>
              )}
              </ScrollView>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Date picker modal (react-native-calendars) */}
      <Modal visible={datePickerOpen} transparent animationType="fade" onRequestClose={() => setDatePickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDatePickerOpen(false)}>
          <Pressable style={styles.datePickerSheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Pick a date</Text>
            <Calendar
              testID="exp-calendar"
              current={expDate || today}
              maxDate={today}
              onDayPress={(d) => {
                Haptics.selectionAsync();
                setExpDate(d.dateString);
                setDatePickerOpen(false);
              }}
              markedDates={expDate ? { [expDate]: { selected: true, selectedColor: colors.brandPrimary } } : {}}
              theme={{
                backgroundColor: colors.surface,
                calendarBackground: colors.surface,
                selectedDayBackgroundColor: colors.brandPrimary,
                selectedDayTextColor: '#fff',
                todayTextColor: colors.brandPrimary,
                dayTextColor: colors.onSurface,
                monthTextColor: colors.onSurface,
                arrowColor: colors.brandPrimary,
              }}
            />
            <TouchableOpacity style={styles.datePickerClose} onPress={() => setDatePickerOpen(false)}>
              <Text style={styles.datePickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Share options sheet */}
      <Modal visible={shareOpen} transparent animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.shareSheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Share Expenses</Text>
            <Text style={styles.shareSub}>{rangeLabel} · {list.length} entries · {fmtINR(total)}</Text>
            <TouchableOpacity testID="share-exp-csv" style={styles.shareAction} onPress={doShareCsv}>
              <View style={[styles.shareIcon, { backgroundColor: '#DDF3E4' }]}><Ionicons name="grid-outline" size={20} color="#207447" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.shareTitle}>CSV (Excel)</Text>
                <Text style={styles.shareDesc}>Spreadsheet format for analysis</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity testID="share-exp-pdf" style={styles.shareAction} onPress={doSharePdf}>
              <View style={[styles.shareIcon, { backgroundColor: '#FFE5E5' }]}><Ionicons name="document-text-outline" size={20} color="#C42032" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.shareTitle}>PDF</Text>
                <Text style={styles.shareDesc}>Formatted document with your branding</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity testID="share-exp-print" style={styles.shareAction} onPress={doPrint}>
              <View style={[styles.shareIcon, { backgroundColor: '#E5EEFF' }]}><Ionicons name="print-outline" size={20} color="#2551B4" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.shareTitle}>Print</Text>
                <Text style={styles.shareDesc}>Open printer dialog</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareCancel} onPress={() => setShareOpen(false)}>
              <Text style={styles.shareCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
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
  sheetSubtitle: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center', marginTop: -8, marginBottom: 4 },
  req: { color: colors.error, fontWeight: '800' },
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

  shareSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm, marginTop: 'auto', maxWidth: 480, width: '100%', alignSelf: 'center' },
  shareSub: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center', marginTop: -4 },
  shareAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  shareIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  shareTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  shareDesc: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  shareCancel: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  shareCancelText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 14 },

  datePickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md, marginTop: 'auto', maxWidth: 480, width: '100%', alignSelf: 'center' },
  datePickerClose: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  datePickerCloseText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 14 },
});
