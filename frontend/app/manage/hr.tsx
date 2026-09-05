/**
 * HR & Leave Management — mirrors the web app's HR module.
 *
 * Tabs (horizontal scrollable segmented control):
 *   1. Daily Attendance   — set status per employee for a given date
 *   2. Leave Requests     — list, approve/reject/cancel, create new
 *   3. Balances & History — pick employee → view balances + history
 *   4. Holidays           — public + restricted holidays CRUD
 *   5. Employee Calendar  — 1-employee, 1-month grid
 *   6. Leave Types        — CRUD leave types + entitlement (policy)
 *   7. Audit Trail        — last 50 HR audit events
 *
 * All logic and calculations happen on the shared backend. This screen
 * only renders and dispatches API calls — never duplicates business rules.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput, Modal, Pressable, Alert, Platform, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { Calendar as RNCalendar } from 'react-native-calendars';
import * as Haptics from 'expo-haptics';

import { api } from '@/src/api/client';
import { hrApi, computeDays, type LeaveRequest, type LeaveType, type LeaveStatus, type AttendanceRow, type LeavePolicy, type Holiday_, type LeaveAuditRow, type CalendarDay, type LeaveDayPart } from '@/src/api/hr';
import {
  attendanceApi, fmtLocalTimeISO, localDateToIso,
  type CorrectionRequest as AttendanceCorrection,
} from '@/src/api/attendance';
import { useAuth, useBrand } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, contrastText } from '@/src/theme';

type Beautician = { id: string; name: string; branch_id?: string; role?: string; employee_id?: string; email?: string };

type HRTab = 'attendance' | 'requests' | 'balances' | 'holidays' | 'calendar' | 'types' | 'audit';

const TABS: { key: HRTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'attendance', label: 'Daily Attendance', icon: 'checkmark-done-outline' },
  { key: 'requests',   label: 'Leave Requests',   icon: 'time-outline' },
  { key: 'balances',   label: 'Balances & History', icon: 'stats-chart-outline' },
  { key: 'holidays',   label: 'Holidays',         icon: 'gift-outline' },
  { key: 'calendar',   label: 'Employee Calendar', icon: 'calendar-outline' },
  { key: 'types',      label: 'Leave Types',      icon: 'pricetags-outline' },
  { key: 'audit',      label: 'Audit Trail',      icon: 'document-text-outline' },
];

const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
const ym = (d = new Date()) => d.toISOString().slice(0, 7);

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  present:  { label: 'Present',  color: colors.success,           bg: '#DDF3E4' },
  absent:   { label: 'Absent',   color: colors.error,             bg: '#FDECEC' },
  half_day: { label: 'Half Day', color: '#B8860B',                bg: '#FFF6E0' },
  week_off: { label: 'Week Off', color: colors.onSurfaceTertiary, bg: '#EEE'    },
  on_leave: { label: 'On Leave', color: colors.brandPrimary,      bg: '#FDECEE' },
  holiday:  { label: 'Holiday',  color: '#3F6C9C',                bg: '#DFEAF7' },
};

const LEAVE_STATUS_META: Record<LeaveStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: '#B8860B',              bg: '#FFF6E0' },
  approved:  { label: 'Approved',  color: colors.success,         bg: '#DDF3E4' },
  rejected:  { label: 'Rejected',  color: colors.error,           bg: '#FDECEC' },
  cancelled: { label: 'Cancelled', color: colors.onSurfaceTertiary, bg: '#EEE'  },
};

export default function HRScreen() {
  const router = useRouter();
  const { user, can } = useAuth();
  const { brandColor } = useBrand();
  const brand = brandColor || colors.brandPrimary;
  const onBrand = contrastText(brand);

  const isOwner = !!user?.is_owner;
  const canManage = isOwner || user?.role === 'admin' || user?.role === 'owner';

  const [tab, setTab] = useState<HRTab>('attendance');
  const [beauticians, setBeauticians] = useState<Beautician[]>([]);
  const [loadingBeauticians, setLoadingBeauticians] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await api<Beautician[]>('/beauticians');
        setBeauticians((list || []).filter((b: any) => b.active !== false));
      } catch (e) {
        // Non-fatal: HR screen still renders (empty state); user retries by re-navigating.
        setBeauticians([]);
      } finally {
        setLoadingBeauticians(false);
      }
    })();
  }, []);

  return (
    <View style={styles.root} testID="hr-screen">
      <SafeAreaView edges={['top']} style={[styles.header, { backgroundColor: brand }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={onBrand} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: onBrand }]}>HR / Leave Management</Text>
            <Text style={[styles.headerSub, { color: onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.65)' }]}>Attendance, holidays & employee calendar</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 8, paddingBottom: 4 }}>
          {TABS.map(t => {
            const active = t.key === tab;
            return (
              <TouchableOpacity
                key={t.key}
                testID={`hr-tab-${t.key}`}
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
          {tab === 'attendance' && <AttendanceTab beauticians={beauticians} canManage={canManage} brand={brand} />}
          {tab === 'requests'   && <RequestsTab beauticians={beauticians} canManage={canManage} brand={brand} />}
          {tab === 'balances'   && <BalancesTab beauticians={beauticians} canManage={canManage} brand={brand} />}
          {tab === 'holidays'   && <HolidaysTab canManage={canManage} brand={brand} />}
          {tab === 'calendar'   && <EmployeeCalendarTab beauticians={beauticians} brand={brand} />}
          {tab === 'types'      && <LeaveTypesTab canManage={canManage} brand={brand} />}
          {tab === 'audit'      && <AuditTab brand={brand} />}
        </>
      )}
    </View>
  );
}

// =====================================================================
// TAB 1 — Daily Attendance
// =====================================================================
function AttendanceTab({ beauticians, canManage, brand }: { beauticians: Beautician[]; canManage: boolean; brand: string }) {
  const [date, setDate] = useState(ymd());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Correction review
  const [pendingCorrections, setPendingCorrections] = useState<AttendanceCorrection[]>([]);
  const [reviewing, setReviewing] = useState<AttendanceCorrection | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState<'approve' | 'reject' | null>(null);
  const [reviewMode, setReviewMode] = useState<'view' | 'reject'>('view');

  // Direct edit
  const [directOpen, setDirectOpen] = useState(false);
  const [dEmpId, setDEmpId] = useState<string>('');
  const [dDate, setDDate] = useState(ymd());
  const [dInHM, setDInHM] = useState<{ hh: number; mm: number } | null>(null);
  const [dOutHM, setDOutHM] = useState<{ hh: number; mm: number } | null>(null);
  const [dReason, setDReason] = useState('');
  const [dBusy, setDBusy] = useState(false);

  const loadCorrections = useCallback(async () => {
    if (!canManage) return;
    try {
      const res = await attendanceApi.listCorrections('pending');
      setPendingCorrections(res.rows || []);
    } catch { /* ignore load errors — banner just hides */ }
  }, [canManage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrApi.attendance(date);
      setRows(res.rows || []);
    } catch (e: any) {
      Alert.alert('Attendance load failed', e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const mark = async (row: AttendanceRow, status: 'present' | 'absent' | 'half_day' | 'week_off') => {
    if (!canManage) { Alert.alert('Not allowed', 'You need admin/owner rights to change attendance.'); return; }
    setUpdatingId(row.beautician_id);
    try {
      await hrApi.markAttendance({ beautician_id: row.beautician_id, date, status });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await load();
    } catch (e: any) {
      Alert.alert('Save failed', e.message || String(e));
    } finally {
      setUpdatingId(null);
    }
  };

  useEffect(() => { loadCorrections(); }, [loadCorrections]);

  // ---- Review helpers ------------------------------------------------
  const openReview = (r: AttendanceCorrection) => {
    setReviewing(r); setRejectReason(''); setReviewMode('view');
  };
  const doApprove = async () => {
    if (!reviewing) return;
    setReviewBusy('approve');
    try {
      await attendanceApi.approveCorrection(reviewing.id);
      setReviewing(null);
      await Promise.all([load(), loadCorrections()]);
      Alert.alert('Approved', 'Correction applied to the attendance log.');
    } catch (e: any) {
      Alert.alert('Approve failed', e.message || String(e));
    } finally { setReviewBusy(null); }
  };
  const doReject = async () => {
    if (!reviewing) return;
    if (!rejectReason.trim()) { Alert.alert('Reason required', 'Please provide a rejection reason.'); return; }
    setReviewBusy('reject');
    try {
      await attendanceApi.rejectCorrection(reviewing.id, rejectReason.trim());
      setReviewing(null);
      await loadCorrections();
      Alert.alert('Rejected', 'The correction request has been rejected.');
    } catch (e: any) {
      Alert.alert('Reject failed', e.message || String(e));
    } finally { setReviewBusy(null); }
  };

  // ---- Direct edit ---------------------------------------------------
  const openDirect = () => {
    setDEmpId(beauticians[0]?.id || '');
    setDDate(date);
    setDInHM(null); setDOutHM(null); setDReason('');
    setDirectOpen(true);
  };
  const submitDirect = async () => {
    if (!dEmpId) { Alert.alert('Employee required', 'Please pick an employee.'); return; }
    if (!dInHM && !dOutHM) { Alert.alert('Missing time', 'Enter at least one of Clock In or Clock Out.'); return; }
    if (dInHM && dOutHM) {
      const iM = dInHM.hh * 60 + dInHM.mm;
      const oM = dOutHM.hh * 60 + dOutHM.mm;
      if (oM < iM) { Alert.alert('Invalid range', 'Clock Out cannot be before Clock In.'); return; }
    }
    if (!dReason.trim()) { Alert.alert('Reason required', 'Please enter a reason for the edit.'); return; }
    setDBusy(true);
    try {
      await attendanceApi.directEdit({
        beautician_id: dEmpId,
        date: dDate,
        clock_in: dInHM ? localDateToIso(dDate, dInHM.hh, dInHM.mm) : null,
        clock_out: dOutHM ? localDateToIso(dDate, dOutHM.hh, dOutHM.mm) : null,
        reason: dReason.trim(),
      });
      setDirectOpen(false);
      await load();
      Alert.alert('Updated', 'Attendance updated.');
    } catch (e: any) {
      Alert.alert('Update failed', e.message || String(e));
    } finally { setDBusy(false); }
  };


  const summary = useMemo(() => {
    const c = { present: 0, absent: 0, half_day: 0, week_off: 0, on_leave: 0, holiday: 0, unmarked: 0 };
    rows.forEach(r => {
      const s = r.status || 'unmarked';
      // @ts-ignore
      c[s] = (c[s] || 0) + 1;
    });
    return c;
  }, [rows]);

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <TouchableOpacity onPress={() => setPickerOpen(true)} style={styles.dateRow}>
        <Ionicons name="calendar-outline" size={18} color={brand} />
        <Text style={styles.dateText}>{new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
      </TouchableOpacity>

      <View style={styles.chipsRow}>
        <Chip label={`✓ Present ${summary.present}`} color={colors.success} />
        <Chip label={`✗ Absent ${summary.absent}`} color={colors.error} />
        <Chip label={`½ Half ${summary.half_day}`} color="#B8860B" />
        <Chip label={`Off ${summary.week_off}`} color={colors.onSurfaceTertiary} />
        <Chip label={`Leave ${summary.on_leave}`} color={colors.brandPrimary} />
      </View>

      {/* Corrections banner + direct edit action */}
      {canManage && (
        <View style={{ marginBottom: spacing.md, gap: 8 }}>
          {pendingCorrections.length > 0 && (
            <View style={{ backgroundColor: colors.warning + '18', borderColor: colors.warning + '55', borderWidth: 1, borderRadius: radius.md, padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Ionicons name="hourglass-outline" size={14} color={colors.warning} />
                <Text style={{ fontSize: 12, fontWeight: '800', color: colors.warning }}>
                  {pendingCorrections.length} pending correction{pendingCorrections.length === 1 ? '' : 's'}
                </Text>
              </View>
              {pendingCorrections.slice(0, 4).map(r => (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => openReview(r)}
                  testID={`review-${r.id}`}
                  style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.warning + '22' }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.onSurface }}>
                    {r.beautician_name || 'Staff'} · {r.attendance_date}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2 }}>
                    In {fmtLocalTimeISO(r.current_clock_in)} → {fmtLocalTimeISO(r.requested_clock_in)}   ·   Out {fmtLocalTimeISO(r.current_clock_out)} → {fmtLocalTimeISO(r.requested_clock_out)}
                  </Text>
                  {r.reason ? <Text style={{ fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 }} numberOfLines={2}>Reason: {r.reason}</Text> : null}
                  <Text style={{ fontSize: 11, fontWeight: '800', color: colors.brandPrimary, marginTop: 4 }}>Review →</Text>
                </TouchableOpacity>
              ))}
              {pendingCorrections.length > 4 && (
                <Text style={{ fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 6 }}>
                  +{pendingCorrections.length - 4} more…
                </Text>
              )}
            </View>
          )}
          <TouchableOpacity
            onPress={openDirect}
            testID="direct-edit-btn"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: brand + '55', backgroundColor: brand + '10' }}
          >
            <Ionicons name="create-outline" size={14} color={brand} />
            <Text style={{ fontSize: 12, fontWeight: '800', color: brand }}>Edit attendance directly</Text>
          </TouchableOpacity>
        </View>
      )}


      {rows.length === 0 ? (
        <Empty icon="calendar-outline" title="No team members" hint="Add employees under Team Management." />
      ) : (
        rows.map(row => {
          const meta = row.status ? STATUS_META[row.status] : null;
          return (
            <View key={row.beautician_id} style={styles.card} testID={`attn-row-${row.beautician_id}`}>
              <View style={styles.rowHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{row.beautician_name}</Text>
                  {meta ? (
                    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  ) : (
                    <Text style={styles.rowSub}>Not marked</Text>
                  )}
                </View>
                {updatingId === row.beautician_id && <ActivityIndicator color={brand} />}
              </View>
              {canManage && (
                <View style={styles.actionsGrid}>
                  {(['present', 'absent', 'half_day', 'week_off'] as const).map(s => {
                    const active = row.status === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        onPress={() => mark(row, s)}
                        style={[styles.actionBtn, active && { backgroundColor: brand, borderColor: brand }]}
                        disabled={!!updatingId}
                      >
                        <Text style={[styles.actionBtnText, active && { color: '#fff' }]}>{STATUS_META[s].label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })
      )}

      <DatePickerModal visible={pickerOpen} value={date} onClose={() => setPickerOpen(false)} onPick={d => { setDate(d); setPickerOpen(false); }} />

      {/* ============ Review Correction Modal ============ */}
      <Modal visible={!!reviewing} transparent animationType="slide" onRequestClose={() => setReviewing(null)}>
        <Pressable style={styles.modalScrim} onPress={() => setReviewing(null)}>
          <Pressable style={[styles.modalCard, { maxHeight: '92%' }]} onPress={e => e.stopPropagation()}>
            <ScrollView contentContainerStyle={{ paddingBottom: spacing.md }} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Review correction</Text>
              {reviewing && (
                <>
                  <Text style={styles.formLabel}>Staff · Date</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.onSurface }}>{reviewing.beautician_name || 'Staff'} · {reviewing.attendance_date}</Text>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    <View style={{ flex: 1, backgroundColor: colors.surfaceTertiary, padding: 10, borderRadius: radius.sm }}>
                      <Text style={styles.formLabel}>Current In</Text>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.onSurface }}>{fmtLocalTimeISO(reviewing.current_clock_in)}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: brand + '18', padding: 10, borderRadius: radius.sm }}>
                      <Text style={[styles.formLabel, { color: brand }]}>Requested In</Text>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: brand }}>{fmtLocalTimeISO(reviewing.requested_clock_in)}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <View style={{ flex: 1, backgroundColor: colors.surfaceTertiary, padding: 10, borderRadius: radius.sm }}>
                      <Text style={styles.formLabel}>Current Out</Text>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.onSurface }}>{fmtLocalTimeISO(reviewing.current_clock_out)}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: brand + '18', padding: 10, borderRadius: radius.sm }}>
                      <Text style={[styles.formLabel, { color: brand }]}>Requested Out</Text>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: brand }}>{fmtLocalTimeISO(reviewing.requested_clock_out)}</Text>
                    </View>
                  </View>

                  {reviewing.reason ? (
                    <View style={{ marginTop: spacing.md }}>
                      <Text style={styles.formLabel}>Reason</Text>
                      <Text style={{ fontSize: 13, color: colors.onSurface }}>{reviewing.reason}</Text>
                    </View>
                  ) : null}
                  {reviewing.employee_note ? (
                    <View style={{ marginTop: spacing.sm }}>
                      <Text style={styles.formLabel}>Note</Text>
                      <Text style={{ fontSize: 13, color: colors.onSurface }}>{reviewing.employee_note}</Text>
                    </View>
                  ) : null}

                  {reviewMode === 'reject' && (
                    <View style={{ marginTop: spacing.md }}>
                      <Text style={styles.formLabel}>Rejection reason *</Text>
                      <TextInput
                        testID="reject-reason"
                        value={rejectReason}
                        onChangeText={setRejectReason}
                        placeholder="Why is this being rejected?"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        multiline
                        style={[styles.formInput, { minHeight: 60, textAlignVertical: 'top' }]}
                      />
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    {reviewMode === 'view' ? (
                      <>
                        <TouchableOpacity
                          onPress={() => setReviewMode('reject')}
                          testID="btn-reject-mode"
                          style={{ flex: 1, backgroundColor: '#fff', borderColor: colors.error, borderWidth: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' }}
                        >
                          <Text style={{ color: colors.error, fontWeight: '800' }}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={doApprove}
                          disabled={reviewBusy !== null}
                          testID="btn-approve"
                          style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.success, marginTop: 0 }, reviewBusy && { opacity: 0.6 }]}
                        >
                          {reviewBusy === 'approve' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Approve</Text>}
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          onPress={() => { setReviewMode('view'); setRejectReason(''); }}
                          style={{ flex: 1, backgroundColor: '#F3F3F3', paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' }}
                        >
                          <Text style={{ color: colors.onSurfaceSecondary, fontWeight: '800' }}>Back</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={doReject}
                          disabled={reviewBusy !== null}
                          testID="btn-reject-confirm"
                          style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.error, marginTop: 0 }, reviewBusy && { opacity: 0.6 }]}
                        >
                          {reviewBusy === 'reject' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Confirm reject</Text>}
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ============ Direct Edit Modal ============ */}
      <Modal visible={directOpen} transparent animationType="slide" onRequestClose={() => setDirectOpen(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setDirectOpen(false)}>
          <Pressable style={[styles.modalCard, { maxHeight: '92%' }]} onPress={e => e.stopPropagation()}>
            <ScrollView contentContainerStyle={{ paddingBottom: spacing.md }} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Edit attendance</Text>

              <Text style={styles.formLabel}>Employee *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }} style={{ flexGrow: 0 }}>
                {beauticians.map(b => {
                  const sel = dEmpId === b.id;
                  return (
                    <TouchableOpacity key={b.id} onPress={() => setDEmpId(b.id)} style={[styles.filterPill, sel && { backgroundColor: brand, borderColor: brand }]} testID={`de-emp-${b.id}`}>
                      <Text style={[styles.filterPillText, sel && { color: '#fff' }]}>{b.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.formLabel}>Date *</Text>
              <TextInput
                testID="de-date"
                value={dDate}
                onChangeText={setDDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.formInput}
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>Clock In (24h)</Text>
                  <TextInput
                    testID="de-in"
                    value={dInHM ? `${String(dInHM.hh).padStart(2, '0')}:${String(dInHM.mm).padStart(2, '0')}` : ''}
                    onChangeText={(v) => {
                      const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
                      if (m) setDInHM({ hh: Math.min(23, parseInt(m[1], 10)), mm: Math.min(59, parseInt(m[2], 10)) });
                      else if (!v.trim()) setDInHM(null);
                    }}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    style={styles.formInput}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>Clock Out (24h)</Text>
                  <TextInput
                    testID="de-out"
                    value={dOutHM ? `${String(dOutHM.hh).padStart(2, '0')}:${String(dOutHM.mm).padStart(2, '0')}` : ''}
                    onChangeText={(v) => {
                      const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
                      if (m) setDOutHM({ hh: Math.min(23, parseInt(m[1], 10)), mm: Math.min(59, parseInt(m[2], 10)) });
                      else if (!v.trim()) setDOutHM(null);
                    }}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    style={styles.formInput}
                  />
                </View>
              </View>

              <Text style={styles.formLabel}>Reason *</Text>
              <TextInput
                testID="de-reason"
                value={dReason}
                onChangeText={setDReason}
                placeholder="Manager verified punches"
                placeholderTextColor={colors.onSurfaceTertiary}
                multiline
                style={[styles.formInput, { minHeight: 60, textAlignVertical: 'top' }]}
              />

              <TouchableOpacity onPress={submitDirect} disabled={dBusy} style={[styles.primaryBtn, { backgroundColor: brand }, dBusy && { opacity: 0.6 }]} testID="de-submit">
                {dBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save attendance</Text>}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

// =====================================================================
// TAB 2 — Leave Requests
// =====================================================================
function RequestsTab({ beauticians, canManage, brand }: { beauticians: Beautician[]; canManage: boolean; brand: string }) {
  const [filter, setFilter] = useState<LeaveStatus | 'all'>('pending');
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqs, lts] = await Promise.all([
        hrApi.listLeaveRequests(filter === 'all' ? undefined : filter),
        types.length ? Promise.resolve(types) : hrApi.listLeaveTypes(),
      ]);
      setRows(Array.isArray(reqs) ? reqs : (reqs as any)?.rows || []);
      if (!types.length) setTypes(lts as LeaveType[]);
    } catch (e: any) {
      Alert.alert('Load failed', e.message || String(e));
    } finally { setLoading(false); }
  }, [filter, types.length]);

  useEffect(() => { load(); }, [load]);

  const act = async (r: LeaveRequest, action: 'approve' | 'reject' | 'cancel') => {
    setBusyId(r.id);
    try {
      if (action === 'approve') await hrApi.approveLeave(r.id);
      else if (action === 'reject') await hrApi.rejectLeave(r.id);
      else await hrApi.cancelLeave(r.id);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await load();
    } catch (e: any) {
      Alert.alert('Action failed', e.message || String(e));
    } finally { setBusyId(null); }
  };

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
        {(['pending', 'approved', 'rejected', 'cancelled', 'all'] as const).map(s => {
          const active = filter === s;
          return (
            <TouchableOpacity key={s} onPress={() => setFilter(s as any)} style={[styles.filterPill, active && { backgroundColor: brand, borderColor: brand }]}>
              <Text style={[styles.filterPillText, active && { color: '#fff' }]}>{s === 'all' ? 'All' : LEAVE_STATUS_META[s as LeaveStatus].label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {canManage && (
        <TouchableOpacity onPress={() => setCreateOpen(true)} style={[styles.primaryBtn, { backgroundColor: brand }]}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>New Leave Request</Text>
        </TouchableOpacity>
      )}

      {rows.length === 0 ? (
        <Empty icon="time-outline" title="No leave requests" hint={filter === 'pending' ? 'No pending requests to approve.' : 'No requests match this filter.'} />
      ) : rows.map(r => {
        const meta = LEAVE_STATUS_META[r.status];
        return (
          <View key={r.id} style={styles.card} testID={`req-${r.id}`}>
            <View style={styles.rowHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.beautician_name || 'Employee'}</Text>
                <Text style={styles.rowSub}>{r.leave_type_name} • {r.from_date}{r.from_date !== r.to_date ? ` → ${r.to_date}` : ''} • {r.days}d{r.day_part !== 'full' ? ` (${r.day_part.replace('_', ' ')})` : ''}</Text>
                {r.reason ? <Text style={styles.rowSub}>“{r.reason}”</Text> : null}
              </View>
              <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </View>
            {canManage && r.status === 'pending' && (
              <View style={styles.actionsGrid}>
                <TouchableOpacity onPress={() => act(r, 'approve')} disabled={!!busyId} style={[styles.actionBtn, { backgroundColor: colors.success, borderColor: colors.success }]}>
                  {busyId === r.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.actionBtnText, { color: '#fff' }]}>Approve</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => act(r, 'reject')} disabled={!!busyId} style={[styles.actionBtn, { backgroundColor: colors.error, borderColor: colors.error }]}>
                  <Text style={[styles.actionBtnText, { color: '#fff' }]}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => act(r, 'cancel')} disabled={!!busyId} style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
            {canManage && r.status === 'approved' && (
              <TouchableOpacity onPress={() => act(r, 'cancel')} disabled={!!busyId} style={[styles.actionBtn, { marginTop: spacing.sm }]}>
                <Text style={styles.actionBtnText}>Cancel Approval</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <CreateLeaveModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); load(); }}
        beauticians={beauticians}
        types={types}
        brand={brand}
      />
    </ScrollView>
  );
}

// =====================================================================
// TAB 3 — Balances & History (employee picker)
// =====================================================================
function BalancesTab({ beauticians, canManage, brand }: { beauticians: Beautician[]; canManage: boolean; brand: string }) {
  const [empId, setEmpId] = useState(beauticians[0]?.id || '');
  const [year, setYear] = useState(new Date().getFullYear());
  const [balances, setBalances] = useState<any[]>([]);
  const [history, setHistory] = useState<LeaveRequest[]>([]);
  const [accruals, setAccruals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => { if (!empId && beauticians.length) setEmpId(beauticians[0].id); }, [beauticians, empId]);

  const load = useCallback(async () => {
    if (!empId) return;
    setLoading(true);
    try {
      const [bal, hist, acc] = await Promise.all([
        hrApi.leaveBalances(empId, year),
        hrApi.leaveHistory({ beautician_id: empId, year }),
        hrApi.leaveAccruals(empId, year).catch(() => ({ rows: [] })),
      ]);
      setBalances((bal as any).balances || []);
      setHistory(Array.isArray(hist) ? hist : (hist as any).rows || []);
      setAccruals(((acc as any)?.rows || []).sort((a: any, b: any) => (a.month || 0) - (b.month || 0)));
    } catch (e: any) {
      Alert.alert('Load failed', e.message || String(e));
    } finally { setLoading(false); }
  }, [empId, year]);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await hrApi.runAccruals();
      Alert.alert('Accrual complete', `Credited ${res.created} new entrie${res.created === 1 ? '' : 's'} across ${res.employees} employee${res.employees === 1 ? '' : 's'}.`);
      await load();
    } catch (e: any) {
      Alert.alert('Failed', e.message || String(e));
    } finally { setRunning(false); }
  };

  const emp = beauticians.find(b => b.id === empId);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TouchableOpacity onPress={() => setPickerOpen(true)} style={[styles.dateRow, { flex: 1, marginBottom: 0 }]}>
          <Ionicons name="person-outline" size={18} color={brand} />
          <Text style={styles.dateText}>{emp?.name || 'Select employee'}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
        </TouchableOpacity>
        {canManage && (
          <TouchableOpacity onPress={runNow} disabled={running} style={[styles.filterPill, { paddingHorizontal: 12, paddingVertical: 10, borderColor: brand, backgroundColor: '#fff' }]}>
            {running ? <ActivityIndicator size="small" color={brand} /> : <Text style={[styles.filterPillText, { color: brand, fontWeight: '800' }]}>Run accrual now</Text>}
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.md, marginBottom: spacing.md }}>
        {[year - 1, year, year + 1].map(y => (
          <TouchableOpacity key={y} onPress={() => setYear(y)} style={[styles.filterPill, y === year && { backgroundColor: brand, borderColor: brand }]}>
            <Text style={[styles.filterPillText, y === year && { color: '#fff' }]}>{y}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Leave Balances</Text>
      {balances.length === 0 ? (
        <Empty icon="stats-chart-outline" title="No balances" hint="This employee has no leave-type entitlements yet." />
      ) : balances.map(b => {
        const isAccrual = !!b.monthly_accrual;
        return (
          <View key={b.leave_type_id} style={styles.card}>
            <View style={styles.rowHead}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.rowTitle}>{b.leave_type_name} <Text style={styles.rowSub}>({b.code})</Text></Text>
                  {isAccrual && (
                    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: brand + '22' }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: brand }}>{Number(b.monthly_accrual_amount ?? 0).toFixed(2)}/mo</Text>
                    </View>
                  )}
                </View>
                {isAccrual ? (
                  <Text style={styles.rowSub}>Annual {b.entitled} • Accrued {Number(b.accrued ?? 0).toFixed(2)} • Used {b.used}</Text>
                ) : (
                  <Text style={styles.rowSub}>Entitled {b.entitled} • Used {b.used} • Pending {b.pending}</Text>
                )}
              </View>
              <Text style={[styles.availableNum, { color: brand }]}>{Number(b.available ?? 0).toFixed(2)}</Text>
            </View>
          </View>
        );
      })}

      {accruals.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Monthly accrual history</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
            {accruals.map(a => (
              <View key={a.id} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: brand + '15', borderWidth: 1, borderColor: brand + '33' }}>
                <Text style={{ fontSize: 11, color: brand, fontWeight: '700' }}>
                  {a.leave_type_code} {MONTHS[(a.month || 1) - 1]} {a.year} +{Number(a.amount ?? 0).toFixed(2).replace(/\.00$/, '')}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>History ({history.length})</Text>
      {history.length === 0 ? (
        <Empty icon="time-outline" title="No history" hint="No leave records for this year." />
      ) : history.slice(0, 20).map(r => {
        const meta = LEAVE_STATUS_META[r.status];
        return (
          <View key={r.id} style={styles.card}>
            <Text style={styles.rowTitle}>{r.leave_type_name} • {r.days}d</Text>
            <Text style={styles.rowSub}>{r.from_date}{r.from_date !== r.to_date ? ` → ${r.to_date}` : ''} • {r.reason || 'No reason'}</Text>
            <View style={[styles.badge, { backgroundColor: meta.bg, alignSelf: 'flex-start', marginTop: 6 }]}>
              <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>
        );
      })}

      <BeauticianPickerModal visible={pickerOpen} onClose={() => setPickerOpen(false)} beauticians={beauticians} onPick={id => { setEmpId(id); setPickerOpen(false); }} />
    </ScrollView>
  );
}

// =====================================================================
// TAB 4 — Holidays
// =====================================================================
function HolidaysTab({ canManage, brand }: { canManage: boolean; brand: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Holiday_[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [rhConfig, setRhConfig] = useState<number>(0);
  const [editing, setEditing] = useState<Holiday_ | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hs, cfg, brs] = await Promise.all([
        hrApi.listHolidays(year),
        hrApi.rhConfig().catch(() => ({ rh_entitlement: 0 })),
        api<{ id: string; name: string }[]>('/branches').catch(() => []),
      ]);
      setRows(hs || []);
      setRhConfig(cfg.rh_entitlement || 0);
      setBranches(brs || []);
    } catch (e: any) {
      Alert.alert('Load failed', e.message || String(e));
    } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const del = (h: Holiday_) => {
    if (!canManage) return;
    Alert.alert('Delete holiday', `Remove "${h.name}"?`, [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await hrApi.deleteHoliday(h.id); load(); } catch (e: any) { Alert.alert('Failed', e.message); }
      }},
    ]);
  };

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md, alignItems: 'center' }}>
        {[year - 1, year, year + 1].map(y => (
          <TouchableOpacity key={y} onPress={() => setYear(y)} style={[styles.filterPill, y === year && { backgroundColor: brand, borderColor: brand }]}>
            <Text style={[styles.filterPillText, y === year && { color: '#fff' }]}>{y}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <View style={styles.rhCounter}>
          <Text style={styles.rhCounterLabel}>RH allowed</Text>
          <Text style={[styles.rhCounterValue, { color: brand }]}>{rhConfig}</Text>
        </View>
      </View>

      {canManage && (
        <TouchableOpacity onPress={() => { setEditing(null); setModalOpen(true); }} style={[styles.primaryBtn, { backgroundColor: brand }]}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>Add Holiday</Text>
        </TouchableOpacity>
      )}

      {rows.length === 0 ? (
        <Empty icon="gift-outline" title="No holidays" hint="No holidays configured for this year." />
      ) : rows.map(h => {
        const bids = (h as any).branch_ids as string[] | undefined;
        const branchLabel = !bids || bids.length === 0
          ? 'All branches'
          : (bids.map(id => branches.find(b => b.id === id)?.name).filter(Boolean).join(', ') || `${bids.length} branch${bids.length === 1 ? '' : 'es'}`);
        return (
          <TouchableOpacity key={h.id} style={styles.card} onPress={() => canManage && (setEditing(h), setModalOpen(true))} disabled={!canManage}>
            <View style={styles.rowHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{h.name}</Text>
                <Text style={styles.rowSub}>{new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })} • {h.paid ? 'Paid' : 'Unpaid'}</Text>
                <Text style={[styles.rowSub, { color: colors.onSurfaceTertiary }]}>
                  Applicable to <Text style={{ fontWeight: '700', color: colors.onSurfaceSecondary }}>{branchLabel}</Text>
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: (h.holiday_type === 'restricted' ? '#F0E6FA' : '#DFEAF7') }]}>
                <Text style={[styles.badgeText, { color: h.holiday_type === 'restricted' ? '#8A5CB8' : '#3F6C9C' }]}>{h.holiday_type === 'restricted' ? 'RH' : 'Public'}</Text>
              </View>
              {canManage && (
                <TouchableOpacity onPress={() => del(h)} style={{ padding: 6, marginLeft: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        );
      })}

      <HolidayModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); load(); }}
        editing={editing}
        brand={brand}
        branches={branches}
      />
    </ScrollView>
  );
}

