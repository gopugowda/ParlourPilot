import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api, appointmentApi } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing } from '@/src/theme';
import { useFilterState } from '@/src/hooks/useFilterState';
import { FilterHeaderButton } from '@/src/components/FilterSheet';
import { resolveRange, localDateKey, type RangePreset } from '@/src/utils/dateRange';
import SendConfirmationSheet, { type SendConfirmationAppointment } from '@/src/components/SendConfirmationSheet';
import {
  AppointmentRow,
  AppointmentEditor,
  AppointmentFiltersSheet,
  type Appointment,
  type Beautician,
  type Service,
} from '@/src/components/appointments';
import { styles } from '@/src/components/appointments/styles';

/**
 * Appointments management screen.
 *
 * Thin shell that composes:
 *  • Header / range chips / list rows (this file)
 *  • AppointmentEditor  — new/edit sheet
 *  • AppointmentFiltersSheet — stylist / status / date-range facets
 *  • SendConfirmationSheet  — WhatsApp/Email confirmation picker
 *
 * All heavy UI lives under `src/components/appointments/*` so this file
 * can stay focused on data fetch + orchestration.
 */

const STATUS_ORDER_CYCLE = ['booked', 'in_progress', 'completed'] as const;

const fmtDateHeader = (isoOrKey: string) => {
  try {
    return new Date(isoOrKey).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  } catch { return isoOrKey; }
};

