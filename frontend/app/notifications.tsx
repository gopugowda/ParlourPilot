/**
 * Notifications inbox — client-side aggregator.
 *
 * The shared backend does not yet expose a `/notifications` endpoint, so this
 * screen synthesises alerts by fanning out to endpoints we already own and
 * consolidating them into a single bell-inbox with per-user read state.
 *
 * Signals aggregated:
 *   • Low stock       — /reports/summary.low_stock              (any role)
 *   • Expiring members — /reports/summary.expiring_members       (any role)
 *   • End-of-day summary — /reports/summary.today                (owner-only)
 *   • Unpaid payroll (last month) — /reports/staff-performance   (owner-only)
 *   • Cancelled appointments today — /appointments?date=today    (any role)
 *
 * Read state is stored per user in AsyncStorage under `pp_notif_read_<userId>`
 * as a set of stable IDs so a low-stock alert isn't marked unread again the
 * next time the user opens the app.
 *
 * The bell badge in the dashboard subscribes to `useUnreadCount()` which
 * re-runs on every focus.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtINR } from '@/src/theme';

/** Safe wrapper — some Android devices without a haptic engine throw synchronously. */
function safeHaptic() {
  try {
    if (Platform.OS === 'web') return;
    Haptics.selectionAsync().catch(() => {});
  } catch {}
}

type NotifSeverity = 'info' | 'warning' | 'error' | 'success';
type Notif = {
  id: string;            // stable — used for the read-set
  title: string;
  body: string;
  icon: any;             // Ionicons name
  severity: NotifSeverity;
  route?: string;        // deep-link tap
  routeParams?: any;
  ts: number;            // milliseconds — sort key
};

const STORAGE_PREFIX = 'pp_notif_read_';

async function loadReadSet(userId: string | undefined): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + userId);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}
async function saveReadSet(userId: string | undefined, set: Set<string>) {
  if (!userId) return;
  try { await AsyncStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(Array.from(set))); } catch {}
}

/** Fan out to all supported endpoints and consolidate into the Notif shape.
 *  Every call is guarded so a single failing endpoint doesn't blank the inbox.
 *  Wrapped in an outer try so absolutely nothing bubbles up to the caller. */
