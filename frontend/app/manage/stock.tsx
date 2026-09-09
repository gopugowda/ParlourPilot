import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, Alert,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import { useFilterState } from '@/src/hooks/useFilterState';
import { FilterSheet, FilterHeaderButton, FilterSection, FilterChip } from '@/src/components/FilterSheet';
import { ExportMenu, type ExportAction, ReportEmptyState } from '@/src/components/ReportKit';
import { rowsToCsv, shareCsv, sharePdf, printOrShareHtml, buildReportHtml } from '@/src/utils/exportShare';
import { BarcodeScanner } from '@/src/components/BarcodeScanner';
import { isOcrAvailable, scanProductNameFromCamera } from '@/src/utils/ocr';
import { getBarcode, getVisibleNotes, withBarcodeMarker } from '@/src/utils/barcode';

type StockItem = {
  id: string; name: string; unit: string;
  category?: string;
  barcode?: string | null;
  branch_id?: string; branch_name?: string;
  current_qty: number; min_qty: number; unit_cost: number;
  low_stock: boolean; notes?: string;
};

const UNITS = ['piece', 'ml', 'g', 'kg', 'L', 'pack', 'bottle'];
const DEFAULT_CATEGORIES = ['General', 'Hair', 'Skin', 'Nails', 'Waxing', 'Retail', 'Consumables'];

