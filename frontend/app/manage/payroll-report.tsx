/**
 * Staff Performance — mobile mirror of the web `/app/staff-performance` page.
 *
 * The backend is the single source of truth (shared prod). We show every
 * enriched field the web page shows:
 *   • Period selector (Today / Week / Month / Last month / Custom range)
 *   • 4 KPI cards (Net Payable, Revenue, Commission, Advances)
 *   • Top performer highlight
 *   • "Earnings by staff" bar chart
 *   • Per-staff ranking cards with rank badge, salary, absent days, days/hours/OT,
 *     services, revenue, tips, commission, advances, delta vs prev, net payable,
 *     mark-paid toggle, share-payslip
 *   • Analytics table: New Clients, Repeat, Rebooking %, Revenue/Hr, Services/Hr,
 *     Tip %, Target %, Top services
 *   • Export options: CSV, PDF, Print
 *
 * Endpoints:
 *   GET  /api/reports/staff-performance?preset=...  |  ?from_date=&to_date=
 *   POST /api/reports/payroll/mark-paid              body: {beautician_id, from_date, to_date, net_payable, note}
 *   DELETE /api/reports/payroll/mark-paid?beautician_id=…&from_date=…&to_date=…
 *
 * Every optional field is guarded with `?? 0` so legacy backends (which only
 * return revenue/tips/earnings) still render without crashes — the enriched
 * sections just show placeholders.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, Modal, Pressable, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Calendar } from 'react-native-calendars';

import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import {
  rowsToCsv, shareCsv, sharePdf, printOrShareHtml, buildReportHtml,
} from '@/src/utils/exportShare';
import { hm } from '@/src/utils/time';

type Preset = 'today' | 'week' | 'month' | 'last_month';

type StaffRow = {
  beautician_id: string;
  beautician_name: string;
  role?: string;
  employee_id?: string;
  phone?: string;
  basic_salary?: number;
  commission_pct?: number;
  monthly_target?: number;
  days_worked?: number;
  total_hours?: number;
  overtime_hours?: number;
  late_days?: number;
  absent_days?: number;
  services?: number;
  appointments?: number;
  revenue?: number;
  tips?: number;
  tips_owed_cash?: number;
  commission?: number;
  advances?: number;
  earnings?: number;
  net_payable?: number;
  new_clients?: number;
  repeat_clients?: number;
  rebooking_rate?: number;
  revenue_per_hour?: number;
  services_per_hour?: number;
  tip_pct?: number;
  target_achievement_pct?: number;
  prev_revenue?: number;
  revenue_delta_pct?: number;
  top_services?: { name: string; count: number }[];
  paid?: boolean;
  trend?: { date: string; value: number }[];
};

type Totals = {
  revenue?: number;
  tips?: number;
  commission?: number;
  advances?: number;
  net_payable?: number;
  earnings?: number;
  services?: number;
  days_worked?: number;
  total_hours?: number;
  appointments?: number;
};

type PerfResponse = {
  from: string;
  to: string;
  days?: string[];
  rows: StaffRow[];
  totals: Totals;
  top_performer?: StaffRow | null;
};

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Today', week: 'This Week', month: 'This Month', last_month: 'Last Month',
};

// Palette used for the "Earnings by staff" chart bars — cycled by index.
const CHART_PALETTE = ['#C42032', '#D96B3E', '#E4A34C', '#4A9B5C', '#3F7EB3', '#8A5CB8', '#B84E7A', '#5C7A94'];

// ---------- Small helpers ----------
const num = (v: any) => (typeof v === 'number' ? v : 0);
const pct = (v: any, digits = 0) => `${num(v).toFixed(digits)}%`;

export default function PayrollReportScreen() {
  const router = useRouter();
  const { user, tenant } = useAuth();
  // Backend `staff-performance` endpoint is now OWNER-ONLY (returns 403 for admins).
  // We keep the `can('reports')` fallback only to short-circuit the redirect during
  // the loading race — the gate below will kick non-owners out anyway.
  const isOwner = !!user?.is_owner;
  const allowed = isOwner;

  // Bounce non-owners to the dashboard BEFORE any API call fires — the
  // endpoint would 403 otherwise.
  useEffect(() => {
    if (user && !isOwner) {
      router.replace('/(tabs)' as any);
    }
  }, [user, isOwner, router]);

  const [preset, setPreset] = useState<Preset | 'custom'>('month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [data, setData] = useState<PerfResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [rangeStep, setRangeStep] = useState<'from' | 'to'>('from');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const buildQs = useCallback((p: Preset | 'custom', from?: string, to?: string) => {
    if (p === 'custom' && from && to) return `?from_date=${from}&to_date=${to}`;
    return `?preset=${p}`;
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!allowed) { setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      const qs = buildQs(preset, customFrom, customTo);
      const res: any = await api(`/reports/staff-performance${qs}`);
      if (res) setData(res);
    } catch {
      if (!silent) setData({ from: '', to: '', rows: [], totals: {} });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [allowed, preset, customFrom, customTo, buildQs]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(true); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };

  const pickPreset = (p: Preset) => {
    Haptics.selectionAsync();
    setCustomFrom(''); setCustomTo('');
    setPreset(p);
  };

  const openCustomRange = () => {
    Haptics.selectionAsync();
    setRangeStep('from');
    setRangePickerOpen(true);
  };

  const onDayPress = (d: { dateString: string }) => {
    Haptics.selectionAsync();
    if (rangeStep === 'from') { setCustomFrom(d.dateString); setRangeStep('to'); return; }
    if (customFrom && d.dateString < customFrom) {
      setCustomFrom(d.dateString); setRangeStep('to'); return;
    }
    setCustomTo(d.dateString);
    setRangePickerOpen(false);
    setPreset('custom');
  };

  // ---- Mark paid / undo ----
  const togglePaid = async (row: StaffRow) => {
    if (!data) return;
    if (!row.beautician_id) return;
    setPayingId(row.beautician_id);
    Haptics.selectionAsync();
    try {
      if (row.paid) {
        await api(`/reports/payroll/mark-paid?beautician_id=${row.beautician_id}&from_date=${data.from}&to_date=${data.to}`, { method: 'DELETE' });
      } else {
        await api(`/reports/payroll/mark-paid`, {
          method: 'POST',
          body: {
            beautician_id: row.beautician_id,
            from_date: data.from,
            to_date: data.to,
            net_payable: num(row.net_payable),
            note: `Paid via mobile · ${new Date().toISOString().slice(0, 10)}`,
          },
        });
      }
      // Optimistic flip so the badge feels instant; then reconcile with server.
      setData(d => d ? { ...d, rows: d.rows.map(r => r.beautician_id === row.beautician_id ? { ...r, paid: !r.paid } : r) } : d);
      await load(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Payroll', e?.message || 'Failed to update paid status.');
    } finally {
      setPayingId(null);
    }
  };

  // ---- Derived: chart data ("Earnings by staff") ----
  const chartRows = useMemo(() => {
    if (!data?.rows) return [] as { name: string; value: number }[];
    return [...data.rows]
      .map(r => ({
        name: r.beautician_name,
        value: num(r.revenue) + num(r.tips) || num(r.earnings) || 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [data]);
  const chartMax = Math.max(1, ...chartRows.map(r => r.value));

  // ---- Export builders ----
  const buildPayrollExport = () => {
    const headers = [
      '#', 'Staff', 'Employee ID', 'Role', 'Salary', 'Days', 'Absent',
      'Hours', 'OT (h)', 'Services', 'Revenue', 'Tips', 'Commission',
      'Advances', 'Net Payable', 'vs Prev %', 'Paid',
    ];
    const rows = (data?.rows || []).map((r, i) => [
      i + 1,
      r.beautician_name,
      r.employee_id || '',
      r.role || '',
      num(r.basic_salary),
      num(r.days_worked),
      num(r.absent_days),
      num(r.total_hours),
      num(r.overtime_hours),
      num(r.services),
      num(r.revenue),
      num(r.tips),
      num(r.commission),
      num(r.advances),
      num(r.net_payable),
      Number(num(r.revenue_delta_pct).toFixed(1)),
      r.paid ? 'Yes' : 'No',
    ]);
    const t = data?.totals || {};
    const totalRow = [
      'TOTAL', '', '', '', '',
      num(t.days_worked), '', num(t.total_hours), '',
      num(t.services), num(t.revenue), num(t.tips),
      num(t.commission), num(t.advances), num(t.net_payable),
      '', '',
    ];
    return { headers, rows, totalRow };
  };

  const buildAnalyticsExport = () => {
    const headers = [
      'Staff', 'New Clients', 'Repeat', 'Rebooking %', 'Revenue/Hr',
      'Services/Hr', 'Tip %', 'Target %', 'Top services',
    ];
    const rows = (data?.rows || []).map(r => [
      r.beautician_name,
      num(r.new_clients),
      num(r.repeat_clients),
      Number(num(r.rebooking_rate).toFixed(1)),
      Number(num(r.revenue_per_hour).toFixed(0)),
      Number(num(r.services_per_hour).toFixed(1)),
      Number(num(r.tip_pct).toFixed(1)),
      Number(num(r.target_achievement_pct).toFixed(1)),
      (r.top_services || []).map(t => `${t.name} (${t.count})`).join('; ') || '—',
    ]);
    return { headers, rows };
  };

  const doExportCsv = async () => {
    setExportOpen(false);
    if (!data || data.rows.length === 0) {
      Alert.alert('Export', 'Nothing to export for this period.');
      return;
    }
    setExportBusy(true);
    try {
      const { headers, rows, totalRow } = buildPayrollExport();
      const ana = buildAnalyticsExport();
      // Two sections joined with a blank line so Excel keeps them separate.
      const csv = [
        `Payroll ranking, ${data.from} to ${data.to}`,
        rowsToCsv(headers, [...rows, totalRow]),
        '',
        'Analytics',
        rowsToCsv(ana.headers, ana.rows),
      ].join('\n');
      await shareCsv(csv, `staff_performance_${data.from}_${data.to}.csv`);
    } catch (e: any) {
      Alert.alert('Export', e?.message || 'Could not share the CSV.');
    } finally {
      setExportBusy(false);
    }
  };

  const buildHtml = () => {
    const t = data?.totals || {};
    const { headers, rows, totalRow } = buildPayrollExport();
    return buildReportHtml({
      title: 'Staff Performance Report',
      subtitle: `${data?.from} → ${data?.to}`,
      brand: {
        name: tenant?.business_name,
        color: (tenant as any)?.brand_color || '#C42032',
        logo: (tenant as any)?.logo || null,
      },
      summary: [
        { label: 'Total Net Payable', value: fmtINR(num(t.net_payable)) },
        { label: 'Revenue', value: fmtINR(num(t.revenue)) },
        { label: 'Commission', value: fmtINR(num(t.commission)) },
        { label: 'Advances', value: fmtINR(num(t.advances)) },
        { label: 'Top Performer', value: data?.top_performer?.beautician_name || '—' },
      ],
      columns: headers,
      rows,
      totalRow,
      footer: 'Payroll reference report',
    });
  };

  const doSharePdf = async () => {
    setExportOpen(false);
    if (!data || data.rows.length === 0) {
      Alert.alert('Export', 'Nothing to export for this period.');
      return;
    }
    setExportBusy(true);
    try { await sharePdf(buildHtml(), `staff_performance_${data.from}_${data.to}.pdf`); }
    catch (e: any) { Alert.alert('Export', e?.message || 'Could not share the PDF.'); }
    finally { setExportBusy(false); }
  };

  const doPrint = async () => {
    setExportOpen(false);
    if (!data || data.rows.length === 0) return;
    setExportBusy(true);
    try { await printOrShareHtml(buildHtml(), `staff_performance_${data.from}_${data.to}.pdf`); }
    catch (e: any) { Alert.alert('Print', e?.message || 'Could not open printer dialog.'); }
    finally { setExportBusy(false); }
  };

  // ---- Payslip share (per staff, fully branded PDF) ----
  const sharePayslip = async (row: StaffRow) => {
    if (!data) return;
    try {
      const t: any = tenant || {};
      const brand = t.brand_color || '#C42032';
      const businessName = escHtml(t.business_name || 'Salon');
      const initials = businessName.slice(0, 1).toUpperCase();
      const addressLine = escHtml(
        [t.address, t.address_line_2, t.city, t.state, t.postal_code, t.country]
          .filter(Boolean).join(', ')
      );
      const phone = escHtml(t.phone || '');
      const email = escHtml(t.email || '');
      const website = escHtml(t.website || '');
      const gst = t.tax_enabled && t.tax_number ? `GST/Tax: ${escHtml(t.tax_number)}` : '';
      const footerNote = escHtml(t.receipt_footer || 'Thank you.');
      const period = `${data.from} → ${data.to}`;
      const generatedAt = new Date().toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const paidBadge = row.paid
        ? `<span class="pill pill-paid">✓ PAID</span>`
        : `<span class="pill pill-pending">⏳ Pending</span>`;

      // Earnings table body — hide zero rows to keep the payslip tight.
      const earningsRows: string[] = [];
      const push = (label: string, val: string, opts?: { neg?: boolean; strong?: boolean }) =>
        earningsRows.push(
          `<tr${opts?.strong ? ' class="strong"' : ''}>
            <td>${escHtml(label)}</td>
            <td class="num${opts?.neg ? ' neg' : ''}">${escHtml(val)}</td>
          </tr>`
        );

      push('Basic Salary', fmtINR(num(row.basic_salary)));
      if (num(row.commission) > 0) push(`Commission${num(row.commission_pct) ? ` (${num(row.commission_pct)}%)` : ''}`, `+ ${fmtINR(num(row.commission))}`);
      if (num(row.tips) > 0) push('Tips Earned', `+ ${fmtINR(num(row.tips))}`);
      if (num(row.advances) > 0) push('Advances Deducted', `− ${fmtINR(num(row.advances))}`, { neg: true });

      const html = `
<!doctype html>
<html><head><meta charset="utf-8"/><title>Payslip — ${escHtml(row.beautician_name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 32px; color: #1a1a1a; background: #fff; }
  .page { max-width: 780px; margin: 0 auto; }

  /* Brand header */
  .header {
    display: flex; align-items: center; gap: 16px;
    padding: 20px 24px; border-radius: 12px 12px 0 0;
    background: linear-gradient(135deg, ${brand} 0%, ${shade(brand, -12)} 100%);
    color: #fff;
  }
  .logo {
    width: 64px; height: 64px; border-radius: 12px;
    background: rgba(255,255,255,0.18);
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 800; letter-spacing: 1px;
    overflow: hidden;
  }
  .logo img { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; }
  .brand-name { font-size: 22px; font-weight: 800; letter-spacing: 0.3px; }
  .brand-meta { font-size: 11px; opacity: 0.92; margin-top: 4px; line-height: 1.5; }
  .brand-meta a { color: #fff; text-decoration: none; }
  .badge {
    margin-left: auto; padding: 6px 12px; border-radius: 999px;
    background: rgba(255,255,255,0.2); font-size: 10px; font-weight: 800; letter-spacing: 1.2px;
  }

  /* Sub-header — payslip title */
  .sub {
    padding: 14px 24px; background: #fff; border: 1px solid #e5e5e5; border-top: none;
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
  }
  .sub h1 { font-size: 15px; margin: 0; letter-spacing: 3px; color: #666; font-weight: 800; }
  .sub .period { font-size: 12px; color: #444; font-weight: 700; }

  /* Employee block */
  .emp {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0;
    border: 1px solid #e5e5e5; border-top: none;
  }
  .emp .cell { padding: 12px 20px; }
  .emp .cell + .cell { border-left: 1px solid #e5e5e5; }
  .emp .lbl { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
  .emp .val { font-size: 14px; color: #1a1a1a; font-weight: 700; margin-top: 3px; }

  /* Attendance metrics */
  .metrics {
    display: grid; grid-template-columns: repeat(4, 1fr);
    border: 1px solid #e5e5e5; border-top: none;
    background: #fafafa;
  }
  .metric { padding: 12px; text-align: center; }
  .metric + .metric { border-left: 1px solid #e5e5e5; }
  .metric .lbl { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; }
  .metric .val { font-size: 18px; color: #1a1a1a; font-weight: 800; margin-top: 4px; }
  .metric .sub { font-size: 10px; color: #b8860b; font-weight: 700; margin-top: 2px; }

  /* Earnings table */
  h2 { font-size: 11px; letter-spacing: 2px; color: #666; margin: 22px 0 8px; text-transform: uppercase; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; }
  table th, table td {
    padding: 12px 20px; text-align: left; font-size: 13px;
    border-bottom: 1px solid #eee;
  }
  table th { background: #fafafa; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }
  table .num { text-align: right; font-weight: 700; }
  table .neg { color: #C42032; }
  table tr.strong td { background: ${brand}; color: #fff; font-size: 15px; font-weight: 800; padding: 16px 20px; }
  table tr.strong td.num { font-size: 20px; }

  /* Pills */
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: 1px; }
  .pill-paid { background: #2E7D32; color: #fff; }
  .pill-pending { background: #FFF6E0; color: #B8860B; }

  /* Signature */
  .sign {
    display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px;
  }
  .sign .box { border-top: 1px dashed #999; padding-top: 8px; text-align: center; font-size: 11px; color: #666; font-weight: 700; }

  /* Footer */
  .footer {
    margin-top: 30px; padding-top: 14px; border-top: 2px solid ${brand};
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;
    font-size: 10px; color: #888;
  }
  .footer .brand-tag { color: ${brand}; font-weight: 800; letter-spacing: 0.5px; }

  @media print {
    body { padding: 0; }
    .page { max-width: none; }
  }
</style>
</head>
<body>
  <div class="page">
    <!-- BRAND HEADER -->
    <div class="header">
      <div class="logo">${t.logo ? `<img src="${escHtml(t.logo)}" alt=""/>` : initials}</div>
      <div style="flex:1; min-width:0">
        <div class="brand-name">${businessName}</div>
        <div class="brand-meta">
          ${addressLine ? escHtml(addressLine) + '<br/>' : ''}
          ${[phone && `📞 ${phone}`, email && `✉ ${email}`, website && `🌐 ${website}`].filter(Boolean).join(' &nbsp;·&nbsp; ')}
          ${gst ? `<br/>${gst}` : ''}
        </div>
      </div>
      <div class="badge">PAYSLIP</div>
    </div>

    <!-- SUB HEADER -->
    <div class="sub">
      <h1>SALARY STATEMENT</h1>
      <span class="period">${escHtml(period)}</span>
      ${paidBadge}
    </div>

    <!-- EMPLOYEE INFO -->
    <div class="emp">
      <div class="cell">
        <div class="lbl">Employee Name</div>
        <div class="val">${escHtml(row.beautician_name)}</div>
      </div>
      <div class="cell">
        <div class="lbl">Role / Designation</div>
        <div class="val">${escHtml(row.role || 'Stylist')}</div>
      </div>
      <div class="cell">
        <div class="lbl">Employee ID</div>
        <div class="val">${escHtml(row.employee_id || '—')}</div>
      </div>
      <div class="cell">
        <div class="lbl">Contact</div>
        <div class="val">${escHtml(row.phone || '—')}</div>
      </div>
    </div>

    <!-- ATTENDANCE METRICS -->
    <div class="metrics">
      <div class="metric">
        <div class="lbl">Days Worked</div>
        <div class="val">${num(row.days_worked)}</div>
        ${num(row.absent_days) > 0 ? `<div class="sub">${num(row.absent_days)} absent</div>` : ''}
      </div>
      <div class="metric">
        <div class="lbl">Total Hours</div>
        <div class="val">${escHtml(hm(num(row.total_hours)))}</div>
        ${num(row.overtime_hours) > 0 ? `<div class="sub">+${escHtml(hm(num(row.overtime_hours)))} OT</div>` : ''}
      </div>
      <div class="metric">
        <div class="lbl">Services</div>
        <div class="val">${num(row.services)}</div>
      </div>
      <div class="metric">
        <div class="lbl">Late Days</div>
        <div class="val">${num(row.late_days)}</div>
      </div>
    </div>

    <!-- EARNINGS BREAKDOWN -->
    <h2>Earnings breakdown</h2>
    <table>
      <thead><tr><th>Component</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${earningsRows.join('\n')}
        <tr class="strong">
          <td>NET PAYABLE</td>
          <td class="num">${escHtml(fmtINR(num(row.net_payable)))}</td>
        </tr>
      </tbody>
    </table>

    <!-- SIGNATURES -->
    <div class="sign">
      <div class="box">Employee Signature</div>
      <div class="box">Authorised Signatory</div>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <div>${footerNote}</div>
      <div>Generated ${escHtml(generatedAt)} · <span class="brand-tag">${businessName}</span></div>
    </div>
  </div>
</body>
</html>`.trim();

      const safeName = row.beautician_name.replace(/\s+/g, '_');
      await sharePdf(html, `payslip_${safeName}_${data.from}.pdf`);
    } catch (e: any) {
      Alert.alert('Payslip', e?.message || 'Could not share the payslip.');
    }
  };

  // Small helpers used only by the payslip HTML
  function escHtml(s: any): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function shade(hex: string, pct: number): string {
    // Lighten (+) or darken (−) a hex colour by pct%; falls back to same colour on parse errors.
    try {
      const c = hex.replace('#', '');
      const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
      const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * pct / 100)));
      const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * pct / 100)));
      const b = Math.max(0, Math.min(255, (n & 0xff) + Math.round(255 * pct / 100)));
      return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    } catch { return hex; }
  }

  // ---- Render ----
  if (!allowed) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Staff Performance</Text>
        </SafeAreaView>
        <View style={styles.emptyBox}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Owner-only screen.{'\n'}Payroll & performance data is visible only to the salon owner.</Text>
          <TouchableOpacity
            style={{ marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.brandPrimary }}
            onPress={() => router.replace('/(tabs)' as any)}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const totals = data?.totals || {};

  return (
    <View style={styles.root} testID="payroll-report-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Staff Performance</Text>
          {data && <Text style={styles.headerSub}>{data.from} → {data.to}</Text>}
        </View>
        <TouchableOpacity
          onPress={() => { Haptics.selectionAsync(); setExportOpen(true); }}
          style={styles.exportBtn}
          testID="export-btn"
          disabled={exportBusy}
        >
          {exportBusy ? <ActivityIndicator size="small" color="#fff" /> : (
            <>
              <Ionicons name="share-outline" size={16} color="#fff" />
              <Text style={styles.exportBtnText}>Export</Text>
            </>
          )}
        </TouchableOpacity>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {/* Period selector */}
        <View style={styles.periodRow}>
          {(['today', 'week', 'month', 'last_month'] as Preset[]).map(p => (
            <TouchableOpacity
              key={p}
              onPress={() => pickPreset(p)}
              testID={`preset-${p}`}
              style={[styles.periodChip, preset === p && styles.periodChipActive]}
            >
              <Text style={[styles.periodChipText, preset === p && styles.periodChipTextActive]}>
                {PRESET_LABELS[p]}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={openCustomRange}
            testID="preset-custom"
            style={[styles.periodChip, preset === 'custom' && styles.periodChipActive]}
          >
            <Ionicons name="calendar-outline" size={12} color={preset === 'custom' ? '#fff' : colors.brandPrimary} />
            <Text style={[styles.periodChipText, preset === 'custom' && styles.periodChipTextActive]}>
              {preset === 'custom' && customFrom && customTo ? `${customFrom}→${customTo}` : 'Custom'}
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
        ) : (
          <>
            {/* KPI cards */}
            <View style={styles.totalsGrid}>
              <TotalCard label="Net Payable" value={fmtINR(num(totals.net_payable))} icon="wallet-outline" color={colors.brandPrimary} highlight testID="total-net" />
              <TotalCard label="Revenue"     value={fmtINR(num(totals.revenue))}     icon="trending-up-outline" color={colors.success} testID="total-revenue" />
              <TotalCard label="Commission"  value={fmtINR(num(totals.commission))}  icon="cash-outline" color={colors.info} testID="total-commission" />
              <TotalCard label="Advances"    value={fmtINR(num(totals.advances))}    icon="arrow-down-circle-outline" color={colors.error} testID="total-advances" />
            </View>

            {/* Top performer */}
            {data?.top_performer && (num(data.top_performer.revenue) > 0 || num(data.top_performer.earnings) > 0) && (
              <View style={styles.topPerformerCard} testID="top-performer">
                <View style={styles.topPerformerBadge}>
                  <Ionicons name="trophy" size={16} color="#B8860B" />
                  <Text style={styles.topPerformerBadgeText}>TOP PERFORMER</Text>
                </View>
                <Text style={styles.topPerformerName}>{data.top_performer.beautician_name}</Text>
                <Text style={styles.topPerformerRev}>
                  {fmtINR(num(data.top_performer.revenue) || num(data.top_performer.earnings))} revenue
                  {num(data.top_performer.services) > 0 ? ` · ${num(data.top_performer.services)} services` : ''}
                  {num(data.top_performer.days_worked) > 0 ? ` · ${num(data.top_performer.days_worked)} days` : ''}
                </Text>
              </View>
            )}

            {/* Earnings by staff chart */}
            {chartRows.length > 0 && chartMax > 0 && (
              <View style={styles.chartCard} testID="earnings-chart">
                <Text style={styles.cardTitle}>Earnings by staff</Text>
                <Text style={styles.cardSub}>Top {chartRows.length} · revenue + tips this period</Text>
                <View style={styles.chartArea}>
                  {chartRows.map((c, i) => {
                    const h = Math.max(6, (c.value / chartMax) * 140);
                    return (
                      <View key={c.name + i} style={styles.chartCol}>
                        <Text style={styles.chartBarVal} numberOfLines={1}>
                          {c.value >= 1000 ? `${Math.round(c.value / 100) / 10}k` : String(Math.round(c.value))}
                        </Text>
                        <View style={[styles.chartBar, { height: h, backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }]} />
                        <Text style={styles.chartXLabel} numberOfLines={1}>{c.name.split(' ')[0].slice(0, 6)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Payroll ranking */}
            <Text style={styles.sectionTitle}>Payroll ranking ({data?.rows.length || 0})</Text>
            {(data?.rows || []).length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="people-outline" size={32} color={colors.onSurfaceTertiary} />
                <Text style={styles.emptyText}>No payroll data for this period.</Text>
              </View>
            ) : (
              (data?.rows || []).map((row, idx) => (
                <StaffCard
                  key={row.beautician_id || row.beautician_name + idx}
                  row={row}
                  rank={idx + 1}
                  paying={payingId === row.beautician_id}
                  onOpen={() => router.push({ pathname: '/manage/payroll-detail/[id]', params: { id: row.beautician_id, from: data!.from, to: data!.to } } as any)}
                  onTogglePaid={() => togglePaid(row)}
                  onSharePayslip={() => sharePayslip(row)}
                />
              ))
            )}

            {/* Analytics section */}
            {(data?.rows || []).some(r =>
              num(r.new_clients) + num(r.repeat_clients) + num(r.rebooking_rate) +
              num(r.revenue_per_hour) + num(r.services_per_hour) + num(r.tip_pct) +
              num(r.target_achievement_pct) + (r.top_services?.length || 0) > 0
            ) && (
              <View style={styles.analyticsCard} testID="analytics-section">
                <Text style={styles.cardTitle}>Analytics</Text>
                <Text style={styles.cardSub}>Client retention, hourly velocity & top services</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginTop: spacing.sm }}>
                  <View>
                    {/* header */}
                    <View style={styles.analyticsHeadRow}>
                      {['Staff', 'New', 'Repeat', 'Rebook %', 'Rev/Hr', 'Svc/Hr', 'Tip %', 'Target %', 'Top services'].map(h => (
                        <Text key={h} style={[styles.analyticsHeadCell, h === 'Staff' ? { width: 120 } : h === 'Top services' ? { width: 160 } : { width: 80 }]}>
                          {h}
                        </Text>
                      ))}
                    </View>
                    {(data?.rows || []).map((r, i) => (
                      <View key={r.beautician_id + '_a' + i} style={styles.analyticsRow} testID={`analytics-row-${i}`}>
                        <Text style={[styles.analyticsCell, { width: 120, fontWeight: '700', color: colors.onSurface }]} numberOfLines={1}>{r.beautician_name}</Text>
                        <Text style={[styles.analyticsCell, { width: 80 }]}>{num(r.new_clients)}</Text>
                        <Text style={[styles.analyticsCell, { width: 80 }]}>{num(r.repeat_clients)}</Text>
                        <Text style={[styles.analyticsCell, { width: 80 }]}>{pct(r.rebooking_rate)}</Text>
                        <Text style={[styles.analyticsCell, { width: 80 }]}>{fmtINR(num(r.revenue_per_hour))}</Text>
                        <Text style={[styles.analyticsCell, { width: 80 }]}>{num(r.services_per_hour).toFixed(1)}</Text>
                        <Text style={[styles.analyticsCell, { width: 80 }]}>{pct(r.tip_pct)}</Text>
                        <View style={{ width: 80, alignItems: 'flex-start', paddingRight: 8 }}>
                          <View style={[
                            styles.targetPill,
                            num(r.target_achievement_pct) >= 80 ? { backgroundColor: '#DDF3E4' } :
                            num(r.target_achievement_pct) >= 40 ? { backgroundColor: '#FFF6E0' } :
                            { backgroundColor: '#FDECEC' },
                          ]}>
                            <Text style={[styles.targetPillText, {
                              color: num(r.target_achievement_pct) >= 80 ? colors.success :
                                     num(r.target_achievement_pct) >= 40 ? '#B8860B' : colors.error,
                            }]}>
                              {pct(r.target_achievement_pct)}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.analyticsCell, { width: 160 }]} numberOfLines={1}>
                          {(r.top_services || []).slice(0, 2).map(t => `${t.name} (${t.count})`).join(', ') || '—'}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
                <Text style={styles.scrollHint}>← swipe →</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Custom date-range picker */}
      <Modal visible={rangePickerOpen} transparent animationType="fade" onRequestClose={() => setRangePickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRangePickerOpen(false)}>
          <Pressable style={styles.datePickerSheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{rangeStep === 'from' ? 'Pick FROM date' : 'Pick TO date'}</Text>
            <Text style={styles.sheetSub}>
              {customFrom ? `From: ${customFrom}` : 'From: —'}  ·  {customTo ? `To: ${customTo}` : 'To: —'}
            </Text>
            <Calendar
              testID="range-calendar"
              current={rangeStep === 'from' ? undefined : customFrom || undefined}
              maxDate={new Date().toISOString().slice(0, 10)}
              onDayPress={onDayPress}
              markedDates={{
                ...(customFrom ? { [customFrom]: { startingDay: true, color: colors.brandPrimary, textColor: '#fff' } } : {}),
                ...(customTo ? { [customTo]: { endingDay: true, color: colors.brandPrimary, textColor: '#fff' } } : {}),
              }}
              markingType="period"
              theme={{
                calendarBackground: colors.surface,
                selectedDayBackgroundColor: colors.brandPrimary,
                todayTextColor: colors.brandPrimary,
                arrowColor: colors.brandPrimary,
              }}
            />
            <TouchableOpacity style={styles.datePickerClose} onPress={() => setRangePickerOpen(false)}>
              <Text style={styles.datePickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Export sheet — CSV / PDF / Print */}
      <Modal visible={exportOpen} transparent animationType="slide" onRequestClose={() => setExportOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setExportOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Export Staff Performance</Text>
            <Text style={styles.sheetSub}>{data?.from} → {data?.to}</Text>
            <TouchableOpacity style={styles.sheetOpt} onPress={doExportCsv} testID="export-csv">
              <View style={[styles.sheetOptIcon, { backgroundColor: '#DFF3E1' }]}><Ionicons name="grid-outline" size={20} color="#2E7D32" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptLabel}>CSV (Excel)</Text>
                <Text style={styles.sheetOptHint}>Payroll ranking + analytics in one file</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetOpt} onPress={doSharePdf} testID="export-pdf">
              <View style={[styles.sheetOptIcon, { backgroundColor: '#FDE9E9' }]}><Ionicons name="document-text-outline" size={20} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptLabel}>PDF</Text>
                <Text style={styles.sheetOptHint}>Formatted document with your branding</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetOpt} onPress={doPrint} testID="export-print">
              <View style={[styles.sheetOptIcon, { backgroundColor: '#E3EDF7' }]}><Ionicons name="print-outline" size={20} color="#3F6C9C" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptLabel}>Print</Text>
                <Text style={styles.sheetOptHint}>Open the system printer dialog</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setExportOpen(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------- Sub-components ----------
function TotalCard({ label, value, icon, color, highlight, testID }: {
  label: string; value: string; icon: any; color: string; highlight?: boolean; testID?: string;
}) {
  return (
    <View style={[styles.totalCard, highlight && styles.totalCardHighlight]} testID={testID}>
      <View style={[styles.totalIcon, { backgroundColor: highlight ? 'rgba(255,255,255,0.15)' : colors.brandTertiary }]}>
        <Ionicons name={icon} size={16} color={highlight ? '#fff' : color} />
      </View>
      <Text style={[styles.totalLabel, highlight && { color: 'rgba(255,255,255,0.85)' }]}>{label}</Text>
      <Text style={[styles.totalValue, highlight && { color: '#fff' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function StaffCard({ row, rank, paying, onOpen, onTogglePaid, onSharePayslip }: {
  row: StaffRow;
  rank: number;
  paying: boolean;
  onOpen: () => void;
  onTogglePaid: () => void;
  onSharePayslip: () => void;
}) {
  const delta = num(row.revenue_delta_pct);
  const deltaUp = delta > 0.5;
  const deltaDown = delta < -0.5;
  const isTop3 = rank <= 3;

  return (
    <TouchableOpacity
      testID={`staff-card-${row.beautician_id}`}
      style={[styles.staffCard, row.paid && styles.staffCardPaid]}
      onPress={onOpen}
      activeOpacity={0.85}
    >
      {/* Header row: rank + name + paid badge */}
      <View style={styles.staffHeader}>
        <View style={[
          styles.rankBadge,
          isTop3 && { backgroundColor: rank === 1 ? '#FDECC7' : rank === 2 ? '#E7E4DD' : '#F4E1D0' },
        ]}>
          {rank === 1 ? (
            <Ionicons name="trophy" size={14} color="#B8860B" />
          ) : (
            <Text style={[styles.rankBadgeText, isTop3 && { color: '#5A4A2C' }]}>#{rank}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.staffName} numberOfLines={1}>{row.beautician_name}</Text>
          <Text style={styles.staffMeta} numberOfLines={1}>
            {[
              row.role || 'Stylist',
              row.employee_id ? `ID: ${row.employee_id}` : null,
              num(row.basic_salary) > 0 ? `Salary ${fmtINR(num(row.basic_salary))}` : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {row.paid && (
          <View style={styles.paidBadge} testID={`paid-badge-${row.beautician_id}`}>
            <Ionicons name="checkmark-circle" size={12} color="#fff" />
            <Text style={styles.paidBadgeText}>PAID</Text>
          </View>
        )}
      </View>

      {/* Net Payable + delta */}
      <View style={styles.staffNetRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.staffNetLabel}>NET PAYABLE</Text>
          <Text style={styles.staffNetValue}>{fmtINR(num(row.net_payable))}</Text>
        </View>
        {(deltaUp || deltaDown) && (
          <View style={[styles.deltaChip, { backgroundColor: deltaUp ? '#DDF3E4' : '#FDE2E2' }]}>
            <Ionicons name={deltaUp ? 'arrow-up' : 'arrow-down'} size={12} color={deltaUp ? colors.success : colors.error} />
            <Text style={[styles.deltaText, { color: deltaUp ? colors.success : colors.error }]}>
              {Math.abs(delta).toFixed(1)}%
            </Text>
          </View>
        )}
      </View>

      {/* Compact stats — 3 rows */}
      <View style={styles.statRow}>
        <MiniStat label="Days" value={`${num(row.days_worked)}`} sub={num(row.absent_days) > 0 ? `${num(row.absent_days)} abs` : undefined} />
        <MiniStat label="Hours" value={hm(num(row.total_hours))} sub={num(row.overtime_hours) > 0 ? `+${hm(num(row.overtime_hours))} OT` : undefined} />
        <MiniStat label="Services" value={String(num(row.services))} />
      </View>
      <View style={styles.statRow}>
        <MiniStat label="Revenue" value={fmtINR(num(row.revenue))} />
        <MiniStat label="Tips" value={fmtINR(num(row.tips))} />
        <MiniStat label="Commission" value={fmtINR(num(row.commission))} />
      </View>
      <View style={styles.statRow}>
        <MiniStat label="Advances" value={fmtINR(num(row.advances))} tone={num(row.advances) > 0 ? 'warn' : undefined} />
        <MiniStat label="Late" value={String(num(row.late_days))} tone={num(row.late_days) > 0 ? 'warn' : undefined} />
        <MiniStat label="Absent" value={String(num(row.absent_days))} tone={num(row.absent_days) > 0 ? 'warn' : undefined} />
      </View>

      {/* Action row */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          testID={`toggle-paid-${row.beautician_id}`}
          onPress={(e) => { e.stopPropagation?.(); onTogglePaid(); }}
          disabled={paying}
          style={[styles.actionBtn, row.paid ? styles.actionBtnUndo : styles.actionBtnPay]}
        >
          {paying ? <ActivityIndicator size="small" color={row.paid ? colors.error : '#fff'} /> : (
            <>
              <Ionicons name={row.paid ? 'refresh-outline' : 'checkmark-circle-outline'} size={16} color={row.paid ? colors.error : '#fff'} />
              <Text style={[styles.actionBtnText, row.paid && { color: colors.error }]}>
                {row.paid ? 'Undo paid' : 'Mark paid'}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          testID={`share-payslip-${row.beautician_id}`}
          onPress={(e) => { e.stopPropagation?.(); onSharePayslip(); }}
          style={[styles.actionBtn, styles.actionBtnShare]}
        >
          <Ionicons name="share-social-outline" size={16} color={colors.brandPrimary} />
          <Text style={[styles.actionBtnText, { color: colors.brandPrimary }]}>Payslip</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatLabel}>{label}</Text>
      <Text style={[styles.miniStatValue, tone === 'warn' && { color: colors.error }]} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={styles.miniStatSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    minWidth: 78, justifyContent: 'center',
  },
  exportBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  periodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.brandSecondary, backgroundColor: colors.surface,
  },
  periodChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  periodChipText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  periodChipTextActive: { color: '#fff' },

  loadingBox: { paddingVertical: spacing.xxxl, alignItems: 'center' },

  totalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  totalCard: {
    width: '48%', padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 4, ...shadows.card,
  },
  totalCardHighlight: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  totalIcon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  totalLabel: { fontSize: 10, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  totalValue: { fontSize: 17, fontWeight: '900', color: colors.onSurface },

  topPerformerCard: { padding: spacing.md, backgroundColor: '#FFF6E0', borderRadius: radius.md, borderWidth: 1, borderColor: '#F4C77E' },
  topPerformerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#FDECC7', borderRadius: radius.pill },
  topPerformerBadgeText: { fontSize: 9, fontWeight: '900', color: '#B8860B', letterSpacing: 0.5 },
  topPerformerName: { fontSize: 15, fontWeight: '800', color: colors.onSurface, marginTop: 6 },
  topPerformerRev: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },

  chartCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, ...shadows.card,
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  cardSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  chartArea: { flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.md, height: 170, gap: 4 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minWidth: 30 },
  chartBarVal: { fontSize: 9, color: colors.onSurfaceSecondary, fontWeight: '700', marginBottom: 2, height: 12 },
  chartBar: { width: '80%', borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 4 },
  chartXLabel: { fontSize: 9, color: colors.onSurfaceTertiary, marginTop: 4, maxWidth: 46 },

  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.onSurface, marginTop: spacing.sm },

  staffCard: {
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, gap: spacing.sm, ...shadows.card,
  },
  staffCardPaid: { borderColor: colors.success, borderWidth: 2, backgroundColor: '#F2FBF5' },
  staffHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rankBadge: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  rankBadgeText: { fontSize: 11, fontWeight: '900', color: colors.onSurfaceSecondary },
  staffName: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  staffMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  paidBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.success,
    borderRadius: radius.pill,
  },
  paidBadgeText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },

  staffNetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  staffNetLabel: { fontSize: 10, fontWeight: '700', color: colors.onSurfaceTertiary, letterSpacing: 0.5 },
  staffNetValue: { fontSize: 22, fontWeight: '900', color: colors.brandPrimary },
  deltaChip: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  deltaText: { fontSize: 11, fontWeight: '800' },

  statRow: { flexDirection: 'row', gap: spacing.sm },
  miniStat: { flex: 1, padding: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm },
  miniStatLabel: { fontSize: 9, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  miniStatValue: { fontSize: 13, fontWeight: '800', color: colors.onSurface, marginTop: 2 },
  miniStatSub: { fontSize: 9, fontWeight: '700', color: colors.warning, marginTop: 1 },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1 },
  actionBtnPay: { backgroundColor: colors.success, borderColor: colors.success },
  actionBtnUndo: { backgroundColor: '#FDECEC', borderColor: colors.error },
  actionBtnShare: { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  // Analytics table (horizontal scroll)
  analyticsCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, ...shadows.card,
  },
  analyticsHeadRow: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  analyticsHeadCell: {
    fontSize: 10, fontWeight: '800', color: colors.onSurfaceTertiary, textTransform: 'uppercase',
    letterSpacing: 0.4, paddingRight: 8,
  },
  analyticsRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  analyticsCell: { fontSize: 12, color: colors.onSurfaceSecondary, paddingRight: 8 },
  targetPill: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.pill },
  targetPillText: { fontSize: 11, fontWeight: '800' },
  scrollHint: { fontSize: 10, color: colors.onSurfaceTertiary, textAlign: 'center', marginTop: 4, fontStyle: 'italic' },

  emptyBox: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  emptyText: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  datePickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, gap: spacing.sm, ...(Platform.OS === 'web' ? { maxWidth: 480, alignSelf: 'center' as any, borderRadius: radius.lg } : {}) },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider, marginBottom: spacing.xs },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  sheetSub: { fontSize: 11, color: colors.onSurfaceSecondary, textAlign: 'center' },
  datePickerClose: { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  datePickerCloseText: { fontSize: 14, fontWeight: '700', color: colors.brandPrimary },

  // Export sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end', alignItems: 'center' } as any,
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    ...(Platform.OS === 'web' ? { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 } : {}),
    padding: spacing.lg, gap: spacing.sm, width: '100%', maxWidth: 480, alignSelf: 'center',
  } as any,
  sheetOpt: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sheetOptIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sheetOptLabel: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  sheetOptHint: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  sheetCancel: { paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  sheetCancelText: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
});
