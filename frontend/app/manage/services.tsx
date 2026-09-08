import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, Switch, Platform,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR, getCurrencySymbol } from '@/src/theme';
import { useFilterState } from '@/src/hooks/useFilterState';
import { FilterSheet, FilterHeaderButton, FilterSection, FilterChip } from '@/src/components/FilterSheet';
import { ExportMenu, type ExportAction, ReportEmptyState } from '@/src/components/ReportKit';
import { rowsToCsv, shareCsv, sharePdf, printOrShareHtml, buildReportHtml } from '@/src/utils/exportShare';

type Gender = 'ladies' | 'men' | 'unisex';
type Service = {
  id: string; name: string; price: number;
  item_code?: string;                       // NEW: numeric zero-padded string (e.g. "001")
  // Web writes these two (primary):
  service_type?: 'Ladies' | 'Men' | 'Unisex' | string;
  variable_price?: boolean;
  // Mobile-only additional keys (backward compat):
  additional_price?: number; gender?: Gender;
  category: string; tax_percentage?: number; active: boolean;
};

// Digits-only; zero-pad to 3 min (matches backend rule). Empty stays empty.
const sanitizeItemCode = (v: string): string => (v || '').replace(/\D+/g, '');
const padItemCode = (v: string): string => {
  const d = sanitizeItemCode(v);
  if (!d) return '';
  return d.length < 3 ? d.padStart(3, '0') : d;
};

/**
 * Compute the next item_code from the currently-loaded services list.
 * Used as a client-side fallback when `/api/services/next-code` is not
 * yet available on the backend (older deployments). Mirrors the backend
 * rule: max(existing_codes as int) + 1, zero-padded to 3.
 */
