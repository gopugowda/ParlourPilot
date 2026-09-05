/**
 * Customer Report — mobile mirror of the web app's per-customer service
 * activity view. Consumes existing /api/bills — DOES NOT introduce any
 * new backend model.
 *
 * Each row corresponds to one bill and shows Date · Customer · Phone ·
 * Services · (Staff · Branch when backend exposes them). Filters:
 * date range (presets), customer/phone search, service, staff, branch.
 * Exports as CSV / PDF / native share sheet — same filtered rows.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import { useFilterState } from '@/src/hooks/useFilterState';
import { FilterSheet, FilterHeaderButton, FilterSection, FilterChip } from '@/src/components/FilterSheet';
import {
  DatePresetChips, rangeFromPreset, ExportMenu, ReportEmptyState, ReportSummaryCard,
  type DatePreset, type ExportAction,
} from '@/src/components/ReportKit';
import { rowsToCsv, shareCsv, sharePdf, printOrShareHtml, buildReportHtml } from '@/src/utils/exportShare';

type BillItem = {
  service_name?: string; name?: string;
  beautician_id?: string; beautician_name?: string;
  price?: number; quantity?: number;
};
type Bill = {
  id: string;
  bill_no: string;
  customer_name?: string;
  customer_phone?: string;
  grand_total: number;
  items: BillItem[];
  created_at: string;
  billing_date?: string;
  branch_id?: string;
  branch_name?: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const startOfMonthISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const billDate = (b: Bill) => (b.billing_date || (b.created_at || '').slice(0, 10));

const fmtDate = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function CustomerReportScreen() {
  const router = useRouter();
  const { tenant, branches } = useAuth();
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [fsOpen, setFsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const { filters, setFilters, resetFilters, activeCount } = useFilterState('customer-report', {
    phone: '' as string,
    service: '' as string,
    staffId: null as string | null,
    branchId: null as string | null,
  });

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    if (p !== 'custom') {
      const r = rangeFromPreset(p);
      if (r) { setFrom(r.from); setTo(r.to); }
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      const data = await api<Bill[]>(`/bills?${params.toString()}`).catch(() => [] as Bill[]);
      setBills(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const serviceOptions = useMemo(() => {
    const s = new Set<string>();
    bills.forEach(b => (b.items || []).forEach(it => {
      const nm = it.service_name || it.name;
      if (nm) s.add(nm);
    }));
    return Array.from(s).sort();
  }, [bills]);

  const staffOptions = useMemo(() => {
    const m = new Map<string, string>();
    bills.forEach(b => (b.items || []).forEach(it => {
      if (it.beautician_id) m.set(it.beautician_id, it.beautician_name || it.beautician_id);
    }));
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [bills]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return bills.filter(b => {
      // Customer search (name)
      if (q) {
        const hit =
          (b.customer_name || '').toLowerCase().includes(q) ||
          (b.customer_phone || '').includes(q) ||
          (b.bill_no || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (filters.phone && !(b.customer_phone || '').includes(filters.phone)) return false;
      if (filters.branchId && b.branch_id && b.branch_id !== filters.branchId) return false;
      if (filters.service || filters.staffId) {
        const items = b.items || [];
        if (filters.service) {
          const has = items.some(it => (it.service_name || it.name || '') === filters.service);
          if (!has) return false;
        }
        if (filters.staffId) {
          const has = items.some(it => it.beautician_id === filters.staffId);
          if (!has) return false;
        }
      }
      return true;
    });
  }, [bills, search, filters]);

  // ---- Aggregations ---------------------------------------------------
  const uniqueCustomers = useMemo(() => {
    const s = new Set<string>();
    filtered.forEach(b => s.add(`${b.customer_name || ''}|${b.customer_phone || ''}`));
    return s.size;
  }, [filtered]);
  const totalRevenue = filtered.reduce((s, b) => s + (b.grand_total || 0), 0);

  // ---- Export ---------------------------------------------------------
  const exportHeaders = ['Date', 'Bill #', 'Customer', 'Phone', 'Services', 'Staff', 'Branch', 'Total'];
  const buildRows = () => filtered.map(b => {
    const svcs = (b.items || []).map(it => it.service_name || it.name || '').filter(Boolean).join(', ');
    const staff = Array.from(new Set((b.items || []).map(it => it.beautician_name).filter(Boolean))).join(', ');
    return [
      fmtDate(billDate(b)),
      b.bill_no || '',
      b.customer_name || 'Walk-in',
      b.customer_phone || '',
      svcs,
      staff,
      b.branch_name || '',
      fmtINR(b.grand_total || 0),
    ];
  });
  const rangeLabel = () => {
    const parts: string[] = [`${from} → ${to}`];
    if (search) parts.push(`"${search}"`);
    if (filters.phone) parts.push(`Ph ${filters.phone}`);
    if (filters.service) parts.push(filters.service);
    if (filters.staffId) parts.push(staffOptions.find(s => s.id === filters.staffId)?.name || 'Staff');
    if (filters.branchId) parts.push((branches as any).find((b: any) => b.id === filters.branchId)?.name || 'Branch');
    return parts.join(' · ');
  };
  const doExport = async (a: ExportAction) => {
    const rows = buildRows();
    if (rows.length === 0) return;
    const dateSuffix = `${from}_${to}`;
    if (a === 'csv') {
      await shareCsv(rowsToCsv(exportHeaders, rows), `customer_report_${dateSuffix}.csv`);
      return;
    }
    const html = buildReportHtml({
      title: 'Customer Report',
      subtitle: rangeLabel(),
      brand: { name: tenant?.business_name, color: colors.brandPrimary, logo: (tenant as any)?.logo || null },
      summary: [
        { label: 'Bills', value: String(filtered.length) },
        { label: 'Unique Customers', value: String(uniqueCustomers) },
        { label: 'Revenue', value: fmtINR(totalRevenue) },
      ],
      columns: exportHeaders,
      rows,
      totalRow: ['', '', '', '', '', '', 'Total', fmtINR(totalRevenue)],
    });
    if (a === 'pdf') { await sharePdf(html, `customer_report_${dateSuffix}.pdf`); return; }
    await printOrShareHtml(html, `customer_report_${dateSuffix}.pdf`);
  };

  const filterCount = activeCount + (search ? 1 : 0);

  return (
    <View style={styles.root} testID="customer-report">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.iconBtn}>
          <Ionicons name="home-outline" size={20} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Customer Report</Text>
          <Text style={styles.headerSub}>Service activity per customer</Text>
        </View>
        <FilterHeaderButton count={filterCount} onPress={() => setFsOpen(true)} testID="cust-filter-btn" />
        <TouchableOpacity
          testID="cust-menu-btn"
          onPress={() => setExportOpen(true)}
          style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.brandPrimary} />
        </TouchableOpacity>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        <DatePresetChips value={preset} onChange={applyPreset} testID="cust-preset" />

        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>From</Text>
            <TextInput testID="cust-from" value={from} onChangeText={(v) => { setFrom(v); setPreset('custom'); }} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>To</Text>
            <TextInput testID="cust-to" value={to} onChangeText={(v) => { setTo(v); setPreset('custom'); }} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="cust-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer, phone or bill #"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.searchInput}
          />
        </View>

        <ReportSummaryCard items={[
          { label: 'Bills', value: String(filtered.length), tone: 'accent' },
          { label: 'Customers', value: String(uniqueCustomers) },
          { label: 'Revenue', value: fmtINR(totalRevenue), tone: 'success' },
        ]} />

        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
        ) : filtered.length === 0 ? (
          <ReportEmptyState
            icon="people-outline"
            message="No customer service records found for the selected filters."
            onReset={() => {
              setSearch('');
              resetFilters();
              applyPreset('this_month');
            }}
          />
        ) : (
          filtered.map(b => {
            const svcs = (b.items || []).map(it => it.service_name || it.name || '').filter(Boolean);
            const staff = Array.from(new Set((b.items || []).map(it => it.beautician_name).filter(Boolean)));
            return (
              <View key={b.id} style={styles.row} testID={`cust-row-${b.id}`}>
                <View style={styles.rowHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{b.customer_name || 'Walk-in'}</Text>
                    <Text style={styles.rowMeta}>{b.customer_phone || 'No phone'} · Bill #{b.bill_no}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.rowAmount}>{fmtINR(b.grand_total || 0)}</Text>
                    <Text style={styles.rowMeta}>{fmtDate(billDate(b))}</Text>
                  </View>
                </View>
                {svcs.length > 0 && (
                  <View style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                    {svcs.slice(0, 6).map((s, i) => (
                      <View key={i} style={styles.svcTag}><Text style={styles.svcTagText} numberOfLines={1}>{s}</Text></View>
                    ))}
                    {svcs.length > 6 && (
                      <View style={styles.svcTag}><Text style={styles.svcTagText}>+{svcs.length - 6}</Text></View>
                    )}
                  </View>
                )}
                {(staff.length > 0 || b.branch_name) && (
                  <Text style={[styles.rowMeta, { marginTop: 6 }]}>
                    {staff.length > 0 ? `Staff: ${staff.join(', ')}` : ''}
                    {staff.length > 0 && b.branch_name ? '  ·  ' : ''}
                    {b.branch_name ? `Branch: ${b.branch_name}` : ''}
                  </Text>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <FilterSheet
        visible={fsOpen}
        onClose={() => setFsOpen(false)}
        onClear={resetFilters}
        title="Filter customers"
        testID="cust-filter-sheet"
      >
        <FilterSection label="Phone contains">
          <TextInput
            value={filters.phone}
            onChangeText={(v) => setFilters({ phone: v.replace(/[^0-9]/g, '') })}
            placeholder="10-digit number"
            placeholderTextColor={colors.onSurfaceTertiary}
            keyboardType="number-pad"
            style={[styles.input, { flex: 1 }]}
          />
        </FilterSection>
        {serviceOptions.length > 0 && (
          <FilterSection label="Service">
            <FilterChip label="Any" selected={!filters.service} onPress={() => setFilters({ service: '' })} testID="cust-fs-svc-any" />
            {serviceOptions.slice(0, 20).map(s => (
              <FilterChip key={s} label={s} selected={filters.service === s} onPress={() => setFilters({ service: s })} testID={`cust-fs-svc-${s}`} />
            ))}
          </FilterSection>
        )}
        {staffOptions.length > 0 && (
          <FilterSection label="Staff">
            <FilterChip label="Any" selected={!filters.staffId} onPress={() => setFilters({ staffId: null })} testID="cust-fs-staff-any" />
            {staffOptions.map(s => (
              <FilterChip key={s.id} label={s.name} selected={filters.staffId === s.id} onPress={() => setFilters({ staffId: s.id })} testID={`cust-fs-staff-${s.id}`} />
            ))}
          </FilterSection>
        )}
        {(branches as any)?.length > 0 && (
          <FilterSection label="Branch">
            <FilterChip label="Any" selected={!filters.branchId} onPress={() => setFilters({ branchId: null })} testID="cust-fs-br-any" />
            {(branches as any).map((b: any) => (
              <FilterChip key={b.id} label={b.name} selected={filters.branchId === b.id} onPress={() => setFilters({ branchId: b.id })} testID={`cust-fs-br-${b.id}`} />
            ))}
          </FilterSection>
        )}
      </FilterSheet>

      <ExportMenu
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export Customer Report"
        subtitle={`${filtered.length} bill${filtered.length === 1 ? '' : 's'} · ${uniqueCustomers} customer${uniqueCustomers === 1 ? '' : 's'}`}
        onPick={doExport}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  label: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '700', textTransform: 'uppercase' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm, fontSize: 13, color: colors.onSurface },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md,
    borderRadius: radius.sm, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },
  row: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    ...shadows.card,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center' },
  rowName: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  rowMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: '800', color: colors.brandPrimary },
  svcTag: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.brandSecondary },
  svcTagText: { fontSize: 10, color: colors.brandPrimary, fontWeight: '700' },
});