// =====================================================================
// TAB 5 — Employee Calendar
// =====================================================================
function EmployeeCalendarTab({ beauticians, brand }: { beauticians: Beautician[]; brand: string }) {
  const [empId, setEmpId] = useState(beauticians[0]?.id || '');
  const [month, setMonth] = useState(ym());
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => { if (!empId && beauticians.length) setEmpId(beauticians[0].id); }, [beauticians, empId]);

  const load = useCallback(async () => {
    if (!empId) return;
    setLoading(true);
    try {
      const res = await hrApi.calendar(empId, month);
      setDays(res.days || []);
    } catch (e: any) { Alert.alert('Load failed', e.message || String(e)); }
    finally { setLoading(false); }
  }, [empId, month]);

  useEffect(() => { load(); }, [load]);

  const marked = useMemo(() => {
    const m: any = {};
    days.forEach(d => {
      if (!d.status) return;
      const meta: Record<string, string> = {
        present: colors.success, paid_leave: brand, unpaid_leave: colors.error,
        half_day: '#B8860B', public_holiday: '#3F6C9C', restricted_holiday: '#8A5CB8', weekly_off: colors.onSurfaceTertiary,
      };
      m[d.date] = { customStyles: { container: { backgroundColor: (meta[d.status] || brand) + '22' }, text: { color: meta[d.status] || brand, fontWeight: '700' } } };
    });
    return m;
  }, [days, brand]);

  const emp = beauticians.find(b => b.id === empId);

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <TouchableOpacity onPress={() => setPickerOpen(true)} style={styles.dateRow}>
        <Ionicons name="person-outline" size={18} color={brand} />
        <Text style={styles.dateText}>{emp?.name || 'Select employee'}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
      </TouchableOpacity>

      <RNCalendar
        current={month + '-01'}
        markingType="custom"
        markedDates={marked}
        onMonthChange={(m: any) => setMonth(m.dateString.slice(0, 7))}
        theme={{ selectedDayBackgroundColor: brand, todayTextColor: brand, arrowColor: brand }}
        style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' }}
      />

      <View style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[
          ['Present', colors.success],
          ['Paid Leave', brand],
          ['Unpaid Leave', colors.error],
          ['Half Day', '#B8860B'],
          ['Public Holiday', '#3F6C9C'],
          ['RH', '#8A5CB8'],
          ['Weekly Off', colors.onSurfaceTertiary],
        ].map(([label, c]) => (
          <View key={String(label)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c as string }} />
            <Text style={{ fontSize: 11, color: colors.onSurfaceTertiary }}>{label as string}</Text>
          </View>
        ))}
      </View>

      <BeauticianPickerModal visible={pickerOpen} onClose={() => setPickerOpen(false)} beauticians={beauticians} onPick={id => { setEmpId(id); setPickerOpen(false); }} />
    </ScrollView>
  );
}