export async function fetchAllSignals(isOwner: boolean): Promise<Notif[]> {
  const now = Date.now();
  const out: Notif[] = [];
  try {
    // Reports summary (low_stock, expiring_members, today).
    const summary: any = await api('/reports/summary').catch(() => null);
    if (summary && typeof summary === 'object') {
      const lowStock = Array.isArray(summary.low_stock) ? summary.low_stock : [];
      lowStock.forEach((s: any) => {
        if (!s || typeof s !== 'object') return;
        out.push({
          id: `low_stock:${s.id || s.name || 'unknown'}`,
          title: 'Low stock',
          body: `${s.name || 'Item'} is low${typeof s.qty === 'number' ? ` (${s.qty} left)` : ''}.`,
          icon: 'cube-outline',
          severity: 'warning',
          route: '/manage/stock',
          ts: now,
        });
      });
      const expMembers = Array.isArray(summary.expiring_members) ? summary.expiring_members : [];
      expMembers.forEach((m: any) => {
        if (!m || typeof m !== 'object') return;
        const daysLeft = m.days_left;
        const isExpired = typeof daysLeft === 'number' && daysLeft < 0;
        out.push({
          id: `exp_member:${m.id || 'unknown'}:${m.days_left ?? 'na'}`,
          title: isExpired ? 'Member expired' : 'Membership expiring',
          body: isExpired
            ? `${m.name || 'Member'}${m.name ? "'s" : ''} membership has expired. Renew to keep them on the discount tier.`
            : `${m.name || 'Member'}${m.name ? "'s" : ''} membership expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
          icon: 'star-outline',
          severity: isExpired ? 'error' : 'warning',
          route: '/manage/members',
          routeParams: { filter: 'expiring' },
          ts: now,
        });
      });

    // End-of-day summary — OWNER only (financials).
    if (isOwner && summary.today && typeof summary.today.total === 'number') {
      const today = summary.today;
      const ymd = new Date().toISOString().slice(0, 10);
      out.push({
        id: `eod:${ymd}`,
        title: `Today's summary`,
        body: `Revenue ${fmtINR(today.total || 0)} · ${today.count || 0} bills · Cash ${fmtINR(today.cash || 0)}${
          typeof today.net === 'number' ? ` · Net ${fmtINR(today.net)}` : ''
        }`,
        icon: 'stats-chart-outline',
        severity: (today.net ?? today.total ?? 0) < 0 ? 'error' : 'success',
        route: '/manage/report',
        ts: now,
      });
    }
  }

    // Cancelled appointments today — quick filter on the list endpoint.
    const today = new Date().toISOString().slice(0, 10);
    const apts: any = await api(`/appointments?from_date=${today}&to_date=${today}`).catch(() => null);
    const cancelled = Array.isArray(apts)
      ? apts.filter((a: any) => a && (a.status || '').toLowerCase() === 'cancelled')
      : Array.isArray(apts?.items) ? apts.items.filter((a: any) => a && (a.status || '').toLowerCase() === 'cancelled') : [];
    cancelled.forEach((a: any) => {
      if (!a || typeof a !== 'object') return;
      let ts = now;
      try { ts = new Date(a.updated_at || a.scheduled_start || now).getTime() || now; } catch { ts = now; }
      let timeStr = '';
      if (a.scheduled_start) {
        try { timeStr = ` (${new Date(a.scheduled_start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})`; } catch {}
      }
      out.push({
        id: `apt_cancel:${a.id || Math.random()}`,
        title: 'Appointment cancelled',
        body: `${a.customer_name || 'A customer'} cancelled${a.beautician_name ? ` with ${a.beautician_name}` : ''}${timeStr}.`,
        icon: 'close-circle-outline',
        severity: 'warning',
        route: '/manage/appointments',
        ts,
      });
    });

    // Unpaid payroll — owner only, month-end nudge.
    if (isOwner) {
      const perf: any = await api('/reports/staff-performance?preset=last_month').catch(() => null);
      const rows = Array.isArray(perf?.rows) ? perf.rows : [];
      const unpaid = rows.filter((r: any) => r && (r.net_payable || 0) > 0 && !r.paid);
      if (unpaid.length > 0) {
        const total = unpaid.reduce((s: number, r: any) => s + (r.net_payable || 0), 0);
        out.push({
          id: `unpaid_payroll:${perf?.from || 'x'}:${perf?.to || 'y'}`,
          title: `${unpaid.length} unpaid payslip${unpaid.length > 1 ? 's' : ''}`,
          body: `${fmtINR(total)} owed to team${perf?.from && perf?.to ? ` for ${perf.from} → ${perf.to}` : ''}. Tap to review and mark paid.`,
          icon: 'wallet-outline',
          severity: 'warning',
          route: '/manage/payroll-report',
          ts: now,
        });
      }
    }
  } catch {
    // Never let the notifications aggregator throw — the screen always renders.
  }

  // Sort newest first.
  return out.sort((a, b) => b.ts - a.ts);
}

/** Reusable hook — bell badge in dashboard uses this. */
export function useUnreadCount(): number {
  const { user } = useAuth();
  const isOwner = !!user?.is_owner;
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) { setCount(0); return; }
    const [read, signals] = await Promise.all([
      loadReadSet(user.id),
      fetchAllSignals(isOwner),
    ]);
    const unread = signals.filter(n => !read.has(n.id));
    setCount(unread.length);
  }, [user, isOwner]);

  useEffect(() => { refresh(); }, [refresh]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return count;
}

