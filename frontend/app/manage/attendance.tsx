import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';
import {
  type AttendanceConfig, type MyTodayEntry, type AttendanceAction,
  getFreshLocation, postAction, loadConfig, loadMyToday, fmtLocalTime,
} from '@/src/utils/attendance';

// Auto-refresh interval — keeps mobile in sync when the shift is toggled from web.
const POLL_MS = 30_000;

const fmtTime = (iso: string) => fmtLocalTime(iso);

const ACTION_META: Record<AttendanceAction, { label: string; color: string; icon: any }> = {
  check_in:    { label: 'Checked In',   color: colors.success, icon: 'log-in-outline' },
  check_out:   { label: 'Checked Out',  color: colors.error,   icon: 'log-out-outline' },
  break_start: { label: 'Break Start',  color: colors.warning, icon: 'pause-outline' },
  break_end:   { label: 'Break End',    color: colors.info,    icon: 'play-outline' },
};

export default function AttendanceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [config, setConfig] = useState<AttendanceConfig | null>(null);
  const [today, setToday] = useState<MyTodayEntry>({ status: 'out', logs: [] });
  const [busy, setBusy] = useState<AttendanceAction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [polling, setPolling] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (silent) setPolling(true);
    const [c, t] = await Promise.all([loadConfig(), loadMyToday()]);
    setConfig(c || {});
    setToday(t || { status: 'out', logs: [] });
    if (silent) setPolling(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // Auto-poll every 30s so status reflects check-outs performed on the web app.
  // Only polls while the screen is focused (mount/unmount via useFocusEffect wrapper).
  const pollRef = useRef<any>(null);
  useFocusEffect(useCallback(() => {
    pollRef.current = setInterval(() => { refresh(true); }, POLL_MS);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [refresh]));

  const doAction = async (action: AttendanceAction) => {
    setBusy(action);
    try {
      const loc = await getFreshLocation();
      // Backend enforces gating; still, warn early if GPS is denied on gated tenants.
      if (!loc && config?.gating_active) {
        Alert.alert('Location required', "Enable GPS so we can verify you're at the salon before punching.");
        return;
      }
      const res = await postAction(action, loc);
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await refresh();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        // Backend messages already user-friendly per spec — surface directly.
        Alert.alert('Attendance', res.error || 'Failed to record attendance.');
      }
    } finally { setBusy(null); }
  };

  const status = today.status;
  const isIn    = status === 'in';
  const onBreak = status === 'break';

  const btnDisabled = (action: AttendanceAction): boolean => {
    if (busy) return true;
    if (action === 'check_in')    return isIn || onBreak;
    if (action === 'check_out')   return !isIn && !onBreak;
    if (action === 'break_start') return !isIn;         // only while checked in
    if (action === 'break_end')   return !onBreak;      // only while on break
    return false;
  };

  return (
    <View style={styles.root} testID="attendance-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.headerTitle}>Attendance</Text>
            {polling && <ActivityIndicator size="small" color={colors.brandPrimary} testID="attendance-polling" />}
          </View>
          {config?.branch_name && (
            <Text style={styles.headerSub}>
              {config.branch_name}{config.gating_active ? ` · Geofence ${config.check_in_radius_m}m` : ' · Geofence off'}
            </Text>
          )}
        </View>
        {isAdmin && (
          <TouchableOpacity onPress={() => router.push('/manage/attendance-report')} style={styles.reportBtn} testID="open-report">
            <Ionicons name="bar-chart-outline" size={18} color={colors.brandPrimary} />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}
      >
        {/* Status card */}
        <View style={[styles.statusCard, {
          borderColor: isIn ? colors.success : onBreak ? colors.warning : colors.borderStrong,
        }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={[styles.dot, { backgroundColor: isIn ? colors.success : onBreak ? colors.warning : colors.onSurfaceTertiary }]} />
            <Text style={styles.statusText}>
              {isIn ? 'On the clock' : onBreak ? 'On break' : 'Checked out'}
            </Text>
          </View>
          {config?.gating_active === false && (
            <Text style={styles.subtleNote}>Geofence disabled for this branch — check-ins won&rsquo;t be gated.</Text>
          )}
        </View>

        {/* Action buttons — 2×2 grid */}
        <View style={styles.grid}>
          <ActionButton
            label="Check In"
            icon="log-in-outline"
            color={colors.success}
            disabled={btnDisabled('check_in')}
            busy={busy === 'check_in'}
            onPress={() => doAction('check_in')}
            testID="btn-check-in"
          />
          <ActionButton
            label="Start Break"
            icon="pause-outline"
            color={colors.warning}
            disabled={btnDisabled('break_start')}
            busy={busy === 'break_start'}
            onPress={() => doAction('break_start')}
            testID="btn-break-start"
          />
          <ActionButton
            label="End Break"
            icon="play-outline"
            color={colors.info}
            disabled={btnDisabled('break_end')}
            busy={busy === 'break_end'}
            onPress={() => doAction('break_end')}
            testID="btn-break-end"
          />
          <ActionButton
            label="Check Out"
            icon="log-out-outline"
            color={colors.error}
            disabled={btnDisabled('check_out')}
            busy={busy === 'check_out'}
            onPress={() => doAction('check_out')}
            testID="btn-check-out"
          />
        </View>

        {/* Today's punches */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Today&rsquo;s punches</Text>
          {today.logs.length === 0 ? (
            <Text style={styles.empty}>No punches yet.</Text>
          ) : today.logs.map((l, i) => {
            const meta = ACTION_META[l.action] || ACTION_META.check_in;
            return (
              <View key={l.id || i} style={styles.logRow} testID={`log-row-${i}`}>
                <Ionicons name={meta.icon} size={16} color={meta.color} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.logAction}>{meta.label}</Text>
                  <Text style={styles.logMeta}>
                    {fmtTime(l.timestamp)}
                    {typeof l.distance_m === 'number' && ` · ${Math.round(l.distance_m)}m`}
                    {l.within_geofence === false && ' · outside geofence'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function ActionButton({
  label, icon, color, disabled, busy, onPress, testID,
}: {
  label: string; icon: any; color: string;
  disabled?: boolean; busy?: boolean; onPress: () => void; testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionBtn, { borderColor: color, opacity: disabled ? 0.45 : 1 }]}
      testID={testID}
    >
      {busy ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={26} color={color} />}
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  reportBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },

  statusCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.surfaceSecondary, gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  subtleNote: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  actionBtn: {
    flexGrow: 1, flexBasis: '46%', minHeight: 100,
    borderWidth: 2, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: spacing.md, backgroundColor: colors.surface,
    ...shadows.card,
  },
  actionLabel: { fontSize: 14, fontWeight: '800' },

  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontSize: 12 },
  logRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  logAction: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  logMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
});