const nextItemCodeFromList = (services: Service[]): string => {
  let max = 0;
  for (const s of services) {
    const d = (s.item_code || '').replace(/\D+/g, '');
    if (!d) continue;
    const n = parseInt(d, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return padItemCode(String(max + 1));
};

// Normalise web's TitleCase service_type to mobile's lowercase gender.
const readGender = (s: Service): Gender => {
  const st = (s.service_type || '').toString().toLowerCase();
  if (st === 'ladies' || st === 'men' || st === 'unisex') return st as Gender;
  return (s.gender as Gender) || 'unisex';
};

export default function ServicesScreen() {
  const router = useRouter();
  const { user, tenant } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [list, setList] = useState<Service[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
  const [itemCode, setItemCode] = useState('');
  const [itemCodeErr, setItemCodeErr] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<'all' | Gender>('all');

  // Persistent filters
  const [fsOpen, setFsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { filters, setFilters, resetFilters, activeCount } = useFilterState('services', {
    category: null as string | null,
    status: null as 'active' | 'inactive' | null,
    priceType: null as 'fixed' | 'variable' | null,
  });

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

  const openAdd = async () => {
    setEditing(null); setName(''); setPrice(''); setAdditionalPrice('');
    setGender('unisex'); setCategory('General'); setTaxPct(''); setActive(true);
    setItemCode(''); setItemCodeErr(null);
    setErr(null); setEditOpen(true);
    // Prefill next item code: try backend first, fall back to computing it
    // locally from the current services list (max + 1, padded to 3).
    let filled = '';
    try {
      const nc: any = await api('/services/next-code');
      if (nc && typeof nc.item_code === 'string' && /^\d+$/.test(nc.item_code)) {
        filled = nc.item_code;
      }
    } catch { /* endpoint not live yet — fall through to local calc */ }
    if (!filled) filled = nextItemCodeFromList(list);
    setItemCode(filled);
  };
  const openEdit = async (s: Service) => {
    setEditing(s); setName(s.name); setPrice(String(s.price));
    // Web writes `variable_price: bool` — reflect it as ON toggle even if additional_price is missing.
    const hasVariable = !!s.variable_price || (s.additional_price ?? 0) > 0;
    setAdditionalPrice(hasVariable ? String(s.additional_price || 100) : '');
    setGender(readGender(s));
    setCategory(s.category);
    setTaxPct(s.tax_percentage ? String(s.tax_percentage) : '');
    setActive(s.active);
    setItemCode(s.item_code || ''); setItemCodeErr(null);
    setErr(null); setEditOpen(true);
    // If this service has no item_code yet (e.g. created before the item_code
    // feature shipped), suggest the next available one — user can accept or edit.
    if (!s.item_code) {
      let filled = '';
      try {
        const nc: any = await api('/services/next-code');
        if (nc && typeof nc.item_code === 'string' && /^\d+$/.test(nc.item_code)) {
          filled = nc.item_code;
        }
      } catch { /* endpoint not live — fall back */ }
      if (!filled) filled = nextItemCodeFromList(list);
      setItemCode(filled);
    }
  };

  const save = async () => {
    setErr(null); setItemCodeErr(null);
    if (!name.trim()) { setErr('Name required'); return; }
    const p = Number(price);
    if (!(p > 0)) { setErr('Price must be > 0'); return; }
    const ap = Number(additionalPrice);
    if (additionalPrice && (!Number.isFinite(ap) || ap < 0)) {
      setErr('Additional price must be 0 or greater'); return;
    }
    const tx = Number(taxPct);
    if (taxPct && (!Number.isFinite(tx) || tx < 0 || tx > 100)) { setErr('Tax % must be between 0 and 100'); return; }
    // Item code: optional. If provided, must be digits only.
    const trimmedCode = (itemCode || '').trim();
    if (trimmedCode && !/^\d+$/.test(trimmedCode)) {
      setItemCodeErr('Item code can only contain numbers'); return;
    }
    setSaving(true);
    try {
      const body: any = {
        name: name.trim(), price: p,
        additional_price: Number.isFinite(ap) ? ap : 0,
        gender,
        category: category.trim() || 'General',
        tax_percentage: Number.isFinite(tx) ? tx : 0,
        active,
      };
      // Only send item_code when the field is non-empty (blank = backend auto-assigns).
      if (trimmedCode) body.item_code = padItemCode(trimmedCode);
      if (editing) await api(`/services/${editing.id}`, { method: 'PUT', body });
      else await api('/services', { method: 'POST', body });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false);
      await load();
    } catch (e: any) {
      // Friendly error mapping for backend 400/409 on item_code.
      const raw = (e?.message || '').toString();
      const lower = raw.toLowerCase();
      if (lower.includes('item code') && lower.includes('digit')) {
        setItemCodeErr('Item code can only contain numbers');
      } else if (
        lower.includes('already') || lower.includes('duplicate') || lower.includes('unique') ||
        lower.includes('409') || lower.includes('item code') && lower.includes('exist')
      ) {
        setItemCodeErr('That item code is already used — pick another');
      } else {
        setErr(raw || 'Failed');
      }
    }
    finally { setSaving(false); }
  };

  const remove = async (s: Service) => {
    try { await api(`/services/${s.id}`, { method: 'DELETE' }); await load(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  };

  const filtered = list.filter(s => {
    if (genderFilter !== 'all' && readGender(s) !== genderFilter) return false;
    if (filters.category && (s.category || 'General') !== filters.category) return false;
    if (filters.status === 'active' && s.active === false) return false;
    if (filters.status === 'inactive' && s.active !== false) return false;
    if (filters.priceType === 'variable' && !s.variable_price) return false;
    if (filters.priceType === 'fixed' && s.variable_price) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !(s.item_code || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const availableCategories = Array.from(new Set([
    ...list.map(s => s.category || 'General'),
    ...categories,
  ])).sort();

  // ---- Export / Share -------------------------------------------------
  const exportHeaders = ['Code', 'Name', 'Category', 'Type', 'Price', 'Variable', 'Tax %', 'Status'];
  const buildExportRows = () => filtered.map(s => [
    s.item_code || '',
    s.name || '',
    s.category || 'General',
    readGender(s) === 'ladies' ? 'Ladies' : readGender(s) === 'men' ? 'Men' : 'Unisex',
    fmtINR(s.price || 0),
    s.variable_price ? 'Yes' : 'No',
    s.tax_percentage == null ? '' : String(s.tax_percentage),
    s.active === false ? 'Inactive' : 'Active',
  ]);
  const rangeLabel = () => {
    const parts: string[] = [];
    if (genderFilter !== 'all') parts.push(genderFilter);
    if (filters.category) parts.push(filters.category);
    if (filters.status) parts.push(filters.status);
    if (filters.priceType) parts.push(filters.priceType);
    if (search) parts.push(`"${search}"`);
    return parts.join(' · ') || 'All services';
  };
  const dateSuffix = () => new Date().toISOString().slice(0, 10);
  const doExport = async (a: ExportAction) => {
    const rows = buildExportRows();
    if (rows.length === 0) return;
    if (a === 'csv') { await shareCsv(rowsToCsv(exportHeaders, rows), `services_${dateSuffix()}.csv`); return; }
    const html = buildReportHtml({
      title: 'Services',
      subtitle: `${rangeLabel()} · ${rows.length} record${rows.length === 1 ? '' : 's'}`,
      brand: { name: tenant?.business_name, color: colors.brandPrimary, logo: (tenant as any)?.logo || null },
      summary: [
        { label: 'Total', value: String(rows.length) },
        { label: 'Active', value: String(filtered.filter(s => s.active !== false).length) },
      ],
      columns: exportHeaders,
      rows,
    });
    if (a === 'pdf') { await sharePdf(html, `services_${dateSuffix()}.pdf`); return; }
    await printOrShareHtml(html, `services_${dateSuffix()}.pdf`);
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
          <Text style={styles.headerSub}>{filtered.length} of {list.length}</Text>
        </View>
        <FilterHeaderButton count={activeCount} onPress={() => setFsOpen(true)} testID="svc-filter-btn" />
        <TouchableOpacity
          testID="svc-menu-btn"
          onPress={() => setExportOpen(true)}
          style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.brandPrimary} />
        </TouchableOpacity>
        {isAdmin && (
          <TouchableOpacity testID="add-service-header" onPress={openAdd} style={[styles.headerBtn, { marginLeft: spacing.sm }]}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={colors.onSurfaceTertiary} />
        <TextInput
          testID="svc-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search services by name or code"
          placeholderTextColor={colors.onSurfaceTertiary}
          style={styles.searchInput}
        />
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          {/* Gender filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }} style={{ flexGrow: 0 }}>
            {([
              { k: 'all', label: `All (${list.length})` },
              { k: 'ladies', label: `Ladies (${list.filter(x => readGender(x) === 'ladies').length})` },
              { k: 'men', label: `Men (${list.filter(x => readGender(x) === 'men').length})` },
              { k: 'unisex', label: `Unisex (${list.filter(x => readGender(x) === 'unisex').length})` },
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
          {list.length > 0 && filtered.length === 0 && (
            <ReportEmptyState
              icon="pricetags-outline"
              message="No services found for the selected filters."
              onReset={() => { setSearch(''); setGenderFilter('all'); resetFilters(); }}
            />
          )}
          {filtered.map(s => {
              const g = readGender(s);
              const gCol = g === 'ladies' ? '#D9337B' : g === 'men' ? '#2E6BE6' : colors.brandPrimary;
              return (
                <View key={s.id} style={styles.row} testID={`svc-row-${s.id}`}>
                  {s.item_code ? (
                    <View style={styles.codeBadge}>
                      <Text style={styles.codeBadgeText}>{s.item_code}</Text>
                    </View>
                  ) : null}
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
                      {(s.variable_price || (s.additional_price ?? 0) > 0) ? ` · Variable price` : ''}
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
          <Pressable style={styles.sheet} onPress={() => {}}>
            {/* Fixed header (title + Item code) — kept OUTSIDE the ScrollView
                so it stays visible even if the sheet's inner content scrolls. */}
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{editing ? 'Edit service' : 'Add service'}</Text>
            <KeyboardAwareScrollView
              bottomOffset={24}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
            >

              {/* Item Code — optional, numeric zero-padded string. Blank = auto-assign. */}
              <View style={styles.field}>
                <Text style={styles.label}>Item code</Text>
                <TextInput
                  testID="svc-item-code-input"
                  value={itemCode}
                  onChangeText={(v) => { setItemCode(sanitizeItemCode(v)); if (itemCodeErr) setItemCodeErr(null); }}
                  onBlur={() => setItemCode(prev => padItemCode(prev))}
                  keyboardType="number-pad"
                  maxLength={9}
                  placeholder="e.g. 001"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={[styles.input, itemCodeErr && { borderColor: colors.error, backgroundColor: '#FDECEC', borderWidth: 1 }]}
                />
                <Text style={styles.helpText}>Numbers only. Auto-filled with the next available code — change it if you like.</Text>
                {itemCodeErr && (
                  <Text style={{ color: colors.error, fontSize: 12, marginTop: 4, fontWeight: '600' }} testID="svc-item-code-err">
                    {itemCodeErr}
                  </Text>
                )}
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
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
                    <Text style={styles.label}>Base price ({getCurrencySymbol()})</Text>
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
                    <Text style={styles.label}>Suggested add-on ({getCurrencySymbol()})</Text>
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
            
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <FilterSheet
        visible={fsOpen}
        onClose={() => setFsOpen(false)}
        onClear={resetFilters}
        title="Filter services"
        testID="svc-filter-sheet"
      >
        <FilterSection label="Category">
          <FilterChip label="Any" selected={!filters.category} onPress={() => setFilters({ category: null })} testID="svc-fs-cat-any" />
          {availableCategories.map(c => (
            <FilterChip
              key={c}
              label={c}
              selected={filters.category === c}
              onPress={() => setFilters({ category: c })}
              testID={`svc-fs-cat-${c}`}
            />
          ))}
        </FilterSection>
        <FilterSection label="Status">
          <FilterChip label="Any" selected={!filters.status} onPress={() => setFilters({ status: null })} testID="svc-fs-stat-any" />
          <FilterChip label="Active" selected={filters.status === 'active'} onPress={() => setFilters({ status: 'active' })} testID="svc-fs-stat-active" />
          <FilterChip label="Inactive" selected={filters.status === 'inactive'} onPress={() => setFilters({ status: 'inactive' })} testID="svc-fs-stat-inactive" />
        </FilterSection>
        <FilterSection label="Price type">
          <FilterChip label="Any" selected={!filters.priceType} onPress={() => setFilters({ priceType: null })} testID="svc-fs-pt-any" />
          <FilterChip label="Fixed" selected={filters.priceType === 'fixed'} onPress={() => setFilters({ priceType: 'fixed' })} testID="svc-fs-pt-fixed" />
          <FilterChip label="Variable" selected={filters.priceType === 'variable'} onPress={() => setFilters({ priceType: 'variable' })} testID="svc-fs-pt-variable" />
        </FilterSection>
      </FilterSheet>

      <ExportMenu
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export Services"
        subtitle={`${rangeLabel()} · ${filtered.length} record${filtered.length === 1 ? '' : 's'}`}
        onPick={doExport}
      />
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
    height: 42, marginHorizontal: spacing.lg, marginTop: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },

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

  codeBadge: {
    minWidth: 44, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.sm, backgroundColor: colors.brandTertiary,
    borderWidth: 1, borderColor: colors.brandSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  codeBadgeText: {
    fontSize: 12, fontWeight: '800', color: colors.brandPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 0.5,
  } as any,
});