// =====================================================================
// TAB 6 — Leave Types
// =====================================================================
function LeaveTypesTab({ canManage, brand }: { canManage: boolean; brand: string }) {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [policies, setPolicies] = useState<LeavePolicy[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ts, ps, brs] = await Promise.all([
        hrApi.listLeaveTypes(),
        hrApi.listLeavePolicies().catch(() => []),
        api<{ id: string; name: string }[]>('/branches').catch(() => []),
      ]);
      setTypes(ts as LeaveType[]);
      setPolicies(ps as LeavePolicy[]);
      setBranches(brs || []);
    } catch (e: any) { Alert.alert('Load failed', e.message || String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleActive = (t: LeaveType) => {
    if (!canManage) return;
    const nextActive = t.active === false;
    Alert.alert(
      nextActive ? 'Enable leave type?' : 'Disable leave type?',
      nextActive
        ? `Enable "${t.name}" so employees can request it again.`
        : `Disable "${t.name}"? Employees won't be able to request it. Existing balances and history stay intact.`,
      [
        { text: 'Cancel' },
        {
          text: nextActive ? 'Enable' : 'Disable',
          style: nextActive ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await hrApi.updateLeaveType(t.id, { active: nextActive });
              load();
            } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
          },
        },
      ],
    );
  };

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      {canManage && (
        <TouchableOpacity onPress={() => { setEditing(null); setModalOpen(true); }} style={[styles.primaryBtn, { backgroundColor: brand }]}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>New Leave Type</Text>
        </TouchableOpacity>
      )}

      {types.length === 0 ? (
        <Empty icon="pricetags-outline" title="No leave types" hint="Create leave types like Casual Leave, Sick Leave, etc." />
      ) : types.map(t => {
        const pol = policies.find(p => p.leave_type_id === t.id);
        const isInactive = t.active === false;
        return (
          <TouchableOpacity key={t.id} onPress={() => canManage && (setEditing(t), setModalOpen(true))} style={[styles.card, isInactive && { opacity: 0.6 }]} disabled={!canManage}>
            <View style={styles.rowHead}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.rowTitle}>{t.name} <Text style={styles.rowSub}>({t.code})</Text></Text>
                  {(pol as any)?.monthly_accrual && (
                    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: brand + '22' }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: brand }}>/mo</Text>
                    </View>
                  )}
                  {isInactive ? (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FDECEC', borderWidth: 1, borderColor: colors.error + '66' }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: colors.error }}>Inactive</Text>
                    </View>
                  ) : (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.success + '18' }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: colors.success }}>Active</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.rowSub}>
                  {t.paid ? 'Paid' : 'Unpaid'} • {t.allow_half_day ? 'Half day OK' : 'Full day only'} • {t.requires_approval ? 'Approval required' : 'Auto approve'}
                </Text>
                {pol && <Text style={styles.rowSub}>Entitlement: {pol.annual_entitlement}/year{(pol as any).monthly_accrual ? ` · accrues ${(pol.annual_entitlement / 12).toFixed(2)}/mo` : ''}</Text>}
                {(() => {
                  const bids = t.branch_ids || [];
                  if (!bids.length) {
                    return <Text style={[styles.rowSub, { color: colors.onSurfaceTertiary }]}>Applicable to <Text style={{ fontWeight: '700', color: colors.onSurfaceSecondary }}>All branches</Text></Text>;
                  }
                  const names = bids
                    .map(id => branches.find(b => b.id === id)?.name)
                    .filter(Boolean)
                    .join(', ') || `${bids.length} branch${bids.length === 1 ? '' : 'es'}`;
                  return <Text style={[styles.rowSub, { color: colors.onSurfaceTertiary }]}>Applicable to <Text style={{ fontWeight: '700', color: colors.onSurfaceSecondary }}>{names}</Text></Text>;
                })()}
              </View>
              {canManage && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <TouchableOpacity onPress={() => toggleActive(t)} style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: isInactive ? colors.success : colors.borderStrong, backgroundColor: isInactive ? colors.success + '18' : '#fff' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: isInactive ? colors.success : colors.onSurfaceSecondary }}>
                      {isInactive ? 'Enable' : 'Disable'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </TouchableOpacity>
        );
      })}

      <LeaveTypeModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); load(); }}
        editing={editing}
        existingPolicy={editing ? policies.find(p => p.leave_type_id === editing.id) : undefined}
        brand={brand}
        branches={branches}
      />
    </ScrollView>
  );
}