const SEVERITY: Record<NotifSeverity, { fg: string; bg: string; iconTint: string }> = {
  info:    { fg: colors.info,    bg: '#E3EDF7',            iconTint: '#3F6C9C' },
  warning: { fg: '#B8860B',      bg: '#FFF6E0',            iconTint: '#B8860B' },
  error:   { fg: colors.error,   bg: '#FDECEC',            iconTint: colors.error },
  success: { fg: colors.success, bg: '#DDF3E4',            iconTint: colors.success },
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isOwner = !!user?.is_owner;

  const [items, setItems] = useState<Notif[]>([]);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [read, signals] = await Promise.all([
        loadReadSet(user?.id),
        fetchAllSignals(isOwner),
      ]);
      setReadSet(read);
      setItems(signals);
    } catch {} finally { if (!silent) setLoading(false); }
  }, [user, isOwner]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(true); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };

  const unread = useMemo(() => items.filter(n => !readSet.has(n.id)), [items, readSet]);
  const readList = useMemo(() => items.filter(n => readSet.has(n.id)), [items, readSet]);

  const markAsRead = async (id: string) => {
    const next = new Set(readSet); next.add(id); setReadSet(next);
    await saveReadSet(user?.id, next);
  };
  const markAllRead = async () => {
    safeHaptic();
    const next = new Set(items.map(n => n.id));
    setReadSet(next);
    await saveReadSet(user?.id, next);
  };
  const tap = async (n: Notif) => {
    safeHaptic();
    await markAsRead(n.id);
    if (n.route) {
      try {
        if (n.routeParams) {
          router.push({ pathname: n.route as any, params: n.routeParams });
        } else {
          router.push(n.route as any);
        }
      } catch {
        // Route may be invalid on the current bundle — swallow to avoid crash.
      }
    }
  };

  return (
    <View style={styles.root} testID="notifications-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Notifications</Text>
          <Text style={styles.headerSub}>
            {unread.length > 0 ? `${unread.length} unread · ${items.length} total` : `${items.length} total`}
          </Text>
        </View>
        {unread.length > 0 && (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn} testID="mark-all-read">
            <Ionicons name="checkmark-done" size={14} color="#fff" />
            <Text style={styles.markAllText}>Mark all</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyCard}>
            <Ionicons name="notifications-off-outline" size={44} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>All clear</Text>
            <Text style={styles.emptyBody}>
              No alerts right now. We&apos;ll ping you when stock runs low, memberships expire, or appointments get cancelled.
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
        >
          {unread.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Unread</Text>
              {unread.map(n => <NotifCard key={n.id} n={n} unread onPress={() => tap(n)} testID={`notif-${n.id}`} />)}
            </>
          )}
          {readList.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: unread.length ? spacing.md : 0 }]}>Earlier</Text>
              {readList.map(n => <NotifCard key={n.id} n={n} unread={false} onPress={() => tap(n)} testID={`notif-${n.id}`} />)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function NotifCard({ n, unread, onPress, testID }: { n: Notif; unread: boolean; onPress: () => void; testID?: string }) {
  const sev = SEVERITY[n.severity];
  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.card, unread && { borderColor: sev.fg, borderWidth: 1.5, backgroundColor: sev.bg + '55' }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.cardIcon, { backgroundColor: sev.bg }]}>
        <Ionicons name={n.icon} size={20} color={sev.iconTint} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, unread && { color: colors.onSurface }]} numberOfLines={1}>{n.title}</Text>
          {unread && <View style={[styles.unreadDot, { backgroundColor: sev.fg }]} />}
        </View>
        <Text style={styles.cardBody} numberOfLines={3}>{n.body}</Text>
      </View>
      {n.route && <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />}
    </TouchableOpacity>
  );
}

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
  markAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  markAllText: { fontSize: 11, fontWeight: '800', color: '#fff' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyCard: { alignItems: 'center', gap: spacing.sm, maxWidth: 320 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.onSurface, marginTop: spacing.sm },
  emptyBody: { fontSize: 13, color: colors.onSurfaceSecondary, textAlign: 'center', lineHeight: 20 },

  sectionTitle: { fontSize: 11, fontWeight: '800', color: colors.onSurfaceTertiary, letterSpacing: 1.2, textTransform: 'uppercase' },

  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    ...shadows.card,
  },
  cardIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.onSurfaceSecondary },
  cardBody: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 3, lineHeight: 17 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
});