export default function AppointmentsScreen() {
  const router = useRouter();
  const { currentBranchId } = useAuth();

  const [range, setRange]           = useState<RangePreset>('today');
  const [list, setList]             = useState<Appointment[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [beauticians, setBeauticians] = useState<Beautician[]>([]);
  const [services, setServices]       = useState<Service[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing]       = useState<Appointment | null>(null);
  // Send-confirmation sheet target. Populated by list-row icon, the
  // editor's "Send Confirmation" button, or the post-booking flow.
  const [sendFor, setSendFor] = useState<Appointment | null>(null);

  // Persistent stylist/status/date filters.
  const [fsOpen, setFsOpen] = useState(false);
  const { filters, setFilters, resetFilters, activeCount } = useFilterState('appointments', {
    stylistId: null as string | null,
    status:    null as Appointment['status'] | null,
    dateFrom:  null as string | null,
    dateTo:    null as string | null,
  });

  const load = useCallback(async () => {
    try {
      // Ask the backend for the FULL preset window (local Mon→Sun for
      // "week", 1st→last for "month", etc.). The helper is client-side
      // only and never mutates stored data.
      const params: any = {};
      if (range !== 'all') {
        const r = resolveRange(range);
        params.date_from = r.startInclusive.toISOString();
        params.date_to   = r.endExclusive.toISOString();
      }
      const [apts, bs, srv] = await Promise.all([
        appointmentApi.list(params) as Promise<Appointment[]>,
        api<Beautician[]>('/beauticians').catch(() => []),
        api<Service[]>('/services').catch(() => []),
      ]);
      setList(apts || []);
      setBeauticians((bs || []).filter((b: any) => b.active !== false));
      setServices(srv || []);
    } catch (e: any) {
      Alert.alert('Failed', e.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range, currentBranchId]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredList = useMemo(() => {
    return list.filter(a => {
      if (filters.stylistId && a.beautician_id !== filters.stylistId) return false;
      if (filters.status    && a.status !== filters.status)          return false;
      // IMPORTANT: use the LOCAL calendar date of the appointment; never
      // slice raw ISO (that would use UTC and be off-by-one east of GMT).
      const dk = localDateKey(a.scheduled_start);
      if (filters.dateFrom && dk < filters.dateFrom) return false;
      if (filters.dateTo   && dk > filters.dateTo)   return false;
      return true;
    });
  }, [list, filters.stylistId, filters.status, filters.dateFrom, filters.dateTo]);

  const grouped = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    filteredList.forEach(a => {
      const dkey = localDateKey(a.scheduled_start);
      if (!map.has(dkey)) map.set(dkey, []);
      map.get(dkey)!.push(a);
    });
    return Array.from(map.entries()).map(([k, v]) => ({ dateKey: k, items: v }));
  }, [filteredList]);

  const openNew  = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (a: Appointment) => { setEditing(a); setEditorOpen(true); };

  const onDelete = (a: Appointment) => {
    Alert.alert('Cancel appointment?', `Delete booking for ${a.customer_name}?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await appointmentApi.remove(a.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await load();
          } catch (e: any) {
            Alert.alert('Failed', e.message || String(e));
          }
        },
      },
    ]);
  };

  const cycleStatus = async (a: Appointment) => {
    const idx = STATUS_ORDER_CYCLE.indexOf(a.status as any);
    const next = STATUS_ORDER_CYCLE[(idx + 1) % STATUS_ORDER_CYCLE.length];
    try {
      await appointmentApi.update(a.id, { status: next });
      await load();
    } catch (e: any) {
      Alert.alert('Failed', e.message || String(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.iconBtn}>
          <Ionicons name="home-outline" size={20} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Appointments</Text>
          <Text style={styles.headerSub}>{filteredList.length} of {list.length}</Text>
        </View>
        <FilterHeaderButton count={activeCount} onPress={() => setFsOpen(true)} testID="apt-filter-btn" />
        <TouchableOpacity onPress={openNew} style={[styles.addBtn, { marginLeft: spacing.sm }]} testID="add-apt-btn">
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      <View style={styles.chipRow}>
        {(['today', 'week', 'month', 'all'] as const).map(k => (
          <TouchableOpacity
            key={k}
            testID={`range-${k}`}
            style={[styles.chip, range === k && styles.chipActive]}
            onPress={() => setRange(k)}
          >
            <Text style={[styles.chipText, range === k && styles.chipTextActive]}>
              {k === 'today' ? 'Today' : k === 'week' ? 'This Week' : k === 'month' ? 'This Month' : 'All Upcoming'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.brandPrimary}
            />
          }
        >
          {list.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No appointments</Text>
              <Text style={styles.emptySub}>Book customer appointments and track your day.</Text>
              <TouchableOpacity style={styles.ctaBtn} onPress={openNew}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.ctaBtnText}>New Booking</Text>
              </TouchableOpacity>
            </View>
          )}

          {grouped.map(g => (
            <View key={g.dateKey} style={{ marginBottom: spacing.lg }}>
              <Text style={styles.groupLabel}>{fmtDateHeader(g.dateKey + 'T00:00:00')}</Text>
              {g.items.map(a => (
                <AppointmentRow
                  key={a.id}
                  item={a}
                  onPress={openEdit}
                  onCycleStatus={cycleStatus}
                  onSend={setSendFor}
                  onDelete={onDelete}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      <AppointmentEditor
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={async (result) => {
          setEditorOpen(false);
          await load();
          // Post-booking hook — offer to send the confirmation right
          // after a NEW appointment is created (spec §7). We never
          // auto-open WhatsApp: the sheet is presented and the user
          // must choose.
          if (result?.created) setSendFor(result.created);
        }}
        editing={editing}
        onSendConfirmation={(a) => setSendFor(a)}
        beauticians={beauticians}
        services={services}
      />

      {/* Send-Confirmation sheet — reused by list-row icon, editor
          button, and post-booking success flow. */}
      <SendConfirmationSheet
        visible={!!sendFor}
        onClose={() => setSendFor(null)}
        appointment={sendFor
          ? {
              id: sendFor.id,
              customer_name: sendFor.customer_name,
              customer_phone: sendFor.customer_phone || null,
              scheduled_start: sendFor.scheduled_start,
              duration_minutes: sendFor.duration_minutes,
            } as SendConfirmationAppointment
          : null}
      />

      <AppointmentFiltersSheet
        visible={fsOpen}
        onClose={() => setFsOpen(false)}
        onClear={resetFilters}
        filters={filters}
        setFilters={setFilters}
        beauticians={beauticians}
      />
    </View>
  );
}
