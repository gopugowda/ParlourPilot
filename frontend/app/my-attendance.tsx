/**
 * My Attendance — staff self-service screen.
 *
 * Every logged-in salon user (staff, admin, owner) can see this. Identity
 * is derived server-side (never send an employee_id).
 *
 * Sections:
 *   1. History (last 30 days) with Request Correction per row.
 *   2. My correction requests (with cancel while pending).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, RefreshControl, Modal, Pressable, Platform,
  KeyboardAvoidingView, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, shadows } from '@/src/theme';
import {
  attendanceApi, fmtLocalTimeISO, localDateToIso, readLocalHM, safeParseISO,
  type SelfHistoryRow, type CorrectionRequest,
} from '@/src/api/attendance';

const fmtDay = (ymd: string) => {
  const d = safeParseISO(ymd + 'T00:00:00');
  if (!d) return ymd;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
};
const isFuture = (ymd: string) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(ymd + 'T00:00:00');
  return d.getTime() > t.getTime();
};

const statusColor = (s: string) => {
  switch (s) {
    case 'present': return colors.success;
    case 'incomplete': return colors.warning;
    case 'absent': return colors.onSurfaceTertiary;
    default: return colors.onSurfaceTertiary;
  }
};
const statusLabel = (s: string) => {
  if (s === 'present') return 'Present';
  if (s === 'incomplete') return 'Incomplete';
  return 'No record';
};

// ---------------------------------------------------------------------------
// Small inline time picker (native uses @react-native-community/datetimepicker,
// web falls back to a plain HH:MM 24-hour text input which is universally
// understood and quick to type on a physical keyboard).
// ---------------------------------------------------------------------------
function TimeField({
  label, value, onChange, placeholder, testID,
}: {
  label: string;
  value: { hh: number; mm: number } | null;
  onChange: (v: { hh: number; mm: number } | null) => void;
  placeholder?: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ? pad2(value.hh) + ':' + pad2(value.mm) : '');
  useEffect(() => { setText(value ? pad2(value.hh) + ':' + pad2(value.mm) : ''); }, [value]);

  const applyText = (t: string) => {
    setText(t);
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) { onChange(null); return; }
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    onChange({ hh, mm });
  };

  const display = value ? formatHM(value.hh, value.mm) : (placeholder || 'Select time');

  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          testID={testID}
          value={text}
          onChangeText={applyText}
          placeholder={placeholder || 'HH:MM (24h)'}
          placeholderTextColor={colors.onSurfaceTertiary}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={5}
          style={styles.timeInput}
        />
        {value && (
          <TouchableOpacity onPress={() => { onChange(null); setText(''); }}>
            <Text style={styles.clearBtn}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const now = new Date();
  const seed = new Date(now.getFullYear(), now.getMonth(), now.getDate(), value?.hh ?? 9, value?.mm ?? 0, 0, 0);
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity testID={testID} onPress={() => setOpen(true)} style={styles.timeInput}>
        <Text style={{ color: value ? colors.onSurface : colors.onSurfaceTertiary, fontSize: 14, fontWeight: '600' }}>{display}</Text>
      </TouchableOpacity>
      {value && (
        <TouchableOpacity onPress={() => onChange(null)}>
          <Text style={styles.clearBtn}>Clear</Text>
        </TouchableOpacity>
      )}
      {open && (
        Platform.OS === 'ios' ? (
          <Modal transparent animationType="fade" visible onRequestClose={() => setOpen(false)}>
            <Pressable style={styles.dtBackdrop} onPress={() => setOpen(false)}>
              <Pressable style={styles.dtSheet} onPress={() => {}}>
                <View style={styles.handle} />
                <Text style={styles.dtTitle}>{label}</Text>
                <DateTimePicker
                  value={seed}
                  mode="time"
                  display="spinner"
                  onChange={(_, d) => { if (d) onChange({ hh: d.getHours(), mm: d.getMinutes() }); }}
                />
                <TouchableOpacity style={styles.dtDone} onPress={() => setOpen(false)}>
                  <Text style={styles.dtDoneText}>Done</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
        ) : (
          <DateTimePicker
            value={seed}
            mode="time"
            display="default"
            onChange={(evt, d) => {
              setOpen(false);
              if (evt?.type === 'set' && d) onChange({ hh: d.getHours(), mm: d.getMinutes() });
            }}
          />
        )
      )}
    </View>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatHM = (hh: number, mm: number) => {
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

// ---------------------------------------------------------------------------
export default function MyAttendanceScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [linked, setLinked] = useState(true);
  const [history, setHistory] = useState<SelfHistoryRow[]>([]);
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [tab, setTab] = useState<'history' | 'requests'>('history');

  const [correctingRow, setCorrectingRow] = useState<SelfHistoryRow | null>(null);
  const [inTime, setInTime] = useState<{ hh: number; mm: number } | null>(null);
  const [outTime, setOutTime] = useState<{ hh: number; mm: number } | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, r] = await Promise.all([
        attendanceApi.selfHistory(30),
        attendanceApi.selfCorrections(),
      ]);
      setLinked(h.linked);
      setHistory(h.rows || []);
      setRequests(r.rows || []);
    } catch (e: any) {
      Alert.alert('Load failed', e.message || String(e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const openCorrection = (row: SelfHistoryRow) => {
    if (isFuture(row.date)) {
      Alert.alert('Not allowed', 'You cannot submit a correction for a future date.');
      return;
    }
    if (row.correction && row.correction.status === 'pending') return; // gated on UI
    setCorrectingRow(row);
    setInTime(readLocalHM(row.clock_in));
    setOutTime(readLocalHM(row.clock_out));
    setReason(''); setNote('');
  };

  const submitCorrection = async () => {
    if (!correctingRow) return;
    if (!inTime && !outTime) { Alert.alert('Missing time', 'Enter at least one of Clock In or Clock Out.'); return; }
    if (inTime && outTime) {
      const iM = inTime.hh * 60 + inTime.mm;
      const oM = outTime.hh * 60 + outTime.mm;
      if (oM < iM) { Alert.alert('Invalid range', 'Clock Out cannot be before Clock In.'); return; }
    }
    if (!reason.trim()) { Alert.alert('Reason required', 'Please enter a reason for the correction.'); return; }
    setSaving(true);
    try {
      const body = {
        attendance_date: correctingRow.date,
        requested_clock_in: inTime ? localDateToIso(correctingRow.date, inTime.hh, inTime.mm) : null,
        requested_clock_out: outTime ? localDateToIso(correctingRow.date, outTime.hh, outTime.mm) : null,
        reason: reason.trim(),
        employee_note: note.trim() || undefined,
      };
      await attendanceApi.submitSelfCorrection(body);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCorrectingRow(null);
      Alert.alert('Submitted', 'Attendance correction request submitted successfully.');
      await load();
    } catch (e: any) {
      Alert.alert('Submit failed', e.message || String(e));
    } finally { setSaving(false); }
  };

  const cancelRequest = (r: CorrectionRequest) => {
    Alert.alert('Cancel request?', `Cancel your correction request for ${fmtDay(r.attendance_date)}?`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel Request', style: 'destructive', onPress: async () => {
        try { await attendanceApi.cancelSelfCorrection(r.id); load(); }
        catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
      }},
    ]);
  };

  const pendingCount = useMemo(() => requests.filter(r => r.status === 'pending').length, [requests]);

  return (
    <View style={styles.root} testID="my-attendance">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Attendance</Text>
          <Text style={styles.headerSub}>Last 30 days · Request corrections</Text>
        </View>
      </SafeAreaView>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === 'history' && styles.tabActive]}
          onPress={() => setTab('history')}
          testID="tab-history"
        >
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'requests' && styles.tabActive]}
          onPress={() => setTab('requests')}
          testID="tab-requests"
        >
          <Text style={[styles.tabText, tab === 'requests' && styles.tabTextActive]}>
            Requests{pendingCount ? ` (${pendingCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : !linked ? (
        <View style={styles.empty}>
          <Ionicons name="person-remove-outline" size={48} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>No staff profile linked</Text>
          <Text style={styles.emptySub}>Ask your salon owner to add you as a team member so your punches show up here.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {tab === 'history' ? (
            history.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={40} color={colors.onSurfaceTertiary} />
                <Text style={styles.emptyTitle}>No records yet</Text>
                <Text style={styles.emptySub}>Once you start punching in, your last 30 days show up here.</Text>
              </View>
            ) : (
              history.map(row => {
                const inLbl = fmtLocalTimeISO(row.clock_in);
                const outLbl = fmtLocalTimeISO(row.clock_out);
                const isPending = row.correction && row.correction.status === 'pending';
                const disabled = isFuture(row.date);
                return (
                  <View key={row.date} style={styles.card} testID={`hist-${row.date}`}>
                    <View style={styles.cardHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dayName}>{fmtDay(row.date)}</Text>
                        <Text style={styles.dayMeta}>{row.date}</Text>
                      </View>
                      <View style={[styles.statusChip, { borderColor: statusColor(row.status) + '55', backgroundColor: statusColor(row.status) + '18' }]}>
                        <Text style={[styles.statusText, { color: statusColor(row.status) }]}>{statusLabel(row.status)}</Text>
                      </View>
                      {row.corrected && (
                        <View style={styles.correctedTag}>
                          <Ionicons name="checkmark-circle" size={11} color={colors.brandPrimary} />
                          <Text style={styles.correctedTagText}>corrected</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.timeRow}>
                      <View style={styles.timeBox}>
                        <Text style={styles.timeLbl}>Clock In</Text>
                        <Text style={styles.timeVal}>{inLbl}</Text>
                      </View>
                      <View style={styles.timeBox}>
                        <Text style={styles.timeLbl}>Clock Out</Text>
                        <Text style={styles.timeVal}>{outLbl}</Text>
                      </View>
                    </View>
                    {isPending ? (
                      <View style={[styles.pendingBadge, { alignSelf: 'flex-start' }]}>
                        <Ionicons name="hourglass-outline" size={12} color={colors.warning} />
                        <Text style={styles.pendingText}>Correction pending</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => openCorrection(row)}
                        disabled={disabled}
                        style={[styles.requestBtn, disabled && { opacity: 0.4 }]}
                        testID={`request-${row.date}`}
                      >
                        <Ionicons name="create-outline" size={14} color={colors.brandPrimary} />
                        <Text style={styles.requestBtnText}>Request Correction</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )
          ) : (
            // Requests tab
            requests.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="receipt-outline" size={40} color={colors.onSurfaceTertiary} />
                <Text style={styles.emptyTitle}>No correction requests yet</Text>
                <Text style={styles.emptySub}>Any correction you submit will appear here with its status.</Text>
              </View>
            ) : (
              requests.map(r => {
                const chipColor = r.status === 'pending' ? colors.warning
                  : r.status === 'approved' ? colors.success
                  : r.status === 'rejected' ? colors.error
                  : colors.onSurfaceTertiary;
                return (
                  <View key={r.id} style={styles.card} testID={`req-${r.id}`}>
                    <View style={styles.cardHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dayName}>{fmtDay(r.attendance_date)}</Text>
                        <Text style={styles.dayMeta}>Submitted {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</Text>
                      </View>
                      <View style={[styles.statusChip, { backgroundColor: chipColor + '18', borderColor: chipColor + '55' }]}>
                        <Text style={[styles.statusText, { color: chipColor }]}>{r.status.toUpperCase()}</Text>
                      </View>
                    </View>
                    <View style={styles.timeRow}>
                      <View style={styles.timeBox}>
                        <Text style={styles.timeLbl}>Requested In</Text>
                        <Text style={styles.timeVal}>{fmtLocalTimeISO(r.requested_clock_in)}</Text>
                      </View>
                      <View style={styles.timeBox}>
                        <Text style={styles.timeLbl}>Requested Out</Text>
                        <Text style={styles.timeVal}>{fmtLocalTimeISO(r.requested_clock_out)}</Text>
                      </View>
                    </View>
                    {r.reason ? <Text style={styles.detail}><Text style={{ fontWeight: '700' }}>Reason: </Text>{r.reason}</Text> : null}
                    {r.status === 'approved' && r.reviewed_by_name ? (
                      <Text style={[styles.detail, { color: colors.success }]}>Approved by {r.reviewed_by_name}</Text>
                    ) : null}
                    {r.status === 'rejected' && r.rejection_reason ? (
                      <Text style={[styles.detail, { color: colors.error }]}>Rejected: {r.rejection_reason}</Text>
                    ) : null}
                    {r.status === 'pending' && (
                      <TouchableOpacity onPress={() => cancelRequest(r)} style={[styles.requestBtn, { borderColor: colors.error + '55' }]} testID={`cancel-${r.id}`}>
                        <Ionicons name="close-circle-outline" size={14} color={colors.error} />
                        <Text style={[styles.requestBtnText, { color: colors.error }]}>Cancel request</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )
          )}
        </ScrollView>
      )}

      {/* ============ Request Correction Modal ============ */}
      <Modal visible={!!correctingRow} transparent animationType="slide" onRequestClose={() => setCorrectingRow(null)}>
        {/*
          Keyboard handling — the keypad used to slide up over the Reason /
          Note fields and hide the Submit button. Wrapping the sheet in a
          KeyboardAvoidingView with `padding` on iOS and `height` on Android
          shifts the layout so all fields (and the button) stay reachable.
          The inner ScrollView is what actually lets the user scroll to the
          Submit button while typing.
        */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.avoider}
          keyboardVerticalOffset={0}
        >
          <Pressable style={styles.backdrop} onPress={() => { Keyboard.dismiss(); setCorrectingRow(null); }}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Request Correction</Text>
              {correctingRow && (
                <Text style={styles.sheetSub}>{fmtDay(correctingRow.date)} · {correctingRow.date}</Text>
              )}
              <ScrollView
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <TimeField label="Requested Clock In" value={inTime} onChange={setInTime} placeholder="—" testID="corr-in" />
                  <TimeField label="Requested Clock Out" value={outTime} onChange={setOutTime} placeholder="—" testID="corr-out" />
                </View>
                <View>
                  <Text style={styles.fieldLabel}>Reason *</Text>
                  <TextInput
                    testID="corr-reason"
                    value={reason}
                    onChangeText={setReason}
                    placeholder="e.g. Forgot to clock in"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.textArea}
                    multiline
                  />
                </View>
                <View>
                  <Text style={styles.fieldLabel}>Additional note (optional)</Text>
                  <TextInput
                    testID="corr-note"
                    value={note}
                    onChangeText={setNote}
                    placeholder="Anything else your manager should know"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.textArea}
                    multiline
                  />
                </View>
                <TouchableOpacity
                  onPress={submitCorrection}
                  disabled={saving}
                  style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
                  testID="corr-submit"
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Submit request</Text>}
                </TouchableOpacity>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary },
  tab: { paddingVertical: 10, paddingHorizontal: 14 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.brandPrimary },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.onSurfaceSecondary },
  tabTextActive: { color: colors.brandPrimary },

  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface, marginTop: 8 },
  emptySub: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center' },

  card: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayName: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  dayMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: '800' },
  correctedTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.brandTertiary },
  correctedTagText: { fontSize: 9, fontWeight: '800', color: colors.brandPrimary },

  timeRow: { flexDirection: 'row', gap: spacing.sm },
  timeBox: { flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, padding: 8 },
  timeLbl: { fontSize: 10, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase' },
  timeVal: { fontSize: 14, fontWeight: '800', color: colors.onSurface, marginTop: 2 },

  requestBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary + '55', backgroundColor: colors.brandPrimary + '10' },
  requestBtnText: { fontSize: 12, fontWeight: '800', color: colors.brandPrimary },

  pendingBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.warning + '18', borderWidth: 1, borderColor: colors.warning + '55' },
  pendingText: { fontSize: 11, fontWeight: '800', color: colors.warning },
  detail: { fontSize: 12, color: colors.onSurfaceSecondary },

  // Modal
  avoider: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  sheetSub: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center', marginTop: -4 },

  fieldLabel: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  timeInput: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, color: colors.onSurface, fontWeight: '600',
  },
  clearBtn: { color: colors.error, fontSize: 11, fontWeight: '700', marginTop: 4 },
  textArea: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, minHeight: 60, color: colors.onSurface, textAlignVertical: 'top' },
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm, ...shadows.card },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // iOS time picker sheet
  dtBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dtSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
  dtTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  dtDone: { backgroundColor: colors.brandPrimary, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' },
  dtDoneText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