export default function StockScreen() {
  const router = useRouter();
  const { user, branches } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [list, setList] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Item editor
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('piece');
  const [category, setCategory] = useState('General');
  const [curQty, setCurQty] = useState('0');
  const [minQty, setMinQty] = useState('0');
  const [unitCost, setUnitCost] = useState('0');
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);

  // Barcode scanner
  // 'search'  → find existing item, then open the Edit modal
  // 'edit'    → filling the barcode field inside the Add/Edit sheet
  const [scannerMode, setScannerMode] = useState<null | 'search' | 'edit'>(null);
  const [scanBusy, setScanBusy] = useState(false);

  // Persistent filters
  const [fsOpen, setFsOpen] = useState(false);
  const { filters, setFilters, resetFilters, activeCount } = useFilterState('stock', {
    category: null as string | null,
    stockStatus: null as 'low' | 'out' | null,
    branchId: null as string | null,
  });

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
    setEditing(null); setName(''); setUnit('piece'); setCategory('General');
    setCurQty('0'); setMinQty('0'); setUnitCost('0'); setBarcode('');
    setErr(null); setEditOpen(true);
  };
  const openEdit = (it: StockItem) => {
    if (!isAdmin) return;
    setEditing(it); setName(it.name); setUnit(it.unit);
    setCategory(it.category || 'General');
    setCurQty(String(it.current_qty)); setMinQty(String(it.min_qty));
    setUnitCost(String(it.unit_cost));
    // Prefer canonical `barcode`; fall back to `[bc:…]` marker inside notes
    // so items saved against the pre-deploy backend still show their barcode.
    setBarcode(getBarcode(it));
    setErr(null); setEditOpen(true);
  };

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try {
      const bc = barcode.trim();
      const visibleNotes = editing ? getVisibleNotes(editing) : '';
      const body: any = {
        name: name.trim(),
        unit,
        category: category.trim() || 'General',
        current_qty: Number(curQty) || 0,
        min_qty: Number(minQty) || 0,
        unit_cost: Number(unitCost) || 0,
        // Persist barcode both ways: canonical field (once backend has
        // it) AND embedded marker inside `notes` (works today). Both
        // are strings — leading zeros preserved.
        notes: withBarcodeMarker(bc, visibleNotes),
      };
      if (bc) body.barcode = bc;
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

  // ---- Barcode scan → find or create ----------------------------------
  const handleScanned = useCallback(async ({ value }: { value: string; type: string }) => {
    const mode = scannerMode;
    setScannerMode(null);
    if (!value) return;

    // Mode B: filling the barcode field inside the editor.
    if (mode === 'edit') {
      setBarcode(value);
      return;
    }

    // Mode A: search the current tenant's stock. Look client-side
    // first (fast, works even if the deployed backend hasn't received
    // the by-barcode endpoint yet — reads the [bc:…] marker embedded
    // in notes), then fall back to the server.
    setScanBusy(true);
    try {
      let match: StockItem | null =
        list.find(it => getBarcode(it) === value) || null;

      if (!match) {
        try {
          const found = await api<StockItem>(`/stock/by-barcode/${encodeURIComponent(value)}`);
          if (found?.id) match = found as StockItem;
        } catch (e: any) {
          // 404 → unknown barcode; anything else → surface politely.
          if (e?.status && e.status !== 404) {
            Alert.alert('Barcode lookup failed', e.message || 'Please try again.');
            return;
          }
        }
      }

      if (match) {
        // Smart-scan: skip the mini quick-sheet and open the full
        // Edit Item modal with every field pre-populated. Staff only
        // needs to bump Current Qty and tap Save. The `[bc:…]` marker
        // travels with `notes` (and canonical `barcode` if the
        // backend has it) — see save() and openEdit().
        if (!isAdmin) {
          Alert.alert('Product found', `${match.name}\n\nCurrent stock: ${match.current_qty} ${match.unit}`);
          return;
        }
        openEdit(match);
        return;
      }

      // Unknown barcode → prompt for new-product flow.
      if (!isAdmin) {
        Alert.alert('Not found', 'This barcode is not registered. Ask an admin to add it.');
        return;
      }
      Alert.alert(
        'Barcode not registered',
        `We couldn't find a product for ${value}. Do you want to add it?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add product',
            onPress: () => {
              setEditing(null);
              setName(''); setUnit('piece'); setCategory('General');
              setCurQty('0'); setMinQty('0'); setUnitCost('0');
              setBarcode(value);
              setErr(null);
              setEditOpen(true);
            },
          },
        ],
      );
    } finally {
      setScanBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerMode, list, isAdmin]);

  const confirmFoundStock = undefined as any;  // deprecated — smart-scan opens Edit modal directly
  void confirmFoundStock;

  // ---- OCR helper — used from inside the Add-item sheet ---------------
  const runOcrForName = async () => {
    if (ocrBusy) return;                              // debounce
    if (!isOcrAvailable()) {
      Alert.alert(
        'OCR requires a build',
        'Product-name scanning uses on-device text recognition and needs the ParlourPilot production build (Expo Go does not include it). You can still type the name in.',
      );
      return;
    }
    setOcrBusy(true);
    try {
      const outcome = await scanProductNameFromCamera();
      switch (outcome.kind) {
        case 'success': {
          setName(outcome.data.suggestedName);       // populate + let user edit
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        }
        case 'canceled':
          // Silent — user chose to back out.
          break;
        case 'permission_denied':
          Alert.alert(
            'Camera permission needed',
            'Allow camera access in Settings so we can scan the product label.',
          );
          break;
        case 'empty':
          Alert.alert(
            'No text detected',
            'Please take a clearer photo of the product label in good light.',
          );
          break;
        case 'unavailable':
          Alert.alert(
            'OCR unavailable',
            'The on-device text recognizer is not available in this build. Please publish a new production build to enable Scan Name.',
          );
          break;
        case 'error':
          Alert.alert('Could not read the label', outcome.message);
          break;
      }
    } finally {
      setOcrBusy(false);
    }
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
    .filter(it => !search || it.name.toLowerCase().includes(search.toLowerCase()))
    .filter(it => !filters.category || (it.category || 'General') === filters.category)
    .filter(it => {
      if (filters.stockStatus === 'low')  return !!it.low_stock;
      if (filters.stockStatus === 'out')  return (it.current_qty || 0) <= 0;
      return true;
    })
    .filter(it => !filters.branchId || it.branch_id === filters.branchId);

  const lowCount = list.filter(i => i.low_stock).length;
  const inventoryValue = list.reduce((s, i) => s + i.current_qty * i.unit_cost, 0);

  const availableCategories = Array.from(new Set([
    ...DEFAULT_CATEGORIES,
    ...list.map(i => i.category || 'General'),
  ]));

  // ---- Export / Share -------------------------------------------------
  const { tenant } = useAuth();
  const [exportOpen, setExportOpen] = useState(false);
  const stockStatusLabel = (it: StockItem) =>
    (it.current_qty || 0) <= 0 ? 'Out of stock' : it.low_stock ? 'Low stock' : 'In stock';
  const exportHeaders = ['Item', 'Category', 'Unit', 'Current Qty', 'Min Qty', 'Unit Cost', 'Value', 'Status', 'Branch'];
  const buildRows = () => filtered.map(it => [
    it.name || '',
    it.category || 'General',
    it.unit || '',
    String(it.current_qty ?? 0),
    String(it.min_qty ?? 0),
    fmtINR(it.unit_cost || 0),
    fmtINR((it.current_qty || 0) * (it.unit_cost || 0)),
    stockStatusLabel(it),
    it.branch_name || '',
  ]);
  const rangeLabel = () => {
    const parts: string[] = [];
    if (filters.category) parts.push(filters.category);
    if (filters.stockStatus) parts.push(filters.stockStatus === 'low' ? 'Low' : 'Out');
    if (filters.branchId) parts.push(branches.find((b: any) => b.id === filters.branchId)?.name || 'Branch');
    if (search) parts.push(`"${search}"`);
    return parts.join(' · ') || 'All stock';
  };
  const dateSuffix = () => new Date().toISOString().slice(0, 10);
  const doExport = async (a: ExportAction) => {
    const rows = buildRows();
    if (rows.length === 0) return;
    if (a === 'csv') {
      await shareCsv(rowsToCsv(exportHeaders, rows), `stock_${dateSuffix()}.csv`);
      return;
    }
    const filteredValue = filtered.reduce((s, i) => s + (i.current_qty || 0) * (i.unit_cost || 0), 0);
    const html = buildReportHtml({
      title: 'Stock Report',
      subtitle: `${rangeLabel()} · ${rows.length} item${rows.length === 1 ? '' : 's'}`,
      brand: { name: tenant?.business_name, color: colors.brandPrimary, logo: (tenant as any)?.logo || null },
      summary: [
        { label: 'Items', value: String(rows.length) },
        { label: 'Low', value: String(filtered.filter(i => i.low_stock).length) },
        { label: 'Value', value: fmtINR(filteredValue) },
      ],
      columns: exportHeaders,
      rows,
    });
    if (a === 'pdf') { await sharePdf(html, `stock_${dateSuffix()}.pdf`); return; }
    await printOrShareHtml(html, `stock_${dateSuffix()}.pdf`);
  };

  return (
    <View style={styles.root} testID="stock-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={styles.hIcon}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle} numberOfLines={1} adjustsFontSizeToFit>Stock</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{filtered.length} of {list.length} · {lowCount} low</Text>
        </View>
        <TouchableOpacity
          testID="scan-product-btn"
          onPress={() => setScannerMode('search')}
          style={styles.hIcon}
          accessibilityLabel="Scan product"
        >
          <Ionicons name="barcode-outline" size={20} color={colors.brandPrimary} />
        </TouchableOpacity>
        <FilterHeaderButton count={activeCount} onPress={() => setFsOpen(true)} testID="stock-filter-btn" />
        <TouchableOpacity
          testID="stock-menu-btn"
          onPress={() => setExportOpen(true)}
          style={styles.hIcon}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.brandPrimary} />
        </TouchableOpacity>
        {isAdmin && (
          <TouchableOpacity testID="add-item-btn" onPress={openAdd} style={[styles.headerBtn, { marginLeft: 2 }]}>
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
        {[
          { k: 'low' as const,  label: `Low Stock (${lowCount})` },
          { k: 'out' as const,  label: 'Out of stock' },
        ].map(c => {
          const active = filters.stockStatus === c.k;
          return (
            <TouchableOpacity
              key={c.k}
              testID={`stock-quick-${c.k}`}
              onPress={() => setFilters({ stockStatus: active ? null : c.k })}
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

          {filtered.length === 0 && list.length > 0 ? (
            <ReportEmptyState
              icon="cube-outline"
              message="No stock items found for the selected filters."
              onReset={() => { setSearch(''); resetFilters(); }}
            />
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No items yet</Text>
              {isAdmin && (
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
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{editing ? 'Edit item' : 'Add item'}</Text>
            <KeyboardAwareScrollView
              bottomOffset={24}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
            >
              {/* Barcode row (optional). Sits at the top so scanned
                  data lands here immediately after a barcode scan. */}
              <View style={styles.field}>
                <Text style={styles.label}>Barcode (optional)</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TextInput
                    testID="s-barcode"
                    value={barcode}
                    onChangeText={(v) => setBarcode(v.replace(/\s+/g, ''))}
                    placeholder="Scan or type"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    keyboardType="default"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { flex: 1 }]}
                  />
                  <TouchableOpacity
                    testID="s-scan-bc"
                    onPress={() => setScannerMode('edit')}
                    style={styles.pillBtn}
                  >
                    <Ionicons name="barcode-outline" size={14} color={colors.brandPrimary} />
                    <Text style={styles.pillBtnText}>Scan</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.field}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.label, { flex: 1 }]}>Name</Text>
                  {!editing && (
                    <TouchableOpacity
                      testID="s-ocr-name"
                      onPress={runOcrForName}
                      disabled={ocrBusy}
                      style={styles.pillBtn}
                    >
                      {ocrBusy ? (
                        <ActivityIndicator size="small" color={colors.brandPrimary} />
                      ) : (
                        <Ionicons name="scan-outline" size={14} color={colors.brandPrimary} />
                      )}
                      <Text style={styles.pillBtnText}>{ocrBusy ? 'Reading…' : 'Scan name'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput testID="s-name" value={name} onChangeText={setName} placeholder="e.g. Shampoo" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Category</Text>
                <TextInput
                  testID="s-category"
                  value={category}
                  onChangeText={setCategory}
                  placeholder="Type or pick below"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.input}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                  {availableCategories.map(c => (
                    <TouchableOpacity
                      key={c}
                      testID={`s-cat-${c}`}
                      onPress={() => setCategory(c)}
                      style={[styles.unitChip, category === c && styles.unitChipActive]}
                    >
                      <Text style={[styles.unitChipText, category === c && styles.unitChipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
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
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{editing ? 'Save' : 'Add item'}</Text>}
              </TouchableOpacity>
              {editing && isAdmin && (
                <TouchableOpacity testID="s-delete" style={styles.deleteBtn} onPress={() => { remove(editing); setEditOpen(false); }}>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                  <Text style={styles.deleteText}>Delete Item</Text>
                </TouchableOpacity>
              )}
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Movement Sheet */}
      <Modal visible={!!mvOpen} transparent animationType="slide" onRequestClose={() => setMvOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMvOpen(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>
              {mvOpen?.type === 'purchase' ? 'Purchase Stock' : 'Use Stock'}
            </Text>
            <KeyboardAwareScrollView
              bottomOffset={24}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
            >
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
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <FilterSheet
        visible={fsOpen}
        onClose={() => setFsOpen(false)}
        onClear={resetFilters}
        title="Filter stock"
        testID="stock-filter-sheet"
      >
        <FilterSection label="Category">
          <FilterChip label="Any" selected={!filters.category} onPress={() => setFilters({ category: null })} testID="stock-fs-cat-any" />
          {availableCategories.map(c => (
            <FilterChip key={c} label={c} selected={filters.category === c} onPress={() => setFilters({ category: c })} testID={`stock-fs-cat-${c}`} />
          ))}
        </FilterSection>
        <FilterSection label="Stock Status">
          <FilterChip label="Any" selected={!filters.stockStatus} onPress={() => setFilters({ stockStatus: null })} testID="stock-fs-status-any" />
          <FilterChip label="Low stock" selected={filters.stockStatus === 'low'} onPress={() => setFilters({ stockStatus: 'low' })} testID="stock-fs-status-low" />
          <FilterChip label="Out of stock" selected={filters.stockStatus === 'out'} onPress={() => setFilters({ stockStatus: 'out' })} testID="stock-fs-status-out" />
        </FilterSection>
        {(branches || []).length > 1 && (
          <FilterSection label="Branch">
            <FilterChip label="Any" selected={!filters.branchId} onPress={() => setFilters({ branchId: null })} testID="stock-fs-branch-any" />
            {(branches as any[]).map(b => (
              <FilterChip key={b.id} label={b.name} selected={filters.branchId === b.id} onPress={() => setFilters({ branchId: b.id })} testID={`stock-fs-branch-${b.id}`} />
            ))}
          </FilterSection>
        )}
      </FilterSheet>

      <ExportMenu
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export Stock"
        subtitle={`${rangeLabel()} · ${filtered.length} item${filtered.length === 1 ? '' : 's'}`}
        onPick={doExport}
      />

      {/* Barcode scanner modal (used for both search-and-add-stock and
          filling the barcode field in the editor). */}
      <BarcodeScanner
        visible={scannerMode != null}
        onClose={() => setScannerMode(null)}
        onScanned={handleScanned}
        title={scannerMode === 'edit' ? 'Scan barcode' : 'Scan product'}
        hint={scannerMode === 'edit'
          ? 'Point the camera at the barcode to fill the field.'
          : 'We look up the product in your salon\'s stock.'}
      />

      {scanBusy && (
        <View style={styles.scanBusy} pointerEvents="none">
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
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

  pillBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary, alignSelf: 'flex-start' },
  pillBtnText: { fontSize: 11, fontWeight: '700', color: colors.brandPrimary },

  foundCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },

  scanBusy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.6)' },
});