// =====================================================================
// TAB 7 — Audit Trail
// =====================================================================
function AuditTab({ brand }: { brand: string }) {
  const [rows, setRows] = useState<LeaveAuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrApi.leaveAudit(100);
      setRows(res.rows || []);
    } catch (e: any) { Alert.alert('Load failed', e.message || String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={brand} />} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      {rows.length === 0 ? (
        <Empty icon="document-text-outline" title="No audit events" hint="Leave approvals and changes will appear here." />
      ) : rows.map(r => (
        <View key={r.id} style={styles.card}>
          <Text style={styles.rowTitle}>{r.action.replace(/_/g, ' ')}</Text>
          <Text style={styles.rowSub}>{r.actor_name || 'System'} • {new Date(r.at).toLocaleString('en-IN')}</Text>
          {r.before && r.after && (
            <Text style={[styles.rowSub, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11 }]}>
              {typeof r.before?.status === 'string' ? `${r.before.status} → ${r.after?.status || '—'}` : ''}
            </Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

// =====================================================================
// MODALS
// =====================================================================
function DatePickerModal({ visible, value, onClose, onPick }: { visible: boolean; value: string; onClose: () => void; onPick: (d: string) => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Pick a date</Text>
          <RNCalendar current={value} onDayPress={(d: any) => onPick(d.dateString)} markedDates={{ [value]: { selected: true } }} />
          <TouchableOpacity onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>Close</Text></TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BeauticianPickerModal({ visible, onClose, beauticians, onPick }: { visible: boolean; onClose: () => void; beauticians: Beautician[]; onPick: (id: string) => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={[styles.modalCard, { maxHeight: '70%' }]} onPress={e => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Select Employee</Text>
          <ScrollView style={{ maxHeight: 400 }}>
            {beauticians.map(b => (
              <TouchableOpacity key={b.id} onPress={() => onPick(b.id)} style={styles.pickerRow}>
                <Ionicons name="person-circle-outline" size={24} color={colors.onSurfaceTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{b.name}</Text>
                  {b.role ? <Text style={styles.rowSub}>{b.role}</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>Close</Text></TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CreateLeaveModal({ visible, onClose, onCreated, beauticians, types, brand }:
  { visible: boolean; onClose: () => void; onCreated: () => void; beauticians: Beautician[]; types: LeaveType[]; brand: string }) {
  const [empId, setEmpId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [fromDate, setFromDate] = useState(ymd());
  const [toDate, setToDate] = useState(ymd());
  const [dayPart, setDayPart] = useState<LeaveDayPart>('full');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCal, setShowCal] = useState<'from' | 'to' | null>(null);

  useEffect(() => { if (visible) { setEmpId(''); setTypeId(''); setReason(''); setFromDate(ymd()); setToDate(ymd()); setDayPart('full'); } }, [visible]);

  const submit = async () => {
    if (!empId || !typeId) { Alert.alert('Missing', 'Select employee and leave type.'); return; }
    setBusy(true);
    try {
      await hrApi.createLeaveRequest({
        beautician_id: empId, leave_type_id: typeId, from_date: fromDate, to_date: toDate, day_part: dayPart, reason,
      });
      onCreated();
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
    finally { setBusy(false); }
  };

  const days = computeDays(fromDate, toDate, dayPart);
  const emp = beauticians.find(b => b.id === empId);
  const tp = types.find(t => t.id === typeId);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={[styles.modalCard, { maxHeight: '90%' }]} onPress={e => e.stopPropagation()}>
          <Text style={styles.modalTitle}>New Leave Request</Text>
          <ScrollView>
            <Text style={styles.formLabel}>Employee *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {beauticians.map(b => (
                <TouchableOpacity key={b.id} onPress={() => setEmpId(b.id)} style={[styles.filterPill, empId === b.id && { backgroundColor: brand, borderColor: brand }]}>
                  <Text style={[styles.filterPillText, empId === b.id && { color: '#fff' }]}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.formLabel}>Leave Type *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {(() => {
                const empBranch = beauticians.find(b => b.id === empId)?.branch_id;
                const eligible = types.filter(t => {
                  if ((t as any).active === false) return false;
                  const bids = (t as any).branch_ids as string[] | undefined;
                  if (!bids || bids.length === 0) return true;   // empty = all branches
                  if (!empBranch) return true;                    // no branch info yet — allow
                  return bids.includes(empBranch);
                });
                if (eligible.length === 0) {
                  return (
                    <Text style={{ fontSize: 12, color: colors.onSurfaceTertiary, paddingVertical: 6 }}>
                      No leave type available for this employee&apos;s branch.
                    </Text>
                  );
                }
                return eligible.map(t => (
                  <TouchableOpacity key={t.id} onPress={() => setTypeId(t.id)} style={[styles.filterPill, typeId === t.id && { backgroundColor: brand, borderColor: brand }]}>
                    <Text style={[styles.filterPillText, typeId === t.id && { color: '#fff' }]}>{t.name}</Text>
                  </TouchableOpacity>
                ));
              })()}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>From</Text>
                <TouchableOpacity onPress={() => setShowCal('from')} style={styles.formInput}><Text>{fromDate}</Text></TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>To</Text>
                <TouchableOpacity onPress={() => setShowCal('to')} style={styles.formInput}><Text>{toDate}</Text></TouchableOpacity>
              </View>
            </View>

            <Text style={styles.formLabel}>Day Part</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['full', 'first_half', 'second_half'] as LeaveDayPart[]).map(dp => (
                <TouchableOpacity key={dp} onPress={() => setDayPart(dp)} style={[styles.filterPill, dayPart === dp && { backgroundColor: brand, borderColor: brand }]}>
                  <Text style={[styles.filterPillText, dayPart === dp && { color: '#fff' }]}>{dp.replace('_', ' ')}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>Reason</Text>
            <TextInput value={reason} onChangeText={setReason} placeholder="e.g. Family function" style={styles.formInput} />

            <Text style={[styles.rowSub, { marginVertical: 8 }]}>Days: <Text style={{ fontWeight: '800', color: brand }}>{days}</Text>{tp ? ` • ${tp.paid ? 'Paid' : 'Unpaid'}` : ''}</Text>

            <TouchableOpacity onPress={submit} disabled={busy} style={[styles.primaryBtn, { backgroundColor: brand, marginTop: spacing.md }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={styles.primaryBtnText}>Submit Request</Text></>}
            </TouchableOpacity>
          </ScrollView>

          {showCal && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setShowCal(null)}>
              <Pressable style={styles.modalScrim} onPress={() => setShowCal(null)}>
                <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
                  <RNCalendar current={showCal === 'from' ? fromDate : toDate}
                    onDayPress={(d: any) => {
                      if (showCal === 'from') { setFromDate(d.dateString); if (d.dateString > toDate) setToDate(d.dateString); }
                      else setToDate(d.dateString);
                      setShowCal(null);
                    }} />
                </Pressable>
              </Pressable>
            </Modal>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HolidayModal({ visible, onClose, onSaved, editing, brand, branches }:
  { visible: boolean; onClose: () => void; onSaved: () => void; editing: Holiday_ | null; brand: string; branches: { id: string; name: string }[] }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(ymd());
  const [type, setType] = useState<'public' | 'restricted'>('public');
  const [paid, setPaid] = useState(true);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCal, setShowCal] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(editing?.name || '');
      setDate(editing?.date || ymd());
      setType((editing?.holiday_type as any) || 'public');
      setPaid(editing?.paid ?? true);
      setBranchIds(Array.isArray((editing as any)?.branch_ids) ? [...((editing as any).branch_ids as string[])] : []);
    }
  }, [visible, editing]);

  const toggleBranch = (id: string) => {
    setBranchIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const allBranchesSelected = branchIds.length === 0;

  const submit = async () => {
    if (!name.trim()) { Alert.alert('Missing', 'Enter a holiday name.'); return; }
    setBusy(true);
    try {
      const payload: any = { name, date, holiday_type: type, paid, branch_ids: branchIds };
      if (editing) await hrApi.updateHoliday(editing.id, payload);
      else await hrApi.createHoliday(payload);
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={[styles.modalCard, { maxHeight: '92%' }]} onPress={e => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.md }}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Holiday' : 'New Holiday'}</Text>
            <Text style={styles.formLabel}>Name *</Text>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. Diwali" style={styles.formInput} />
            <Text style={styles.formLabel}>Date *</Text>
            <TouchableOpacity onPress={() => setShowCal(true)} style={styles.formInput}><Text>{date}</Text></TouchableOpacity>
            <Text style={styles.formLabel}>Type</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['public', 'restricted'] as const).map(t => (
                <TouchableOpacity key={t} onPress={() => setType(t)} style={[styles.filterPill, type === t && { backgroundColor: brand, borderColor: brand }]}>
                  <Text style={[styles.filterPillText, type === t && { color: '#fff' }]}>{t === 'public' ? 'Public' : 'Restricted'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
              <Text style={styles.formLabel}>Paid holiday</Text>
              <Switch value={paid} onValueChange={setPaid} trackColor={{ true: brand + '55', false: '#ccc' }} thumbColor={paid ? brand : '#f4f3f4'} />
            </View>

            {/* --- Applicable branches (empty = all) — mirrors web app ---- */}
            {branches.length > 0 && (
              <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.formLabel}>Applicable branches</Text>
                  <TouchableOpacity onPress={() => setBranchIds([])} disabled={allBranchesSelected}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: allBranchesSelected ? colors.onSurfaceTertiary : brand }}>
                      All branches
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2, marginBottom: 8 }}>
                  {allBranchesSelected
                    ? 'This holiday will apply to every branch.'
                    : `Only the selected ${branchIds.length === 1 ? 'branch' : 'branches'} will observe this holiday.`}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {branches.map(b => {
                    const selected = branchIds.includes(b.id);
                    return (
                      <TouchableOpacity
                        key={b.id}
                        onPress={() => toggleBranch(b.id)}
                        style={[
                          styles.filterPill,
                          selected && { backgroundColor: brand, borderColor: brand },
                        ]}
                      >
                        {selected && <Ionicons name="checkmark" size={12} color="#fff" style={{ marginRight: 4 }} />}
                        <Text style={[styles.filterPillText, selected && { color: '#fff' }]}>{b.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <TouchableOpacity onPress={submit} disabled={busy} style={[styles.primaryBtn, { backgroundColor: brand, marginTop: spacing.md }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save Holiday</Text>}
            </TouchableOpacity>
          </ScrollView>
          {showCal && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setShowCal(false)}>
              <Pressable style={styles.modalScrim} onPress={() => setShowCal(false)}>
                <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
                  <RNCalendar current={date} onDayPress={(d: any) => { setDate(d.dateString); setShowCal(false); }} />
                </Pressable>
              </Pressable>
            </Modal>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function LeaveTypeModal({ visible, onClose, onSaved, editing, existingPolicy, brand, branches }:
  { visible: boolean; onClose: () => void; onSaved: () => void; editing: LeaveType | null; existingPolicy?: LeavePolicy; brand: string; branches: { id: string; name: string }[] }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [paid, setPaid] = useState(true);
  const [halfDay, setHalfDay] = useState(true);
  const [needsApproval, setNeedsApproval] = useState(true);
  const [entitlement, setEntitlement] = useState('12');
  const [monthlyAccrual, setMonthlyAccrual] = useState(false);
  const [active, setActive] = useState(true);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(editing?.name || '');
      setCode(editing?.code || '');
      setPaid(editing?.paid ?? true);
      setHalfDay(editing?.allow_half_day ?? true);
      setNeedsApproval(editing?.requires_approval ?? true);
      setEntitlement(existingPolicy ? String(existingPolicy.annual_entitlement) : '12');
      setMonthlyAccrual(!!((editing as any)?.policy?.monthly_accrual ?? (existingPolicy as any)?.monthly_accrual));
      setActive(editing?.active ?? true);
      setBranchIds(Array.isArray(editing?.branch_ids) ? [...(editing!.branch_ids as string[])] : []);
    }
  }, [visible, editing, existingPolicy]);

  const toggleBranch = (id: string) => {
    setBranchIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const allBranchesSelected = branchIds.length === 0;

  const annual = parseFloat(entitlement) || 0;
  const perMonth = annual > 0 ? (annual / 12) : 0;

  const submit = async () => {
    if (!name.trim() || !code.trim()) { Alert.alert('Missing', 'Enter name and code.'); return; }
    setBusy(true);
    try {
      const body: any = {
        name, code: code.toUpperCase(), paid,
        allow_half_day: halfDay, requires_approval: needsApproval,
        monthly_accrual: monthlyAccrual,
        annual_entitlement: annual,
        active,
        branch_ids: branchIds,
      };
      let lt: any;
      if (editing) lt = await hrApi.updateLeaveType(editing.id, body);
      else lt = await hrApi.createLeaveType(body);
      // Best-effort — legacy policy endpoint keeps annual/monthly_accrual in sync.
      const policyId = editing ? existingPolicy?.id : lt?.policy?.id;
      if (policyId) {
        await hrApi.saveLeavePolicy(policyId, {
          annual_entitlement: annual,
          monthly_accrual: monthlyAccrual,
        } as any).catch(() => {});
      }
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={[styles.modalCard, { maxHeight: '90%' }]} onPress={e => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{editing ? 'Edit Leave Type' : 'New Leave Type'}</Text>
          <ScrollView>
            <Text style={styles.formLabel}>Name *</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Casual Leave" style={styles.formInput} />
            <Text style={styles.formLabel}>Code * (short)</Text>
            <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="CL" style={styles.formInput} maxLength={6} />
            <Text style={styles.formLabel}>Annual Entitlement (days)</Text>
            <TextInput value={entitlement} onChangeText={setEntitlement} keyboardType="numeric" style={styles.formInput} />

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>Monthly accrual (Annual ÷ 12 each month)</Text>
                {monthlyAccrual && annual > 0 && (
                  <Text style={{ fontSize: 11, color: colors.brandPrimary, marginTop: 2 }}>
                    Accrues {perMonth.toFixed(2)} day/month, credited on each month{"'"}s last day from the Joined Date.
                  </Text>
                )}
              </View>
              <Switch value={monthlyAccrual} onValueChange={setMonthlyAccrual} trackColor={{ true: brand + '55' }} thumbColor={monthlyAccrual ? brand : '#f4f3f4'} />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.formLabel}>Paid leave</Text>
              <Switch value={paid} onValueChange={setPaid} trackColor={{ true: brand + '55' }} thumbColor={paid ? brand : '#f4f3f4'} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.formLabel}>Allow half-day</Text>
              <Switch value={halfDay} onValueChange={setHalfDay} trackColor={{ true: brand + '55' }} thumbColor={halfDay ? brand : '#f4f3f4'} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.formLabel}>Requires approval</Text>
              <Switch value={needsApproval} onValueChange={setNeedsApproval} trackColor={{ true: brand + '55' }} thumbColor={needsApproval ? brand : '#f4f3f4'} />
            </View>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>Active</Text>
                <Text style={{ fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 }}>
                  {active ? 'Employees can request this leave type.' : 'Hidden from new requests (existing history unaffected).'}
                </Text>
              </View>
              <Switch value={active} onValueChange={setActive} trackColor={{ true: brand + '55' }} thumbColor={active ? brand : '#f4f3f4'} />
            </View>

            {/* --- Applicable branches (empty = all) — mirrors web app ---- */}
            {branches.length > 0 && (
              <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.formLabel}>Applicable branches</Text>
                  <TouchableOpacity onPress={() => setBranchIds([])} disabled={allBranchesSelected}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: allBranchesSelected ? colors.onSurfaceTertiary : brand }}>
                      All branches
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2, marginBottom: 8 }}>
                  {allBranchesSelected
                    ? 'This leave type is available to staff across all branches.'
                    : `Only staff of the selected ${branchIds.length === 1 ? 'branch' : 'branches'} can request this leave.`}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {branches.map(b => {
                    const selected = branchIds.includes(b.id);
                    return (
                      <TouchableOpacity
                        key={b.id}
                        onPress={() => toggleBranch(b.id)}
                        style={[
                          styles.filterPill,
                          selected && { backgroundColor: brand, borderColor: brand },
                        ]}
                      >
                        {selected && <Ionicons name="checkmark" size={12} color="#fff" style={{ marginRight: 4 }} />}
                        <Text style={[styles.filterPillText, selected && { color: '#fff' }]}>{b.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
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

// =====================================================================
// SHARED COMPONENTS
// =====================================================================
function Empty({ icon, title, hint }: { icon: keyof typeof Ionicons.glyphMap; title: string; hint: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={colors.onSurfaceTertiary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { borderColor: color + '55', backgroundColor: color + '12' }]}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  tabPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  tabLabel: { fontSize: 12, fontWeight: '700' },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  dateText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.onSurface },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },

  card: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  badgeText: { fontSize: 10, fontWeight: '800' },

  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: colors.onSurface },

  filterPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  filterPillText: { fontSize: 12, fontWeight: '600', color: colors.onSurface },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md, marginBottom: spacing.md },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  sectionTitle: { fontSize: 12, fontWeight: '800', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },

  rhCounter: { alignItems: 'flex-end' },
  rhCounterLabel: { fontSize: 10, color: colors.onSurfaceTertiary, textTransform: 'uppercase', fontWeight: '700' },
  rhCounterValue: { fontSize: 18, fontWeight: '800' },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  emptyHint: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center' },

  availableNum: { fontSize: 24, fontWeight: '800' },

  modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, maxHeight: '92%' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.md },
  modalClose: { alignItems: 'center', padding: 12, marginTop: 8 },
  modalCloseText: { color: colors.onSurfaceTertiary, fontWeight: '700' },

  formLabel: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: spacing.sm, marginBottom: 6 },
  formInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, fontSize: 14, color: colors.onSurface, backgroundColor: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
});
