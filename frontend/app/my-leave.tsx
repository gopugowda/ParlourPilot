/**
 * My Leave — Staff self-service HR screen (Phase 1C).
 *
 * All logic is derived from the JWT on the backend — this client NEVER sends
 * beautician_id / employee_id / branch_id / tenant_id in any request body.
 *
 * The screen has 4 tabs powered by a segmented control:
 *   • Overview  — Balances (paid vs unpaid) + a "Request leave" CTA
 *   • Requests  — My pending / approved requests + inline cancel
 *   • History   — Read-only past requests (all statuses)
 *   • Calendar  — Monthly view driven by /calendar?month=YYYY-MM
 *
 * The "Request leave" form is a bottom-sheet modal that uses the shared
 * `react-native-calendars` Calendar for range picking (same as
 * appointments / cash-closing / expenses).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, Modal, Pressable, Platform, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Calendar } from 'react-native-calendars';

import {
  hrSelfServiceApi, type LeaveBalance, type LeaveType, type LeaveRequest,
  type CalendarDay, type LeaveDayPart, daysBetween, computeDays,
} from '@/src/api/hr';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

// ---- Constants ------------------------------------------------------------

type Tab = 'overview' | 'requests' | 'history' | 'calendar';

const STATUS_COLOR: Record<string, { bg: string; fg: string; label: string }> = {
  pending:   { bg: '#FFF6E0', fg: '#B8860B',        label: 'Pending' },
  approved:  { bg: '#DDF3E4', fg: colors.success,   label: 'Approved' },
  rejected:  { bg: '#FDECEC', fg: colors.error,     label: 'Rejected' },
  cancelled: { bg: '#EEE',    fg: colors.onSurfaceTertiary, label: 'Cancelled' },
};

const CAL_STATUS: Record<string, { color: string; label: string }> = {
  present:            { color: colors.success,           label: 'Present' },
  paid_leave:         { color: colors.brandPrimary,      label: 'Paid Leave' },
  unpaid_leave:       { color: colors.error,             label: 'Unpaid Leave' },
  half_day:           { color: '#B8860B',                label: 'Half Day' },
  public_holiday:     { color: '#3F6C9C',                label: 'Public Holiday' },
  restricted_holiday: { color: '#8A5CB8',                label: 'Restricted Holiday' },
  weekly_off:         { color: colors.onSurfaceTertiary, label: 'Weekly Off' },
};

const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
const ym = (d = new Date()) => d.toISOString().slice(0, 7);

// ---- Screen ---------------------------------------------------------------

export default function MyLeaveScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [tab, setTab] = useState<Tab>('overview');

  // Bootstrap error — no linked staff profile (404 on /me).
  const [profileError, setProfileError] = useState<string | null>(null);

  // Data buckets
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [history, setHistory] = useState<LeaveRequest[]>([]);
  const [calMonth, setCalMonth] = useState<string>(ym());
  const [calDays, setCalDays] = useState<CalendarDay[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  // ---- Loaders --------------------------------------------------------
  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // /me is the identity probe; a 404 here means "your login isn't linked to a staff record".
      try { await hrSelfServiceApi.me(); setProfileError(null); }
      catch (e: any) {
        if (e?.status === 404) {
          setProfileError("Your login isn't linked to a staff record yet — please ask your salon owner.");
          setLoading(false);
          return;
        }
      }

      const [types, bals, reqs, hist, cal] = await Promise.all([
        hrSelfServiceApi.leaveTypes().catch(() => [] as LeaveType[]),
        hrSelfServiceApi.leaveBalances().catch(() => ({ balances: [] } as any)),
        hrSelfServiceApi.leaveRequests().catch(() => ({ rows: [] } as any)),
        hrSelfServiceApi.leaveHistory().catch(() => ({ rows: [] } as any)),
        hrSelfServiceApi.calendar(calMonth).catch(() => ({ days: [] } as any)),
      ]);
      setLeaveTypes(types);
      setBalances(bals.balances || []);
      setRequests(reqs.rows || []);
      setHistory(hist.rows || []);
      setCalDays(cal.days || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [calMonth]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useFocusEffect(useCallback(() => { loadAll(true); }, [loadAll]));

  const onRefresh = async () => { setRefreshing(true); await loadAll(true); setRefreshing(false); };

  const reloadAfterMutation = async () => {
    // After create/cancel we refresh balances + both request lists + calendar.
    await loadAll(true);
  };

  const openRequestForm = () => { Haptics.selectionAsync(); setRequestFormOpen(true); };

  const confirmCancel = (req: LeaveRequest) => {
    Haptics.selectionAsync();
    Alert.alert(
      'Cancel leave request?',
      `${req.leave_type_name} · ${req.from_date}${req.from_date !== req.to_date ? ` → ${req.to_date}` : ''} · ${req.days} day${req.days === 1 ? '' : 's'}`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel leave', style: 'destructive', onPress: () => doCancel(req) },
      ],
    );
  };

  const doCancel = async (req: LeaveRequest) => {
    setCancelling(req.id);
    try {
      await hrSelfServiceApi.cancelLeaveRequest(req.id, '');
      await reloadAfterMutation();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Cancel failed', e?.message || 'Could not cancel this leave.');
    } finally {
      setCancelling(null);
    }
  };

  // ---- Derived -------------------------------------------------------
  const legendItems = useMemo(() => Object.entries(CAL_STATUS), []);

  // Build react-native-calendars markedDates from /calendar days.
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    calDays.forEach(d => {
      const dot = d.status ? { color: CAL_STATUS[d.status]?.color || colors.brandPrimary } : null;
      if (dot) marks[d.date] = { marked: true, dotColor: dot.color, customStyles: {
        container: { backgroundColor: dot.color + '20' },
        text: { color: dot.color, fontWeight: '700' },
      }};
      if (!dot && d.pending_leave) marks[d.date] = { marked: true, dotColor: '#B8860B', customStyles: {
        container: { backgroundColor: '#FFF6E020' },
        text: { color: '#B8860B', fontWeight: '700' },
      }};
    });
    return marks;
  }, [calDays]);

  // ---- Render --------------------------------------------------------
  if (profileError) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Leave</Text>
        </SafeAreaView>
        <View style={styles.emptyBox}>
          <Ionicons name="person-remove-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyText}>{profileError}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="my-leave-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Leave</Text>
          <Text style={styles.headerSub}>{user?.name || ''}</Text>
        </View>
        <TouchableOpacity
          testID="request-leave-btn"
          onPress={openRequestForm}
          style={styles.newBtn}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.newBtnText}>Request</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {(['overview', 'requests', 'history', 'calendar'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            testID={`tab-${t}`}
            onPress={() => { Haptics.selectionAsync(); setTab(t); }}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'overview' ? 'Balances' : t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
            {tab === 'requests' && requests.length > 0 && t === 'requests' && (
              <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{requests.length}</Text></View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
        >
          {tab === 'overview' && (
            <>
              <Text style={styles.sectionTitle}>Balances ({new Date().getFullYear()})</Text>
              {balances.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="calendar-outline" size={30} color={colors.onSurfaceTertiary} />
                  <Text style={styles.emptyText}>No leave types configured yet.</Text>
                </View>
              ) : balances.map(b => <BalanceCard key={b.leave_type_id} b={b} />)}

              <TouchableOpacity
                onPress={openRequestForm}
                testID="cta-request-leave"
                style={styles.ctaCard}
              >
                <View style={styles.ctaIcon}><Ionicons name="add-circle-outline" size={22} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ctaTitle}>Request time off</Text>
                  <Text style={styles.ctaHint}>Casual, sick, or unpaid — pick the type and dates</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#fff" />
              </TouchableOpacity>
            </>
          )}

          {tab === 'requests' && (
            <>
              <Text style={styles.sectionTitle}>Active requests</Text>
              {requests.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="checkmark-done-outline" size={30} color={colors.onSurfaceTertiary} />
                  <Text style={styles.emptyText}>Nothing pending. Tap “Request” to submit a new leave.</Text>
                </View>
              ) : requests.map(r => (
                <RequestCard
                  key={r.id}
                  r={r}
                  cancelling={cancelling === r.id}
                  onCancel={() => confirmCancel(r)}
                />
              ))}
            </>
          )}

          {tab === 'history' && (
            <>
              <Text style={styles.sectionTitle}>Leave history ({new Date().getFullYear()})</Text>
              {history.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="time-outline" size={30} color={colors.onSurfaceTertiary} />
                  <Text style={styles.emptyText}>No leave activity yet.</Text>
                </View>
              ) : history.map(r => <RequestCard key={r.id} r={r} readonly />)}
            </>
          )}

          {tab === 'calendar' && (
            <>
              <Text style={styles.sectionTitle}>My calendar</Text>
              <View style={styles.calWrap}>
                <Calendar
                  current={calMonth + '-15'}
                  markingType="custom"
                  markedDates={markedDates}
                  onMonthChange={(m: any) => { setCalMonth(m.dateString.slice(0, 7)); }}
                  theme={{
                    calendarBackground: colors.surface,
                    todayTextColor: colors.brandPrimary,
                    arrowColor: colors.brandPrimary,
                    textSectionTitleColor: colors.onSurfaceSecondary,
                  }}
                />
              </View>
              <View style={styles.legendRow}>
                {legendItems.map(([key, cfg]) => (
                  <View key={key} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: cfg.color }]} />
                    <Text style={styles.legendText}>{cfg.label}</Text>
                  </View>
                ))}
              </View>
              {/* Day details for the visible month */}
              {calDays.filter(d => d.status || d.pending_leave || d.holiday_name).map(d => (
                <View key={d.date} style={styles.calDetailRow}>
                  <Text style={styles.calDate}>{d.date}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calDetailLabel}>
                      {d.status ? (CAL_STATUS[d.status]?.label || d.status) : d.pending_leave ? `Pending${d.pending_leave.leave_type_code ? ` (${d.pending_leave.leave_type_code})` : ''}` : d.holiday_name}
                    </Text>
                    {d.holiday_name && d.status !== null && (
                      <Text style={styles.calDetailSub}>{d.holiday_name}</Text>
                    )}
                    {d.leave_type_code && (
                      <Text style={styles.calDetailSub}>Leave code: {d.leave_type_code}</Text>
                    )}
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* Request form modal */}
      <RequestForm
        visible={requestFormOpen}
        onClose={() => setRequestFormOpen(false)}
        leaveTypes={leaveTypes}
        onSubmitted={async (result) => {
          setRequestFormOpen(false);
          await reloadAfterMutation();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            result.status === 'approved' ? 'Leave approved ✅' : 'Request submitted 📤',
            result.status === 'approved'
              ? `${result.leave_type_name} · ${result.from_date}${result.from_date !== result.to_date ? ` → ${result.to_date}` : ''} · ${result.days} day${result.days === 1 ? '' : 's'} — auto-approved.`
              : `${result.leave_type_name} for ${result.days} day${result.days === 1 ? '' : 's'} sent for approval.`
          );
          // Nudge tab to requests so the user sees the new entry.
          setTab('requests');
        }}
      />
    </View>
  );
}

