/**
 * Payroll & Salary Hub — mirrors the web app's payroll module.
 *
 * Sections (horizontal segmented tabs):
 *   1. Team          — list all employees with current basic salary
 *   2. Structure     — recurring salary components (allowance/deduction)
 *   3. Variable      — month-specific incentives / bonuses / earnings
 *   4. Runs          — payroll runs: create, calculate, approve, finalize
 *   5. Settings      — monthly hours & overtime rules
 *
 * Backend is the sole authority for all calculations. This screen only
 * reads results and dispatches workflow actions.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput, Modal, Pressable, Alert, Switch, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Calendar as RNCalendar } from 'react-native-calendars';
import * as Haptics from 'expo-haptics';

import { api } from '@/src/api/client';
import {
  payrollApi, type SalaryComponent, type VariableEarning, type PayrollRun,
  type PayrollSettings, VARIABLE_EARNING_TYPES, RUN_STATUS_COLOR,
} from '@/src/api/payroll';
import { useAuth, useBrand } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, contrastText, fmtMoney } from '@/src/theme';

type Beautician = { id: string; name: string; branch_id?: string; role?: string; employee_id?: string; basic_salary?: number; commission_pct?: number; monthly_target?: number };

type Tab = 'team' | 'structure' | 'variable' | 'runs' | 'settings';
const TABS: { key: Tab; label: string; icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap }[] = [
  { key: 'team',      label: 'Team & Salary',    icon: 'people-outline' },
  { key: 'structure', label: 'Salary Structure', icon: 'construct-outline' },
  { key: 'variable',  label: 'Variable Earnings', icon: 'sparkles-outline' },
  { key: 'runs',      label: 'Payroll Runs',     icon: 'play-circle-outline' },
  { key: 'settings',  label: 'Settings',         icon: 'settings-outline' },
];

const ym = (d = new Date()) => d.toISOString().slice(0, 7);
const ymd = (d = new Date()) => d.toISOString().slice(0, 10);

export default function PayrollScreen() {
  const router = useRouter();
  const { user, can } = useAuth();
  const { brandColor } = useBrand();
  const brand = brandColor || colors.brandPrimary;
  const onBrand = contrastText(brand);

  const isOwner = !!user?.is_owner;
  // Payroll is Owner-only on web (mirrors web permissions)
  const [tab, setTab] = useState<Tab>('team');
  const [beauticians, setBeauticians] = useState<Beautician[]>([]);
  const [loadingBeauticians, setLoadingBeauticians] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await api<Beautician[]>('/beauticians');
        setBeauticians((list || []).filter((b: any) => b.active !== false));
      } finally {
        setLoadingBeauticians(false);
      }
    })();
  }, []);

  if (!isOwner) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={[styles.header, { backgroundColor: brand }]}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="chevron-back" size={22} color={onBrand} /></TouchableOpacity>
            <Text style={[styles.headerTitle, { color: onBrand }]}>Payroll & Salary</Text>
          </View>
        </SafeAreaView>
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.onSurfaceTertiary} />
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.onSurface, marginTop: 12 }}>Owner-only</Text>
          <Text style={{ fontSize: 13, color: colors.onSurfaceTertiary, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 }}>
            Payroll & Salary is restricted to the business owner.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="payroll-screen">
      <SafeAreaView edges={['top']} style={[styles.header, { backgroundColor: brand }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={onBrand} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: onBrand }]}>Payroll & Salary</Text>
            <Text style={[styles.headerSub, { color: onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.65)' }]}>Structure, runs, payslips & exports</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 8, paddingBottom: 4 }}>
          {TABS.map(t => {
            const active = t.key === tab;
            return (
              <TouchableOpacity
                key={t.key}
                testID={`payroll-tab-${t.key}`}
                onPress={() => { setTab(t.key); if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); }}
                style={[styles.tabPill, { backgroundColor: active ? '#FFFFFF' : 'transparent', borderColor: active ? '#FFFFFF' : (onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.15)') }]}
              >
                <Ionicons name={t.icon} size={14} color={active ? brand : onBrand} />
                <Text style={[styles.tabLabel, { color: active ? brand : onBrand }]} numberOfLines={1}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      {loadingBeauticians ? (
        <View style={styles.center}><ActivityIndicator color={brand} /></View>
      ) : (
        <>
          {tab === 'team'      && <TeamTab beauticians={beauticians} brand={brand} />}
          {tab === 'structure' && <StructureTab brand={brand} />}
          {tab === 'variable'  && <VariableTab beauticians={beauticians} brand={brand} />}
          {tab === 'runs'      && <RunsTab beauticians={beauticians} brand={brand} />}
          {tab === 'settings'  && <SettingsTab brand={brand} />}
        </>
      )}
    </View>
  );
}

// =====================================================================
// TAB — Team & Salary
// =====================================================================
function TeamTab({ beauticians, brand }: { beauticians: Beautician[]; brand: string }) {
  const [empId, setEmpId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [loadingDet, setLoadingDet] = useState(false);
  const [addChangeOpen, setAddChangeOpen] = useState(false);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDet(true);
    try {
      const [hist, chg] = await Promise.all([
        payrollApi.salaryHistory(id),
        payrollApi.salaryChanges(id).catch(() => ({ changes: [] as any[] })),
      ]);
      setDetail({ history: hist, changes: chg.changes || [] });
    } catch (e: any) { Alert.alert('Load failed', e.message); }
    finally { setLoadingDet(false); }
  }, []);

  useEffect(() => { if (empId) loadDetail(empId); }, [empId, loadDetail]);

  if (!empId) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
        <Text style={styles.sectionTitle}>All Employees</Text>
        {beauticians.length === 0 ? (
          <Empty icon="people-outline" title="No team members" hint="Add employees via Team Management." />
        ) : beauticians.map(b => (
          <TouchableOpacity key={b.id} onPress={() => setEmpId(b.id)} style={styles.card} testID={`team-${b.id}`}>
            <View style={styles.rowHead}>
              <View style={[styles.avatar, { backgroundColor: brand + '22' }]}><Text style={[styles.avatarText, { color: brand }]}>{b.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{b.name}</Text>
                <Text style={styles.rowSub}>{b.role || 'Staff'}{b.employee_id ? ` • ${b.employee_id}` : ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.rowSub}>Basic</Text>
                <Text style={[styles.money, { color: brand }]}>{fmtMoney(b.basic_salary || 0)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  const emp = beauticians.find(b => b.id === empId);

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }} refreshControl={<RefreshControl refreshing={loadingDet} onRefresh={() => empId && loadDetail(empId)} tintColor={brand} />}>
      <TouchableOpacity onPress={() => setEmpId(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
        <Ionicons name="chevron-back" size={16} color={brand} />
        <Text style={{ color: brand, fontWeight: '700' }}>Back to team</Text>
      </TouchableOpacity>
      <Text style={styles.pageTitle}>{emp?.name}</Text>
      <Text style={styles.rowSub}>{emp?.role || 'Staff'}{emp?.employee_id ? ` • ${emp.employee_id}` : ''}</Text>

      <View style={[styles.card, { marginTop: spacing.md }]}>
        <Text style={styles.sectionTitle}>Current Basic Salary</Text>
        <Text style={[styles.money, { fontSize: 28, color: brand }]}>{fmtMoney(detail?.history?.current?.basic_salary || emp?.basic_salary || 0)}</Text>
        <Text style={styles.rowSub}>Since {detail?.history?.current?.effective_from || '—'} • source: {detail?.history?.current?.source || 'team_management'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.md, flexWrap: 'wrap' }}>
          <MetricBlock label="Commission %" value={`${emp?.commission_pct || 0}%`} />
          <MetricBlock label="Monthly Target" value={fmtMoney(emp?.monthly_target || 0)} />
        </View>
        <TouchableOpacity onPress={() => setAddChangeOpen(true)} style={[styles.secondaryBtn, { marginTop: spacing.md }]}>
          <Ionicons name="add" size={14} color={brand} />
          <Text style={[styles.secondaryBtnText, { color: brand }]}>Add Salary Change</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Salary History</Text>
      {(detail?.history?.versions || []).length === 0 ? (
        <Empty icon="time-outline" title="No history" hint="No salary versions yet." />
      ) : (detail.history.versions as any[]).map(v => (
        <View key={v.id} style={styles.card}>
          <View style={styles.rowHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Since {v.effective_from}</Text>
              <Text style={styles.rowSub}>{v.note || 'No note'}</Text>
            </View>
            <Text style={[styles.money, { color: brand }]}>{fmtMoney(v.basic_salary)}</Text>
          </View>
        </View>
      ))}

      <SalaryChangeModal
        visible={addChangeOpen}
        onClose={() => setAddChangeOpen(false)}
        onSaved={() => { setAddChangeOpen(false); if (empId) loadDetail(empId); }}
        beauticianId={empId}
        currentBasic={detail?.history?.current?.basic_salary || 0}
        brand={brand}
      />
    </ScrollView>
  );
}

// =====================================================================
// TAB — Salary Structure (Components)
// =====================================================================
function StructureTab({ brand }: { brand: string }) {
  const [rows, setRows] = useState<SalaryComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<SalaryComponent | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await payrollApi.listComponents()); }
    catch (e: any) { Alert.alert('Load failed', e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (r: SalaryComponent) => {
    try {
      if (r.active) await payrollApi.deactivateComponent(r.id);
      else await payrollApi.activateComponent(r.id);
      load();
    } catch (e: any) { Alert.alert('Failed', e.message); }
  };

  const del = (r: SalaryComponent) => {
    Alert.alert('Delete component', `Remove "${r.name}"?`, [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await payrollApi.deleteComponent(r.id); load(); } catch (e: any) { Alert.alert('Failed', e.message); }
      }},
    ]);
  };

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <TouchableOpacity onPress={() => { setEditing(null); setOpen(true); }} style={[styles.primaryBtn, { backgroundColor: brand }]}>
        <Ionicons name="add" size={16} color="#fff" />
        <Text style={styles.primaryBtnText}>New Component</Text>
      </TouchableOpacity>

      <Text style={styles.helpText}>Recurring salary components apply to every finalized payroll unless deactivated. Amount can be a fixed value or a percentage of Basic.</Text>

      {rows.length === 0 ? (
        <Empty icon="construct-outline" title="No components" hint="Add allowances (HRA, Conveyance) or deductions." />
      ) : rows.map(r => (
        <View key={r.id} style={styles.card}>
          <View style={styles.rowHead}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.rowTitle}>{r.name}</Text>
                <View style={[styles.badge, { backgroundColor: r.component_type === 'allowance' ? '#DDF3E4' : '#FDECEC' }]}>
                  <Text style={[styles.badgeText, { color: r.component_type === 'allowance' ? colors.success : colors.error }]}>{r.component_type === 'allowance' ? 'Allowance' : 'Deduction'}</Text>
                </View>
                {!r.active && <View style={styles.badge}><Text style={[styles.badgeText, { color: colors.onSurfaceTertiary }]}>Inactive</Text></View>}
              </View>
              <Text style={styles.rowSub}>{r.code} • {r.calc_method === 'fixed' ? fmtMoney(r.amount) : `${r.percentage}% of ${r.base_code || 'BASIC'}`}</Text>
            </View>
            <TouchableOpacity onPress={() => toggle(r)} style={{ padding: 6 }}>
              <Ionicons name={r.active ? 'toggle' : 'toggle-outline'} size={26} color={r.active ? brand : colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setEditing(r); setOpen(true); }} style={{ padding: 6 }}>
              <Ionicons name="pencil-outline" size={18} color={brand} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => del(r)} style={{ padding: 6 }}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <ComponentModal visible={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} editing={editing} brand={brand} />
    </ScrollView>
  );
}

// =====================================================================
// TAB — Variable Earnings
// =====================================================================
function VariableTab({ beauticians, brand }: { beauticians: Beautician[]; brand: string }) {
  const [month, setMonth] = useState(ym());
  const [rows, setRows] = useState<VariableEarning[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<VariableEarning | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await payrollApi.listVariableEarnings({ month, status: 'active' })); }
    catch (e: any) { Alert.alert('Load failed', e.message); }
    finally { setLoading(false); }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const del = (r: VariableEarning) => {
    Alert.alert('Delete earning?', `Cancel this ${r.earning_label || r.earning_type}?`, [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await payrollApi.deleteVariableEarning(r.id); load(); } catch (e: any) { Alert.alert('Failed', e.message); }
      }},
    ]);
  };

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <MonthPicker value={month} onChange={setMonth} brand={brand} />
      <TouchableOpacity onPress={() => { setEditing(null); setOpen(true); }} style={[styles.primaryBtn, { backgroundColor: brand }]}>
        <Ionicons name="add" size={16} color="#fff" />
        <Text style={styles.primaryBtnText}>Add Variable Earning</Text>
      </TouchableOpacity>

      <Text style={styles.helpText}>Variable earnings are month-specific (bonuses, incentives). They apply only to the selected month{"'"}s payroll.</Text>

      {rows.length === 0 ? (
        <Empty icon="sparkles-outline" title="No variable earnings" hint={`No entries for ${month}.`} />
      ) : rows.map(r => {
        const emp = beauticians.find(b => b.id === r.beautician_id);
        return (
          <View key={r.id} style={styles.card}>
            <View style={styles.rowHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{emp?.name || 'Employee'} — {r.earning_label || r.earning_type}</Text>
                {r.note ? <Text style={styles.rowSub}>“{r.note}”</Text> : null}
              </View>
              <Text style={[styles.money, { color: brand }]}>{fmtMoney(r.amount)}</Text>
              <TouchableOpacity onPress={() => { setEditing(r); setOpen(true); }} style={{ padding: 6 }}>
                <Ionicons name="pencil-outline" size={18} color={brand} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => del(r)} style={{ padding: 6 }}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <VariableEarningModal
        visible={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); load(); }}
        editing={editing}
        beauticians={beauticians}
        defaultMonth={month}
        brand={brand}
      />
    </ScrollView>
  );
}

// =====================================================================
// TAB — Payroll Runs
// =====================================================================
function RunsTab({ beauticians, brand }: { beauticians: Beautician[]; brand: string }) {
  const [month, setMonth] = useState(ym());
  const [rows, setRows] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<PayrollRun | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await payrollApi.listRuns({ month })); }
    catch (e: any) { Alert.alert('Load failed', e.message); }
    finally { setLoading(false); }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const createNew = async () => {
    try {
      const run = await payrollApi.createRun({ month });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      load();
      setDetail(run);
    } catch (e: any) { Alert.alert('Failed', e.message); }
  };

  if (detail) {
    return <RunDetail run={detail} onBack={() => { setDetail(null); load(); }} beauticians={beauticians} brand={brand} />;
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <MonthPicker value={month} onChange={setMonth} brand={brand} />
      <TouchableOpacity onPress={createNew} style={[styles.primaryBtn, { backgroundColor: brand }]}>
        <Ionicons name="play-circle" size={16} color="#fff" />
        <Text style={styles.primaryBtnText}>New Payroll Run for {month}</Text>
      </TouchableOpacity>

      <Text style={styles.helpText}>Create a run → Calculate → Approve → Finalize. Finalized runs generate payslips and unlock CSV/PDF export.</Text>

      {rows.length === 0 ? (
        <Empty icon="play-circle-outline" title="No runs yet" hint={`No payroll runs for ${month}.`} />
      ) : rows.map(r => {
        const meta = RUN_STATUS_COLOR[r.status] || RUN_STATUS_COLOR.draft;
        return (
          <TouchableOpacity key={r.id} onPress={() => setDetail(r)} style={styles.card} testID={`run-${r.id}`}>
            <View style={styles.rowHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.month} • {r.totals.count} employee{r.totals.count === 1 ? '' : 's'}</Text>
                <Text style={styles.rowSub}>Gross {fmtMoney(r.totals.gross)} • Net {fmtMoney(r.totals.net)}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// =====================================================================
// Run Detail sub-screen
// =====================================================================
function RunDetail({ run: initialRun, onBack, beauticians, brand }:
  { run: PayrollRun; onBack: () => void; beauticians: Beautician[]; brand: string }) {
  const [run, setRun] = useState<PayrollRun>(initialRun);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await payrollApi.runDetail(run.id);
      setRun(res.run);
      setItems(res.items || []);
    } catch (e: any) { Alert.alert('Load failed', e.message); }
    finally { setLoading(false); }
  }, [run.id]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action: 'calculate' | 'approve' | 'finalize' | 'cancel' | 'correct') => {
    setBusy(action);
    try {
      let res: any;
      if (action === 'calculate') res = await payrollApi.calculateRun(run.id);
      else if (action === 'approve') res = await payrollApi.approveRun(run.id);
      else if (action === 'finalize') res = await payrollApi.finalizeRun(run.id);
      else if (action === 'cancel') res = await payrollApi.cancelRun(run.id);
      else if (action === 'correct') res = await payrollApi.correctRun(run.id);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (action === 'correct' && res?.id) {
        // switch to the new corrected run
        setRun(res); setItems([]); load();
      } else {
        await load();
      }
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
    finally { setBusy(null); }
  };

  const exportCsv = async () => {
    setBusy('export');
    try {
      const csv = await payrollApi.exportRunCsv(run.id);
      const { shareCsv } = await import('@/src/utils/exportShare');
      await shareCsv(csv, `payroll-${run.month}.csv`);
    } catch (e: any) { Alert.alert('Export failed', e.message); }
    finally { setBusy(null); }
  };

  const exportPdf = async () => {
    setBusy('pdf');
    try {
      const { sharePdf, buildReportHtml } = await import('@/src/utils/exportShare');
      const rows = items.map((it: any) => [
        it.beautician_name, it.employee_id || '—', it.designation || '',
        fmtMoney(it.earnings.find((e: any) => e.type === 'basic')?.amount || 0),
        fmtMoney(it.earnings.find((e: any) => e.type === 'commission')?.amount || 0),
        fmtMoney(it.earnings.filter((e: any) => e.type === 'variable_earning').reduce((s: number, e: any) => s + (e.amount || 0), 0)),
        fmtMoney(it.gross),
        fmtMoney(it.total_deductions),
        fmtMoney(it.net),
      ]);
      const html = buildReportHtml({
        title: `Payroll — ${run.month}`,
        subtitle: `Status: ${run.status}`,
        columns: ['Employee', 'Emp ID', 'Designation', 'Basic', 'Commission', 'Variable', 'Gross', 'Deductions', 'Net'],
        rows,
        totalRow: ['TOTAL', `${run.totals.count} employees`, '', '', '', '', fmtMoney(run.totals.gross), fmtMoney(run.totals.deductions), fmtMoney(run.totals.net)],
        brand: { name: 'ParlourPilot Payroll', color: brand },
      });
      await sharePdf(html, `payroll-${run.month}.pdf`);
    } catch (e: any) { Alert.alert('PDF failed', e.message); }
    finally { setBusy(null); }
  };

  const meta = RUN_STATUS_COLOR[run.status] || RUN_STATUS_COLOR.draft;

  if (viewingItem) {
    return <PayslipView itemId={viewingItem} onBack={() => setViewingItem(null)} brand={brand} />;
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
        <Ionicons name="chevron-back" size={16} color={brand} />
        <Text style={{ color: brand, fontWeight: '700' }}>Back to runs</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.pageTitle}>{run.month}</Text>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.md, flexWrap: 'wrap' }}>
          <MetricBlock label="Employees" value={String(run.totals.count)} />
          <MetricBlock label="Gross" value={fmtMoney(run.totals.gross)} />
          <MetricBlock label="Deductions" value={fmtMoney(run.totals.deductions)} />
          <MetricBlock label="Net" value={fmtMoney(run.totals.net)} highlight={brand} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.md }}>
          {run.status === 'draft' && (
            <TouchableOpacity onPress={() => doAction('calculate')} disabled={!!busy} style={[styles.actionBtn, { backgroundColor: brand, borderColor: brand }]}>
              {busy === 'calculate' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.actionBtnText, { color: '#fff' }]}>Calculate</Text>}
            </TouchableOpacity>
          )}
          {run.status === 'calculated' && (
            <>
              <TouchableOpacity onPress={() => doAction('approve')} disabled={!!busy} style={[styles.actionBtn, { backgroundColor: colors.info, borderColor: colors.info }]}>
                <Text style={[styles.actionBtnText, { color: '#fff' }]}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => doAction('calculate')} disabled={!!busy} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>Recalculate</Text>
              </TouchableOpacity>
            </>
          )}
          {run.status === 'approved' && (
            <TouchableOpacity onPress={() => doAction('finalize')} disabled={!!busy} style={[styles.actionBtn, { backgroundColor: colors.success, borderColor: colors.success }]}>
              {busy === 'finalize' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.actionBtnText, { color: '#fff' }]}>Finalize</Text>}
            </TouchableOpacity>
          )}
          {run.status === 'finalized' && (
            <>
              <TouchableOpacity onPress={exportCsv} disabled={!!busy} style={[styles.actionBtn, { backgroundColor: '#fff', borderColor: brand }]}>
                <Ionicons name="download-outline" size={14} color={brand} />
                <Text style={[styles.actionBtnText, { color: brand }]}>Export CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={exportPdf} disabled={!!busy} style={[styles.actionBtn, { backgroundColor: '#fff', borderColor: brand }]}>
                <Ionicons name="document-outline" size={14} color={brand} />
                <Text style={[styles.actionBtnText, { color: brand }]}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => doAction('correct')} disabled={!!busy} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>Corrections Run</Text>
              </TouchableOpacity>
            </>
          )}
          {['draft', 'calculated', 'approved'].includes(run.status) && (
            <TouchableOpacity onPress={() => doAction('cancel')} disabled={!!busy} style={[styles.actionBtn, { backgroundColor: '#fff' }]}>
              <Text style={[styles.actionBtnText, { color: colors.error }]}>Cancel Run</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Payroll Items ({items.length})</Text>
      {items.length === 0 ? (
        <Empty icon="cash-outline" title="No items" hint={run.status === 'draft' ? 'Calculate the run to generate items.' : 'No payroll items in this run.'} />
      ) : items.map((it: any) => (
        <TouchableOpacity key={it.id} onPress={() => setViewingItem(it.id)} style={styles.card}>
          <View style={styles.rowHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{it.beautician_name}</Text>
              <Text style={styles.rowSub}>{it.designation || 'Staff'}{it.employee_id ? ` • ${it.employee_id}` : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.rowSub}>Net</Text>
              <Text style={[styles.money, { color: brand }]}>{fmtMoney(it.net)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// =====================================================================
// Payslip View
// =====================================================================
function PayslipView({ itemId, onBack, brand }: { itemId: string; onBack: () => void; brand: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { setData(await payrollApi.payslip(itemId)); }
      catch (e: any) { Alert.alert('Load failed', e.message); }
      finally { setLoading(false); }
    })();
  }, [itemId]);

  const sharePdf = async () => {
    setBusy(true);
    try {
      const { sharePdf: sp, buildReportHtml } = await import('@/src/utils/exportShare');
      const earningsRows = (data.earnings as any[]).filter(e => e.amount > 0).map(e => [e.name, fmtMoney(e.amount)]);
      const deductionsRows = (data.deductions as any[]).filter(d => d.amount > 0).map(d => [d.name, fmtMoney(d.amount)]);
      const html = buildReportHtml({
        title: `Payslip — ${data.month}`,
        subtitle: `${data.employee.name} • ${data.branch.name}`,
        columns: ['Description', 'Amount'],
        rows: [
          ['— Earnings —', ''],
          ...earningsRows,
          ['— Deductions —', ''],
          ...deductionsRows,
        ],
        totalRow: ['NET PAY', fmtMoney(data.net)],
        brand: { name: data.salon?.name || 'ParlourPilot', color: brand, logo: data.salon?.logo },
      });
      await sp(html, `payslip-${data.employee.name}-${data.month}.pdf`);
    } catch (e: any) { Alert.alert('Failed', e.message); }
    finally { setBusy(false); }
  };

  const emailPayslip = async () => {
    setBusy(true);
    try {
      await payrollApi.emailPayslip(itemId);
      Alert.alert('Sent', 'Payslip email queued to the employee.');
    } catch (e: any) { Alert.alert('Failed', e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={brand} /></View>;
  if (!data) return <View style={styles.center}><Text>No data</Text></View>;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
        <Ionicons name="chevron-back" size={16} color={brand} />
        <Text style={{ color: brand, fontWeight: '700' }}>Back</Text>
      </TouchableOpacity>

      <View style={[styles.card, { padding: spacing.lg }]}>
        <Text style={styles.pageTitle}>{data.salon?.name || 'Payslip'}</Text>
        <Text style={styles.rowSub}>{data.branch?.name} • {data.month}</Text>
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />
        <Text style={styles.rowTitle}>{data.employee?.name}</Text>
        <Text style={styles.rowSub}>{data.employee?.designation}{data.employee?.employee_id ? ` • ${data.employee.employee_id}` : ''}</Text>

        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Earnings</Text>
        {(data.earnings as any[]).filter(e => e.amount > 0).map((e, i) => (
          <View key={i} style={styles.slipLine}>
            <Text style={styles.slipLabel}>{e.name}</Text>
            <Text style={styles.slipValue}>{fmtMoney(e.amount)}</Text>
          </View>
        ))}
        <View style={styles.slipTotal}>
          <Text style={styles.slipTotalLabel}>Gross Earnings</Text>
          <Text style={[styles.slipTotalValue, { color: colors.success }]}>{fmtMoney(data.gross)}</Text>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Deductions</Text>
        {(data.deductions as any[]).filter(d => d.amount > 0).length === 0 ? (
          <Text style={styles.rowSub}>No deductions</Text>
        ) : (data.deductions as any[]).filter(d => d.amount > 0).map((d, i) => (
          <View key={i} style={styles.slipLine}>
            <Text style={styles.slipLabel}>{d.name}{d.reason ? ` (${d.reason})` : ''}</Text>
            <Text style={styles.slipValue}>-{fmtMoney(d.amount)}</Text>
          </View>
        ))}
        <View style={styles.slipTotal}>
          <Text style={styles.slipTotalLabel}>Total Deductions</Text>
          <Text style={[styles.slipTotalValue, { color: colors.error }]}>{fmtMoney(data.total_deductions)}</Text>
        </View>

        <View style={[styles.slipTotal, { backgroundColor: brand + '15', padding: spacing.md, borderRadius: radius.md, marginTop: spacing.md, borderTopWidth: 0 }]}>
          <Text style={[styles.slipTotalLabel, { fontSize: 16, color: brand }]}>Net Pay</Text>
          <Text style={[styles.slipTotalValue, { fontSize: 22, color: brand }]}>{fmtMoney(data.net)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.md }}>
        <TouchableOpacity onPress={sharePdf} disabled={busy} style={[styles.primaryBtn, { backgroundColor: brand, flex: 1 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="share-outline" size={16} color="#fff" /><Text style={styles.primaryBtnText}>Share PDF</Text></>}
        </TouchableOpacity>
        <TouchableOpacity onPress={emailPayslip} disabled={busy} style={[styles.primaryBtn, { backgroundColor: '#fff', borderWidth: 1, borderColor: brand, flex: 1 }]}>
          <Ionicons name="mail-outline" size={16} color={brand} />
          <Text style={[styles.primaryBtnText, { color: brand }]}>Email to me</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// =====================================================================
// TAB — Settings
// =====================================================================
function SettingsTab({ brand }: { brand: string }) {
  const [s, setS] = useState<PayrollSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => { try { setS(await payrollApi.getSettings()); } finally { setLoading(false); } })(); }, []);

  if (loading || !s) return <View style={styles.center}><ActivityIndicator color={brand} /></View>;

  const save = async () => {
    setBusy(true);
    try {
      const updated = await payrollApi.saveSettings(s);
      setS(updated);
      Alert.alert('Saved', 'Payroll settings updated.');
    } catch (e: any) { Alert.alert('Failed', e.message); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Working Hours</Text>
        <Text style={styles.formLabel}>Monthly Working Hours</Text>
        <TextInput value={String(s.monthly_hours)} onChangeText={(v) => setS({ ...s, monthly_hours: parseFloat(v) || 0 })} keyboardType="numeric" style={styles.formInput} />
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.sectionTitle}>Overtime Enabled</Text>
          <Switch value={s.ot_enabled} onValueChange={(v) => setS({ ...s, ot_enabled: v })} trackColor={{ true: brand + '55' }} thumbColor={s.ot_enabled ? brand : '#f4f3f4'} />
        </View>
        {s.ot_enabled && (
          <>
            <Text style={styles.formLabel}>OT Method</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['fixed_per_hour', 'basic_hourly'] as const).map(m => (
                <TouchableOpacity key={m} onPress={() => setS({ ...s, ot_method: m })} style={[styles.filterPill, s.ot_method === m && { backgroundColor: brand, borderColor: brand }]}>
                  <Text style={[styles.filterPillText, s.ot_method === m && { color: '#fff' }]}>{m === 'fixed_per_hour' ? 'Fixed / hour' : 'Basic × Multiplier'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {s.ot_method === 'fixed_per_hour' ? (
              <>
                <Text style={styles.formLabel}>Fixed Rate per Hour</Text>
                <TextInput value={String(s.ot_rate)} onChangeText={(v) => setS({ ...s, ot_rate: parseFloat(v) || 0 })} keyboardType="numeric" style={styles.formInput} />
              </>
            ) : (
              <>
                <Text style={styles.formLabel}>Multiplier</Text>
                <TextInput value={String(s.ot_multiplier)} onChangeText={(v) => setS({ ...s, ot_multiplier: parseFloat(v) || 0 })} keyboardType="numeric" style={styles.formInput} />
              </>
            )}
          </>
        )}
      </View>

      <TouchableOpacity onPress={save} disabled={busy} style={[styles.primaryBtn, { backgroundColor: brand }]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save Settings</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

// =====================================================================
// MODALS & HELPERS
// =====================================================================
function MonthPicker({ value, onChange, brand }: { value: string; onChange: (v: string) => void; brand: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.dateRow}>
        <Ionicons name="calendar-outline" size={18} color={brand} />
        <Text style={styles.dateText}>{new Date(value + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Select month</Text>
            <RNCalendar
              current={value + '-01'}
              onMonthChange={(m: any) => {
                const v = m.dateString.slice(0, 7);
                onChange(v);
                setOpen(false);
              }}
              hideExtraDays
              theme={{ arrowColor: brand, monthTextColor: brand, todayTextColor: brand }}
            />
            <TouchableOpacity onPress={() => setOpen(false)} style={styles.modalClose}><Text style={styles.modalCloseText}>Close</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ComponentModal({ visible, onClose, onSaved, editing, brand }:
  { visible: boolean; onClose: () => void; onSaved: () => void; editing: SalaryComponent | null; brand: string }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<'allowance' | 'deduction'>('allowance');
  const [method, setMethod] = useState<'fixed' | 'percent_of_basic'>('fixed');
  const [amount, setAmount] = useState('0');
  const [pct, setPct] = useState('0');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(editing?.name || '');
      setCode(editing?.code || '');
      setType(editing?.component_type || 'allowance');
      setMethod(editing?.calc_method === 'percent_of_basic' ? 'percent_of_basic' : 'fixed');
      setAmount(String(editing?.amount ?? 0));
      setPct(String(editing?.percentage ?? 0));
    }
  }, [visible, editing]);

  const submit = async () => {
    if (!name.trim() || !code.trim()) { Alert.alert('Missing', 'Enter name and code.'); return; }
    setBusy(true);
    try {
      const body: any = {
        name, code: code.toUpperCase(), component_type: type, calc_method: method,
        amount: parseFloat(amount) || 0, percentage: parseFloat(pct) || 0, base_code: 'BASIC', active: true,
      };
      if (editing) await payrollApi.updateComponent(editing.id, body);
      else await payrollApi.createComponent(body);
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={[styles.modalCard, { maxHeight: '90%' }]} onPress={e => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{editing ? 'Edit Component' : 'New Component'}</Text>
          <ScrollView>
            <Text style={styles.formLabel}>Name *</Text>
            <TextInput value={name} onChangeText={setName} placeholder="HRA" style={styles.formInput} />
            <Text style={styles.formLabel}>Code *</Text>
            <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="HRA" style={styles.formInput} maxLength={12} />
            <Text style={styles.formLabel}>Type</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['allowance', 'deduction'] as const).map(t => (
                <TouchableOpacity key={t} onPress={() => setType(t)} style={[styles.filterPill, type === t && { backgroundColor: brand, borderColor: brand }]}>
                  <Text style={[styles.filterPillText, type === t && { color: '#fff' }]}>{t === 'allowance' ? 'Allowance' : 'Deduction'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.formLabel}>Calculation</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([['fixed', 'Fixed'], ['percent_of_basic', '% of Basic']] as const).map(([v, l]) => (
                <TouchableOpacity key={v} onPress={() => setMethod(v)} style={[styles.filterPill, method === v && { backgroundColor: brand, borderColor: brand }]}>
                  <Text style={[styles.filterPillText, method === v && { color: '#fff' }]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {method === 'fixed' ? (
              <>
                <Text style={styles.formLabel}>Amount</Text>
                <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" style={styles.formInput} />
              </>
            ) : (
              <>
                <Text style={styles.formLabel}>Percentage</Text>
                <TextInput value={pct} onChangeText={setPct} keyboardType="numeric" style={styles.formInput} />
              </>
            )}
            <TouchableOpacity onPress={submit} disabled={busy} style={[styles.primaryBtn, { backgroundColor: brand, marginTop: spacing.md }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function VariableEarningModal({ visible, onClose, onSaved, editing, beauticians, defaultMonth, brand }:
  { visible: boolean; onClose: () => void; onSaved: () => void; editing: VariableEarning | null; beauticians: Beautician[]; defaultMonth: string; brand: string }) {
  const [empId, setEmpId] = useState('');
  const [month, setMonth] = useState(defaultMonth);
  const [type, setType] = useState('performance_incentive');
  const [amount, setAmount] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setEmpId(editing?.beautician_id || '');
      setMonth(editing?.month || defaultMonth);
      setType(editing?.earning_type || 'performance_incentive');
      setAmount(String(editing?.amount ?? 0));
      setNote(editing?.note || '');
    }
  }, [visible, editing, defaultMonth]);

  const submit = async () => {
    if (!empId) { Alert.alert('Missing', 'Select employee.'); return; }
    setBusy(true);
    try {
      if (editing) await payrollApi.updateVariableEarning(editing.id, { earning_type: type, amount: parseFloat(amount) || 0, note });
      else await payrollApi.createVariableEarning({ beautician_id: empId, month, earning_type: type, amount: parseFloat(amount) || 0, note });
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={[styles.modalCard, { maxHeight: '90%' }]} onPress={e => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{editing ? 'Edit Variable Earning' : 'New Variable Earning'}</Text>
          <ScrollView>
            {!editing && (
              <>
                <Text style={styles.formLabel}>Employee *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                  {beauticians.map(b => (
                    <TouchableOpacity key={b.id} onPress={() => setEmpId(b.id)} style={[styles.filterPill, empId === b.id && { backgroundColor: brand, borderColor: brand }]}>
                      <Text style={[styles.filterPillText, empId === b.id && { color: '#fff' }]}>{b.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={styles.formLabel}>Month *</Text>
                <TextInput value={month} onChangeText={setMonth} placeholder="YYYY-MM" style={styles.formInput} />
              </>
            )}
            <Text style={styles.formLabel}>Earning Type *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {VARIABLE_EARNING_TYPES.map(t => (
                <TouchableOpacity key={t.value} onPress={() => setType(t.value)} style={[styles.filterPill, type === t.value && { backgroundColor: brand, borderColor: brand }]}>
                  <Text style={[styles.filterPillText, type === t.value && { color: '#fff' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.formLabel}>Amount *</Text>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" style={styles.formInput} />
            <Text style={styles.formLabel}>Note</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="e.g. Q3 target bonus" style={styles.formInput} />
            <TouchableOpacity onPress={submit} disabled={busy} style={[styles.primaryBtn, { backgroundColor: brand, marginTop: spacing.md }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SalaryChangeModal({ visible, onClose, onSaved, beauticianId, currentBasic, brand }:
  { visible: boolean; onClose: () => void; onSaved: () => void; beauticianId: string; currentBasic: number; brand: string }) {
  const [basic, setBasic] = useState(String(currentBasic));
  const [effectiveFrom, setEffectiveFrom] = useState(ymd());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCal, setShowCal] = useState(false);

  useEffect(() => { if (visible) { setBasic(String(currentBasic)); setNote(''); setEffectiveFrom(ymd()); } }, [visible, currentBasic]);

  const submit = async () => {
    const val = parseFloat(basic);
    if (!val || val <= 0) { Alert.alert('Invalid', 'Enter a valid basic salary.'); return; }
    setBusy(true);
    try {
      await payrollApi.addSalaryChange({ beautician_id: beauticianId, effective_from: effectiveFrom, basic_salary: val, note });
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
          <Text style={styles.modalTitle}>New Salary Change</Text>
          <Text style={styles.formLabel}>New Basic Salary</Text>
          <TextInput value={basic} onChangeText={setBasic} keyboardType="numeric" style={styles.formInput} />
          <Text style={styles.formLabel}>Effective From</Text>
          <TouchableOpacity onPress={() => setShowCal(true)} style={styles.formInput}><Text>{effectiveFrom}</Text></TouchableOpacity>
          <Text style={styles.formLabel}>Note</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Reason for change" style={styles.formInput} />
          <TouchableOpacity onPress={submit} disabled={busy} style={[styles.primaryBtn, { backgroundColor: brand, marginTop: spacing.md }]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}
          </TouchableOpacity>
          {showCal && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setShowCal(false)}>
              <Pressable style={styles.modalScrim} onPress={() => setShowCal(false)}>
                <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
                  <RNCalendar current={effectiveFrom} onDayPress={(d: any) => { setEffectiveFrom(d.dateString); setShowCal(false); }} />
                </Pressable>
              </Pressable>
            </Modal>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MetricBlock({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  return (
    <View style={styles.metricBlock}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, highlight ? { color: highlight } : {}]}>{value}</Text>
    </View>
  );
}

function Empty({ icon, title, hint }: { icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap; title: string; hint: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={colors.onSurfaceTertiary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

// =====================================================================
// STYLES
// =====================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  headerSub: { fontSize: 11, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },

  tabPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  tabLabel: { fontSize: 12, fontWeight: '700' },

  pageTitle: { fontSize: 22, fontWeight: '800', color: colors.onSurface },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  helpText: { fontSize: 11, color: colors.onSurfaceTertiary, marginBottom: spacing.md, fontStyle: 'italic', lineHeight: 16 },

  card: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: '#EEE' },
  badgeText: { fontSize: 10, fontWeight: '800' },

  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', fontSize: 13 },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  dateText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.onSurface },

  filterPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  filterPillText: { fontSize: 12, fontWeight: '600', color: colors.onSurface },

  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: colors.onSurface },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md, marginBottom: spacing.md },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  secondaryBtnText: { fontWeight: '700', fontSize: 12 },

  money: { fontSize: 16, fontWeight: '800' },

  metricBlock: { flex: 1, minWidth: 100, backgroundColor: '#F7F5EE', padding: spacing.sm, borderRadius: radius.sm },
  metricLabel: { fontSize: 10, color: colors.onSurfaceTertiary, textTransform: 'uppercase', fontWeight: '700', letterSpacing: 0.3 },
  metricValue: { fontSize: 16, fontWeight: '800', color: colors.onSurface, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  emptyHint: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center' },

  modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, maxHeight: '92%' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.md },
  modalClose: { alignItems: 'center', padding: 12, marginTop: 8 },
  modalCloseText: { color: colors.onSurfaceTertiary, fontWeight: '700' },

  formLabel: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: spacing.sm, marginBottom: 6 },
  formInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, fontSize: 14, color: colors.onSurface, backgroundColor: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  slipLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  slipLabel: { fontSize: 13, color: colors.onSurface, flex: 1 },
  slipValue: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  slipTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 2, borderTopColor: colors.border },
  slipTotalLabel: { fontSize: 13, fontWeight: '800', color: colors.onSurface },
  slipTotalValue: { fontSize: 15, fontWeight: '800' },
});
