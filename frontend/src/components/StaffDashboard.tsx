/**
 * Staff Dashboard — the home screen for staff-role users (owners/admins keep their
 * existing dashboard). All data is self-scoped (server resolves the beautician
 * from the logged-in user's email). A staff member only ever sees their own
 * schedule and earnings.
 *
 * Sections:
 *   1) Shift Control   — reuses /api/attendance/* with a live client-side timer
 *   2) Daily Schedule  — /api/me/schedule (today + upcoming)
 *   3) Performance     — /api/me/earnings (progress bar + financial cards)
 *   4) Quick Actions   — icon buttons gated by user.permissions
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { api } from '@/src/api/client';
import { useAuth, useBrand, PermissionKey } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';
import {
  type AttendanceAction, type AttendanceConfig, type MyTodayEntry,
  getFreshLocation, postAction, loadConfig, loadMyToday,
  parseTimestampMs, fmtLocalTime, fmtLocalDayTime,
} from '@/src/utils/attendance';

// Polling — keep mobile in sync when web toggles the shift or new appointments land.
const POLL_MS = 15_000;

// ---------- Types (self-scoped) ----------
type ScheduleAppt = {
  id: string;
  customer_name: string;
  customer_phone?: string;
  service_names?: string[];
  scheduled_start: string;
  duration_minutes?: number;
  price_estimate?: number;
  status?: string;
};
type MySchedule = {
  beautician_id: string | null;
  today: ScheduleAppt[];
  upcoming: ScheduleAppt[];
};
type MyEarnings = {
  linked: boolean;
  basic_salary: number;
  commission_pct: number;
  monthly_target: number;
  month_revenue: number;
  target_met: boolean;
  progress_pct: number;
  remaining_to_target: number;
  monthly_commission: number;
  advances: number;
  net_payable: number;
};

// ---------- Shade helpers for the hero gradient ----------
const hexToRgb = (h: string) => {
  const n = parseInt(h.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const shade = (h: string, f: number) => {
  const { r, g, b } = hexToRgb(h);
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `#${[c(r), c(g), c(b)].map(x => x.toString(16).padStart(2, '0')).join('')}`;
};

const fmtTime = (iso: string) => fmtLocalTime(iso);
const fmtDay = (iso: string) => fmtLocalDayTime(iso).split(' · ')[0]; // "Wed, Jun 4"

// ---------- Live shift-duration ticker ----------
// Duration = sum of segments between (check_in|break_end) → (check_out|break_start).
// If we're currently "in", tack on (now - lastOpenSegmentStart).
// Timestamps are UTC ISO from the backend — parsed via `parseTimestampMs` so
// microsecond precision doesn't blow up Hermes.
function computeShiftMs(logs: MyTodayEntry['logs'], nowMs: number): number {
  let total = 0;
  let openStart: number | null = null;
  for (const l of logs) {
    const t = parseTimestampMs(l.timestamp);
    if (t == null) continue;
    if (l.action === 'check_in' || l.action === 'break_end') {
      if (openStart == null) openStart = t;
    } else if (l.action === 'check_out' || l.action === 'break_start') {
      if (openStart != null) { total += t - openStart; openStart = null; }
    }
  }
  if (openStart != null) total += nowMs - openStart;
  return Math.max(0, total);
}
const formatDuration = (ms: number) => {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

// ---------- Main component ----------
export default function StaffDashboard() {
  const router = useRouter();
  const { user, tenant, logout, can } = useAuth();
  const { brandColor, brandTextColor } = useBrand();
  const brandDark = shade(brandColor, -0.35);
  const brandLight = shade(brandColor, 0.15);

  // ---- State ----
  const [config, setConfig] = useState<AttendanceConfig | null>(null);
  const [today, setToday] = useState<MyTodayEntry>({ status: 'out', logs: [] });
  const [schedule, setSchedule] = useState<MySchedule | null>(null);
  const [earnings, setEarnings] = useState<MyEarnings | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState<AttendanceAction | null>(null);

  // ---- Live ticker (only when checked in) ----
  const [nowMs, setNowMs] = useState(Date.now());
  const tickRef = useRef<any>(null);
  useEffect(() => {
    if (today.status === 'in') {
      tickRef.current = setInterval(() => setNowMs(Date.now()), 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
      setNowMs(Date.now()); // snap once more
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [today.status]);

  const shiftMs = useMemo(() => computeShiftMs(today.logs, nowMs), [today.logs, nowMs]);

  // ---- Loaders ----
  // `silent = true` → background refresh (poll or focus refetch) — shows a small
  // spinner in the header instead of the pull-to-refresh indicator.
  const load = useCallback(async (silent = false) => {
    if (silent) setPolling(true);
    const [c, t, s, e] = await Promise.all([
      loadConfig(),
      loadMyToday(),
      api<MySchedule>('/me/schedule').catch(() => null),
      api<MyEarnings>('/me/earnings').catch(() => null),
    ]);
    setConfig(c || {});
    setToday(t || { status: 'out', logs: [] });
    setSchedule(s);
    setEarnings(e);
    if (silent) setPolling(false);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  // Single combined focus effect: refetch on focus AND start a 15s poll while focused.
  // Two separate useFocusEffect calls made React Navigation flaky under Expo Go, so
  // we consolidate mount + interval + cleanup here.
  useFocusEffect(useCallback(() => {
    load(true);
    const id = setInterval(() => { load(true); }, POLL_MS);
    return () => { clearInterval(id); };
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Manual refresh button — force a fresh fetch on demand (helps when user just
  // toggled shift on web and doesn't want to wait for the next poll).
  const onManualRefresh = async () => {
    Haptics.selectionAsync();
    await load(true);
  };

  // Force sign out — clears the stored token so the user can re-login (useful if
  // the mobile is stuck on an older account that isn't linked to their beautician).
  const onSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You will be returned to the login screen and need to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => logout() },
      ],
    );
  };

  // ---- Attendance action handler ----
  const doAction = async (action: AttendanceAction) => {
    setBusy(action);
    try {
      const loc = await getFreshLocation();
      if (!loc && config?.gating_active) {
        Alert.alert('Location required', "Enable GPS so we can verify you're at the salon before punching.");
        return;
      }
      const res = await postAction(action, loc);
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await load();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Attendance', res.error || 'Failed to record attendance.');
      }
    } finally { setBusy(null); }
  };

  const status = today.status;
  const isIn = status === 'in';
  const onBreak = status === 'break';
  const isOut = status === 'out';

  // ---- Quick Action tiles (permission-gated) ----
  type QuickAction = { key: string; label: string; icon: any; route: string; color: string; perm: PermissionKey };
  const ALL_ACTIONS: QuickAction[] = [
    { key: 'new_bill',   label: 'New Bill',     icon: 'add-circle',   route: '/(tabs)/new-bill',   color: colors.brandPrimary, perm: 'new_bill' },
    { key: 'expenses',   label: 'Expenses',     icon: 'wallet',       route: '/(tabs)/expenses',   color: colors.warning,       perm: 'expenses' },
    { key: 'stock',      label: 'Stock',        icon: 'cube',         route: '/manage/stock',      color: colors.info,          perm: 'stock' },
    { key: 'cash',       label: 'Cash Closing', icon: 'cash',         route: '/manage/cash-closing', color: colors.success,     perm: 'cash_closing' },
    { key: 'members',    label: 'Members',      icon: 'people',       route: '/manage/members',    color: '#8B5CF6',            perm: 'members' },
  ];
  const actions = ALL_ACTIONS.filter(a => can(a.perm));

  // ---- Render ----
  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.root} testID="staff-dashboard">
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {/* Hero — greeting + live shift timer */}
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={[brandDark, brandColor, brandLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={['top']} style={styles.heroContent}>
            <View style={styles.heroTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.heroGreeting, { color: brandTextColor, opacity: 0.85 }]} numberOfLines={1}>
                  Hi, {user?.name?.split(' ')[0] || 'there'}
                </Text>
                <Text style={[styles.heroBrand, { color: brandTextColor }]} numberOfLines={1}>
                  {tenant?.business_name || 'ParlourPilot'}
                </Text>
              </View>
              <TouchableOpacity
                testID="manual-refresh-btn"
                onPress={onManualRefresh}
                style={styles.iconHeaderBtn}
                accessibilityLabel="Refresh"
              >
                {polling ? (
                  <ActivityIndicator size="small" color={brandTextColor} />
                ) : (
                  <Ionicons name="refresh" size={20} color={brandTextColor} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                testID="logout-btn"
                onPress={onSignOut}
                style={styles.iconHeaderBtn}
                accessibilityLabel="Sign out"
              >
                <Ionicons name="log-out-outline" size={20} color={brandTextColor} />
              </TouchableOpacity>
            </View>

            {/* Identity chip — mirrors exactly what the backend sees for this session.
                Lets the user compare with what the web app shows and spot a stale/other-user login. */}
            <View style={styles.identityChip} testID="identity-chip">
              <Ionicons name="person-circle-outline" size={14} color={brandTextColor} />
              <Text style={[styles.identityText, { color: brandTextColor }]} numberOfLines={1}>
                Signed in as {user?.email || user?.phone || '—'}
                {user?.email && user?.phone ? ` · ${user.phone}` : ''}
              </Text>
            </View>

            <View style={{ marginTop: spacing.xl }}>
              <View style={styles.statusRow}>
                <View style={[styles.dot, {
                  backgroundColor: isIn ? '#4ADE80' : onBreak ? '#FBBF24' : 'rgba(255,255,255,0.5)',
                }]} />
                <Text style={[styles.statusLabel, { color: brandTextColor }]}>
                  {isIn ? 'On the clock' : onBreak ? 'On break' : 'Checked out'}
                </Text>
                {polling && (
                  <View style={styles.refreshChip} testID="staff-polling">
                    <ActivityIndicator size="small" color={brandTextColor} />
                    <Text style={[styles.refreshChipText, { color: brandTextColor }]}>Syncing…</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.timerLabel, { color: brandTextColor, opacity: 0.8 }]}>Shift duration</Text>
              <Text style={[styles.timerValue, { color: brandTextColor }]} testID="shift-timer">
                {formatDuration(shiftMs)}
              </Text>
              {config?.branch_name && (
                <View style={styles.branchChip}>
                  <Ionicons name="business-outline" size={11} color={brandTextColor} />
                  <Text style={[styles.branchChipText, { color: brandTextColor }]} numberOfLines={1}>
                    {config.branch_name}
                    {config.gating_active ? ` · Geofence ${config.check_in_radius_m}m` : ' · Geofence off'}
                  </Text>
                </View>
              )}
            </View>
          </SafeAreaView>
        </View>

        {/* Section 1 — Shift Control buttons */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Shift Control</Text>
          <View style={styles.controlRow}>
            <ShiftButton
              label={isIn || onBreak ? 'Check In' : 'Check In'}
              icon="log-in-outline"
              color={colors.success}
              disabled={busy != null || isIn || onBreak}
              busy={busy === 'check_in'}
              onPress={() => doAction('check_in')}
              testID="btn-check-in"
              primary
            />
            {onBreak ? (
              <ShiftButton
                label="End Break"
                icon="play-outline"
                color={colors.info}
                disabled={busy != null}
                busy={busy === 'break_end'}
                onPress={() => doAction('break_end')}
                testID="btn-break-end"
              />
            ) : (
              <ShiftButton
                label="Break"
                icon="pause-outline"
                color={colors.warning}
                disabled={busy != null || !isIn}
                busy={busy === 'break_start'}
                onPress={() => doAction('break_start')}
                testID="btn-break-start"
              />
            )}
            <ShiftButton
              label="Check Out"
              icon="log-out-outline"
              color={colors.error}
              disabled={busy != null || (!isIn && !onBreak)}
              busy={busy === 'check_out'}
              onPress={() => doAction('check_out')}
              testID="btn-check-out"
            />
          </View>
          {config?.gating_active === false && (
            <Text style={styles.subtleNote}>Geofence is disabled — check-ins won&apos;t be gated.</Text>
          )}
          {isOut && today.logs.length === 0 && (
            <Text style={styles.subtleNote}>Tap Check In when you arrive to start your shift.</Text>
          )}
        </View>

        {/* Section 2 — Daily Schedule */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today&apos;s Schedule</Text>
            {(schedule?.today.length || 0) > 0 && (
              <Text style={styles.sectionCount}>{schedule!.today.length} appt</Text>
            )}
          </View>

          {/* Always render this section — mirrors the web app, which shows the
              schedule for every staff regardless of whether a beautician doc
              is linked. If nothing came back or nothing scheduled → empty state. */}
          {(schedule?.today.length || 0) === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="calendar-outline" size={28} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No appointments today. Enjoy the quiet!</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {schedule!.today.map(a => <ScheduleRow key={a.id} appt={a} />)}
            </View>
          )}

          {(schedule?.upcoming?.length || 0) > 0 && (
            <>
              <View style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
                <Text style={styles.subSectionTitle}>Upcoming</Text>
                <Text style={styles.sectionCount}>{schedule!.upcoming.length}</Text>
              </View>
              <View style={{ gap: spacing.sm }}>
                {schedule!.upcoming.slice(0, 6).map(a => <ScheduleRow key={a.id} appt={a} showDay />)}
              </View>
            </>
          )}
        </View>

        {/* Section 3 — Performance & Target */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Performance</Text>

          {/* Always render — even without a beautician link, we show ₹0/₹0 with a
              neutral "no target set" note. Matches the web app's behavior. */}
          {(() => {
            const e = earnings || {
              linked: false,
              basic_salary: 0,
              commission_pct: 0,
              monthly_target: 0,
              month_revenue: 0,
              target_met: true,
              progress_pct: 100,
              remaining_to_target: 0,
              monthly_commission: 0,
              advances: 0,
              net_payable: 0,
            } as MyEarnings;
            return (
              <>
                {/* Progress card */}
                <View style={styles.progressCard}>
                  <View style={styles.progressHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.progressLabel}>This month&apos;s revenue</Text>
                      <Text style={styles.progressValue} testID="month-revenue">
                        {fmtINR(e.month_revenue)}
                        {e.monthly_target > 0 && (
                          <Text style={styles.progressTargetSub}> / {fmtINR(e.monthly_target)}</Text>
                        )}
                      </Text>
                    </View>
                    {e.monthly_target > 0 && (
                      <View style={[styles.progressPctChip, { backgroundColor: e.target_met ? '#DDF3E4' : colors.brandTertiary }]}>
                        <Text style={[styles.progressPctText, { color: e.target_met ? colors.success : colors.brandPrimary }]}>
                          {Math.min(100, Math.round(e.progress_pct))}%
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(100, Math.max(0, e.progress_pct))}%` as any,
                          backgroundColor: e.target_met ? colors.success : colors.brandPrimary,
                        },
                      ]}
                      testID="progress-fill"
                    />
                  </View>
                  {e.monthly_target === 0 ? (
                    <Text style={styles.progressNote} testID="target-msg">
                      No monthly target set — every sale earns commission.
                    </Text>
                  ) : e.target_met ? (
                    <Text style={[styles.progressNote, { color: colors.success, fontWeight: '700' }]} testID="target-msg">
                      🎉 Target achieved! Commissions are now active.
                    </Text>
                  ) : (
                    <Text style={styles.progressNote} testID="target-msg">
                      {fmtINR(e.remaining_to_target)} more to reach your target!
                    </Text>
                  )}
                </View>

                {/* Financial cards — always visible with 0 defaults. */}
                <View style={styles.finGrid}>
                  <FinancialCard label="Basic Salary" value={fmtINR(e.basic_salary)} icon="briefcase-outline" color={colors.info} testID="fin-basic" />
                  <FinancialCard
                    label="Monthly Commission"
                    value={fmtINR(e.monthly_commission)}
                    icon="trending-up-outline"
                    color={colors.success}
                    hint={e.monthly_target === 0
                      ? `${e.commission_pct || 0}% on every sale`
                      : e.target_met ? `${e.commission_pct}% of overage` : 'Unlocks at target'}
                    testID="fin-commission"
                  />
                  <FinancialCard label="Advances Taken" value={fmtINR(e.advances)} icon="arrow-down-circle-outline" color={colors.error} testID="fin-advances" />
                  <FinancialCard label="Net Payable" value={fmtINR(e.net_payable)} icon="wallet-outline" color={colors.brandPrimary} highlight testID="fin-net" />
                </View>
                <Text style={styles.finFormula}>Net Payable = Basic Salary + Monthly Commission − Advances</Text>
              </>
            );
          })()}
        </View>

        {/* Section 4 — Quick Actions grid */}
        {actions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.actionsGrid}>
              {actions.map(a => (
                <TouchableOpacity
                  key={a.key}
                  testID={`quick-${a.key}`}
                  style={styles.actionTile}
                  onPress={() => router.push(a.route as any)}
                  activeOpacity={0.85}
                >
                  <View style={[styles.actionIcon, { backgroundColor: colors.brandTertiary }]}>
                    <Ionicons name={a.icon as any} size={26} color={a.color} />
                  </View>
                  <Text style={styles.actionLabel}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ---------- Sub-components ----------
function ShiftButton({
  label, icon, color, disabled, busy, onPress, testID, primary,
}: {
  label: string; icon: any; color: string;
  disabled?: boolean; busy?: boolean; onPress: () => void; testID?: string; primary?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.shiftBtn,
        { borderColor: color, opacity: disabled ? 0.45 : 1 },
        primary && { backgroundColor: color },
      ]}
      testID={testID}
      activeOpacity={0.85}
    >
      {busy ? (
        <ActivityIndicator color={primary ? '#fff' : color} />
      ) : (
        <Ionicons name={icon} size={22} color={primary ? '#fff' : color} />
      )}
      <Text style={[styles.shiftBtnLabel, { color: primary ? '#fff' : color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ScheduleRow({ appt, showDay }: { appt: ScheduleAppt; showDay?: boolean }) {
  const time = fmtTime(appt.scheduled_start);
  const day = showDay ? fmtDay(appt.scheduled_start) : null;
  const services = (appt.service_names || []).join(', ') || 'Service';
  return (
    <View style={styles.scheduleRow} testID={`schedule-row-${appt.id}`}>
      <View style={styles.scheduleTimeCol}>
        {day && <Text style={styles.scheduleDay}>{day}</Text>}
        <Text style={styles.scheduleTime}>{time}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.scheduleName} numberOfLines={1}>{appt.customer_name || 'Guest'}</Text>
        <Text style={styles.scheduleServices} numberOfLines={1}>{services}</Text>
      </View>
      {typeof appt.price_estimate === 'number' && appt.price_estimate > 0 && (
        <Text style={styles.schedulePrice}>{fmtINR(appt.price_estimate)}</Text>
      )}
    </View>
  );
}

function FinancialCard({
  label, value, icon, color, hint, highlight, testID,
}: {
  label: string; value: string; icon: any; color: string;
  hint?: string; highlight?: boolean; testID?: string;
}) {
  return (
    <View style={[styles.finCard, highlight && styles.finCardHighlight]} testID={testID}>
      <View style={[styles.finIcon, { backgroundColor: highlight ? 'rgba(255,255,255,0.15)' : colors.brandTertiary }]}>
        <Ionicons name={icon} size={18} color={highlight ? '#fff' : color} />
      </View>
      <Text style={[styles.finLabel, highlight && { color: 'rgba(255,255,255,0.85)' }]}>{label}</Text>
      <Text style={[styles.finValue, highlight && { color: '#fff' }]}>{value}</Text>
      {hint && <Text style={[styles.finHint, highlight && { color: 'rgba(255,255,255,0.7)' }]}>{hint}</Text>}
    </View>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },

  // Hero
  heroWrap: { minHeight: 240, overflow: 'hidden', position: 'relative' },
  heroContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.md, gap: spacing.sm },
  heroGreeting: { fontSize: 13, fontWeight: '600' },
  heroBrand: { fontSize: 20, fontWeight: '900', letterSpacing: 0.3, marginTop: 2 },
  iconHeaderBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  logoutBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  identityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm, alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    maxWidth: '95%',
  },
  identityText: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 13, fontWeight: '700' },
  refreshChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginLeft: spacing.sm,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  refreshChipText: { fontSize: 10, fontWeight: '700' },
  timerLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: spacing.md, textTransform: 'uppercase' },
  timerValue: { fontSize: 44, fontWeight: '900', marginTop: 2, fontVariant: ['tabular-nums'] as any },
  branchChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm, alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    maxWidth: 260,
  },
  branchChipText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },

  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.md },
  subSectionTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurfaceSecondary },
  sectionCount: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary, backgroundColor: colors.brandTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  subtleNote: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: spacing.sm },

  // Shift buttons
  controlRow: { flexDirection: 'row', gap: spacing.sm },
  shiftBtn: {
    flex: 1, minHeight: 76, borderWidth: 2, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.md, backgroundColor: colors.surface, ...shadows.card,
  },
  shiftBtnLabel: { fontSize: 12, fontWeight: '800' },

  // Schedule rows
  scheduleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  scheduleTimeCol: {
    minWidth: 70, paddingRight: spacing.md, borderRightWidth: 1, borderRightColor: colors.divider,
    alignItems: 'flex-start',
  },
  scheduleDay: { fontSize: 10, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  scheduleTime: { fontSize: 13, fontWeight: '800', color: colors.brandPrimary, marginTop: 2 },
  scheduleName: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  scheduleServices: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  schedulePrice: { fontSize: 13, fontWeight: '800', color: colors.success },

  emptyBox: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  emptyText: { fontSize: 13, color: colors.onSurfaceTertiary },
  finFormula: { fontSize: 10, color: colors.onSurfaceTertiary, marginTop: spacing.sm, textAlign: 'center', fontStyle: 'italic' },
  notLinkedBox: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.md, backgroundColor: '#FDF3E4', borderRadius: radius.md, borderWidth: 1, borderColor: '#F0DCA6' },
  notLinkedTitle: { fontSize: 14, fontWeight: '700', color: colors.warning },
  notLinkedSub: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },

  // Progress card
  progressCard: { backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  progressLabel: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  progressValue: { fontSize: 22, fontWeight: '900', color: colors.onSurface, marginTop: 2 },
  progressTargetSub: { fontSize: 14, fontWeight: '600', color: colors.onSurfaceTertiary },
  progressPctChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  progressPctText: { fontSize: 13, fontWeight: '900' },
  progressBarBg: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceTertiary, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 5 },
  progressNote: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: spacing.md, textAlign: 'center' },

  // Financial grid
  finGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  finCard: {
    width: '47%', backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, gap: 4, ...shadows.card,
  },
  finCardHighlight: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  finIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  finLabel: { fontSize: 11, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  finValue: { fontSize: 20, fontWeight: '900', color: colors.onSurface },
  finHint: { fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 2 },

  // Actions grid
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  actionTile: {
    width: '47%', backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.md, ...shadows.card,
  },
  actionIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
});