// ---- Sub-components -------------------------------------------------------

function BalanceCard({ b }: { b: LeaveBalance }) {
  const paidPill = b.paid
    ? <View style={[styles.pill, { backgroundColor: '#DDF3E4' }]}><Text style={[styles.pillText, { color: colors.success }]}>PAID</Text></View>
    : <View style={[styles.pill, { backgroundColor: '#FDECEC' }]}><Text style={[styles.pillText, { color: colors.error }]}>UNPAID</Text></View>;
  const isAccrual = !!b.monthly_accrual;
  return (
    <View style={styles.balCard} testID={`bal-${b.code}`}>
      <View style={styles.balHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.balName}>{b.leave_type_name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.balCode}>{b.code}</Text>
            {isAccrual && (
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.brandPrimary + '22' }}>
                <Text style={{ fontSize: 9, fontWeight: '800', color: colors.brandPrimary }}>
                  {Number(b.monthly_accrual_amount ?? 0).toFixed(2)}/mo
                </Text>
              </View>
            )}
          </View>
        </View>
        {paidPill}
      </View>
      <View style={styles.balStats}>
        {isAccrual ? (
          <>
            <BalStat label="Annual" value={b.entitled} />
            <BalStat label="Accrued" value={Number(b.accrued ?? 0)} />
            <BalStat label="Used" value={b.used} />
            <BalStat label="Available" value={b.available} highlight />
          </>
        ) : (
          <>
            <BalStat label="Entitled" value={b.entitled} />
            <BalStat label="Used" value={b.used} />
            <BalStat label="Pending" value={b.pending} warn={b.pending > 0} />
            <BalStat label="Available" value={b.available} highlight />
          </>
        )}
      </View>
    </View>
  );
}

function BalStat({ label, value, highlight, warn }: { label: string; value: number; highlight?: boolean; warn?: boolean }) {
  const num = Number(value ?? 0);
  const v = Number.isInteger(num) ? String(num) : num.toFixed(2);
  return (
    <View style={styles.balStat}>
      <Text style={styles.balStatLabel}>{label}</Text>
      <Text style={[
        styles.balStatValue,
        highlight && { color: colors.brandPrimary },
        warn && { color: '#B8860B' },
      ]}>{v}</Text>
    </View>
  );
}

function RequestCard({ r, cancelling, onCancel, readonly }: { r: LeaveRequest; cancelling?: boolean; onCancel?: () => void; readonly?: boolean }) {
  const sev = STATUS_COLOR[r.status] || STATUS_COLOR.pending;
  const canCancel = !readonly && (r.status === 'pending' || r.status === 'approved');
  return (
    <View style={styles.reqCard} testID={`req-${r.id}`}>
      <View style={styles.reqHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.reqTitle}>{r.leave_type_name} <Text style={styles.reqCode}>({r.leave_type_code})</Text></Text>
          <Text style={styles.reqDates}>
            {r.from_date}{r.from_date !== r.to_date ? ` → ${r.to_date}` : ''} · {r.days} day{r.days === 1 ? '' : 's'}
            {r.day_part !== 'full' ? ` · ${r.day_part === 'first_half' ? 'First half' : 'Second half'}` : ''}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: sev.bg }]}>
          <Text style={[styles.pillText, { color: sev.fg }]}>{sev.label.toUpperCase()}</Text>
        </View>
      </View>
      <View style={styles.reqMetaRow}>
        <View style={[styles.pill, { backgroundColor: r.paid ? '#E3EDF7' : '#FDECEC' }]}>
          <Text style={[styles.pillText, { color: r.paid ? '#3F6C9C' : colors.error }]}>{r.paid ? 'PAID' : 'UNPAID'}</Text>
        </View>
        {r.submitted_at && <Text style={styles.reqMeta}>Submitted {fmtDateShort(r.submitted_at)}</Text>}
      </View>
      {r.reason ? <Text style={styles.reqReason} numberOfLines={3}>Reason: {r.reason}</Text> : null}
      {r.decision_note ? <Text style={styles.reqReason} numberOfLines={2}>Note: {r.decision_note}</Text> : null}
      {r.decided_by_name && (r.status === 'approved' || r.status === 'rejected') && (
        <Text style={styles.reqMeta}>
          {r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.decided_by_name}{r.decided_at ? ` · ${fmtDateShort(r.decided_at)}` : ''}
        </Text>
      )}
      {canCancel && (
        <TouchableOpacity
          testID={`cancel-${r.id}`}
          onPress={onCancel}
          disabled={cancelling}
          style={styles.cancelBtn}
        >
          {cancelling ? <ActivityIndicator size="small" color={colors.error} /> : (
            <>
              <Ionicons name="close-circle-outline" size={16} color={colors.error} />
              <Text style={styles.cancelBtnText}>Cancel request</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---- Request form modal ---------------------------------------------------

function RequestForm({ visible, onClose, leaveTypes, onSubmitted }: {
  visible: boolean;
  onClose: () => void;
  leaveTypes: LeaveType[];
  onSubmitted: (r: LeaveRequest) => void;
}) {
  const [typeId, setTypeId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>(ymd());
  const [toDate, setToDate] = useState<string>(ymd());
  const [dayPart, setDayPart] = useState<LeaveDayPart>('full');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStep, setPickerStep] = useState<'from' | 'to'>('from');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedType = leaveTypes.find(t => t.id === typeId);
  const halfDayAllowed = !!selectedType?.allow_half_day && fromDate === toDate;

  useEffect(() => {
    if (visible) {
      setTypeId(leaveTypes[0]?.id || '');
      setFromDate(ymd()); setToDate(ymd()); setDayPart('full');
      setReason(''); setNote(''); setErr(null);
    }
  }, [visible, leaveTypes]);

  // Reset day-part to full if it becomes invalid (range > 1 day or type disallows).
  useEffect(() => {
    if (!halfDayAllowed && dayPart !== 'full') setDayPart('full');
  }, [halfDayAllowed, dayPart]);

  const previewDays = computeDays(fromDate, toDate, dayPart);

  const openPicker = (step: 'from' | 'to') => { Haptics.selectionAsync(); setPickerStep(step); setPickerOpen(true); };
  const onDayPress = (d: { dateString: string }) => {
    Haptics.selectionAsync();
    if (pickerStep === 'from') {
      setFromDate(d.dateString);
      // Auto-bump to-date if from > to
      if (d.dateString > toDate) setToDate(d.dateString);
      setPickerStep('to');
      return;
    }
    if (d.dateString < fromDate) { setFromDate(d.dateString); setPickerStep('to'); return; }
    setToDate(d.dateString);
    setPickerOpen(false);
  };

  const submit = async () => {
    setErr(null);
    if (!typeId) { setErr('Pick a leave type.'); return; }
    if (!fromDate || !toDate) { setErr('Pick both dates.'); return; }
    if (daysBetween(fromDate, toDate) === 0) { setErr('Invalid date range.'); return; }
    setSubmitting(true);
    try {
      const res = await hrSelfServiceApi.createLeaveRequest({
        leave_type_id: typeId,
        from_date: fromDate,
        to_date: toDate,
        day_part: dayPart,
        reason: reason.trim(),
        note: note.trim(),
      });
      onSubmitted(res);
    } catch (e: any) {
      setErr(e?.message || 'Could not submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Request leave</Text>

          <ScrollView contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Type */}
            <Text style={styles.fieldLabel}>Leave type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {leaveTypes.map(t => (
                <TouchableOpacity
                  key={t.id}
                  testID={`type-${t.code}`}
                  onPress={() => { Haptics.selectionAsync(); setTypeId(t.id); }}
                  style={[styles.chip, typeId === t.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, typeId === t.id && styles.chipTextActive]}>
                    {t.name} ({t.code})
                  </Text>
                  {!t.requires_approval && (
                    <View style={styles.autoApprovePill}><Text style={styles.autoApproveText}>AUTO</Text></View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Dates */}
            <View style={styles.dateRow}>
              <TouchableOpacity testID="from-date" style={styles.dateInput} onPress={() => openPicker('from')}>
                <Ionicons name="calendar-outline" size={14} color={colors.brandPrimary} />
                <View style={{ marginLeft: 6 }}>
                  <Text style={styles.dateLabel}>From</Text>
                  <Text style={styles.dateValue}>{fromDate}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity testID="to-date" style={styles.dateInput} onPress={() => openPicker('to')}>
                <Ionicons name="calendar-outline" size={14} color={colors.brandPrimary} />
                <View style={{ marginLeft: 6 }}>
                  <Text style={styles.dateLabel}>To</Text>
                  <Text style={styles.dateValue}>{toDate}</Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Day part */}
            <Text style={styles.fieldLabel}>Day part</Text>
            <View style={styles.chipsRow}>
              {(['full', 'first_half', 'second_half'] as LeaveDayPart[]).map(p => {
                const disabled = p !== 'full' && !halfDayAllowed;
                return (
                  <TouchableOpacity
                    key={p}
                    testID={`part-${p}`}
                    onPress={() => { if (disabled) return; Haptics.selectionAsync(); setDayPart(p); }}
                    style={[
                      styles.chip,
                      dayPart === p && styles.chipActive,
                      disabled && { opacity: 0.4 },
                    ]}
                    disabled={disabled}
                  >
                    <Text style={[styles.chipText, dayPart === p && styles.chipTextActive]}>
                      {p === 'full' ? 'Full day' : p === 'first_half' ? 'First half' : 'Second half'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!halfDayAllowed && (
              <Text style={styles.hint}>Half-day is available only when From = To and the leave type allows it.</Text>
            )}

            {/* Reason + note */}
            <Text style={styles.fieldLabel}>Reason</Text>
            <TextInput
              testID="reason-input"
              value={reason}
              onChangeText={setReason}
              placeholder="Short reason (optional)"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
              multiline
            />
            <Text style={styles.fieldLabel}>Note (optional)</Text>
            <TextInput
              testID="note-input"
              value={note}
              onChangeText={setNote}
              placeholder="Anything else to add"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={[styles.input, { minHeight: 60 }]}
              multiline
            />

            {/* Live preview */}
            <View style={styles.previewCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewLabel}>Total</Text>
                <Text style={styles.previewValue}>
                  {previewDays === 0.5 ? '0.5 day' : `${previewDays} day${previewDays === 1 ? '' : 's'}`}
                </Text>
              </View>
              {selectedType && (
                <View>
                  <Text style={styles.previewLabel}>Approval</Text>
                  <Text style={styles.previewValue}>{selectedType.requires_approval ? 'Required' : 'Automatic'}</Text>
                </View>
              )}
            </View>

            {err && (
              <View style={styles.errBox} testID="submit-error">
                <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
                <Text style={styles.errText}>{err}</Text>
              </View>
            )}

            <TouchableOpacity
              testID="submit-request"
              onPress={submit}
              disabled={submitting || !typeId}
              style={[styles.submitBtn, (submitting || !typeId) && { opacity: 0.6 }]}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="paper-plane" size={16} color="#fff" />
                  <Text style={styles.submitBtnText}>Submit request</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>

          {/* Date picker sub-modal */}
          <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
            <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
              <Pressable style={styles.datePickerSheet} onPress={() => {}}>
                <View style={styles.handle} />
                <Text style={styles.sheetTitle}>{pickerStep === 'from' ? 'Pick FROM date' : 'Pick TO date'}</Text>
                <Text style={styles.hint}>From: {fromDate} · To: {toDate}</Text>
                <Calendar
                  onDayPress={onDayPress}
                  markedDates={{
                    [fromDate]: { startingDay: true, color: colors.brandPrimary, textColor: '#fff' },
                    [toDate]: { endingDay: true, color: colors.brandPrimary, textColor: '#fff' },
                  }}
                  markingType="period"
                  theme={{
                    calendarBackground: colors.surface,
                    selectedDayBackgroundColor: colors.brandPrimary,
                    todayTextColor: colors.brandPrimary,
                    arrowColor: colors.brandPrimary,
                  }}
                />
                <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ alignSelf: 'center', padding: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.brandPrimary }}>Done</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---- Utils ---------------------------------------------------------------

function fmtDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

// ---- Styles --------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  newBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },

  tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandSecondary, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  tabTextActive: { color: '#fff' },
  tabBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { fontSize: 10, fontWeight: '900', color: colors.brandPrimary },

  loadingBox: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: colors.onSurfaceTertiary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 },

  // Balance card
  balCard: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadows.card },
  balHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balName: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  balCode: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2, letterSpacing: 0.5 },
  balStats: { flexDirection: 'row', gap: 6 },
  balStat: { flex: 1, padding: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, alignItems: 'center' },
  balStatLabel: { fontSize: 9, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  balStatValue: { fontSize: 16, fontWeight: '900', color: colors.onSurface, marginTop: 2 },

  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  ctaCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary, ...shadows.card },
  ctaIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { fontSize: 15, fontWeight: '800', color: '#fff' },
  ctaHint: { fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  // Request card
  reqCard: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6, ...shadows.card },
  reqHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  reqTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  reqCode: { fontSize: 11, fontWeight: '600', color: colors.onSurfaceTertiary },
  reqDates: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  reqMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  reqMeta: { fontSize: 11, color: colors.onSurfaceTertiary },
  reqReason: { fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 16 },

  cancelBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: '#F5C4C4', backgroundColor: '#FDECEC', marginTop: 4 },
  cancelBtnText: { fontSize: 11, fontWeight: '700', color: colors.error },

  // Calendar
  calWrap: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: colors.onSurfaceSecondary, fontWeight: '600' },
  calDetailRow: { flexDirection: 'row', gap: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  calDate: { fontSize: 12, fontWeight: '800', color: colors.brandPrimary, minWidth: 84 },
  calDetailLabel: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  calDetailSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  // Modal / form
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: Platform.OS === 'web' ? 'center' as any : 'flex-end', alignItems: 'center' } as any,
  sheet: { width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...(Platform.OS === 'web' ? { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 } as any : {}), padding: spacing.lg, gap: spacing.sm } as any,
  datePickerSheet: { width: '100%', maxWidth: 520, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...(Platform.OS === 'web' ? { borderRadius: 24 } as any : {}), padding: spacing.md, gap: spacing.sm } as any,
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider, marginBottom: spacing.xs },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.onSurfaceSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.sm, marginBottom: 4 },
  chipsRow: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandSecondary, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  chipTextActive: { color: '#fff' },
  autoApprovePill: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, backgroundColor: colors.success + '30' },
  autoApproveText: { fontSize: 8, fontWeight: '900', color: colors.success, letterSpacing: 0.5 },

  dateRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  dateInput: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  dateLabel: { fontSize: 9, color: colors.onSurfaceTertiary, textTransform: 'uppercase', fontWeight: '700', letterSpacing: 0.5 },
  dateValue: { fontSize: 13, fontWeight: '800', color: colors.onSurface, marginTop: 1 },

  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, fontSize: 13, color: colors.onSurface, backgroundColor: colors.surface, minHeight: 40 },
  hint: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4 },

  previewCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, marginTop: spacing.md },
  previewLabel: { fontSize: 10, fontWeight: '800', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  previewValue: { fontSize: 15, fontWeight: '800', color: colors.onSurface, marginTop: 2 },

  errBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: radius.sm, backgroundColor: '#FDECEC', marginTop: spacing.sm },
  errText: { flex: 1, fontSize: 12, color: colors.error, fontWeight: '600' },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.md, padding: 14, borderRadius: radius.sm, backgroundColor: colors.brandPrimary },
  submitBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  emptyBox: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  emptyText: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center', maxWidth: 300 },
});
