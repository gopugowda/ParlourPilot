import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, TextInput, Pressable, KeyboardAvoidingView, Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Calendar } from 'react-native-calendars';
import { api, appointmentApi } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, fmtMoney } from '@/src/theme';

type Appointment = {
  id: string;
  customer_name: string;
  customer_phone?: string;
  member_id?: string | null;
  beautician_id?: string | null;
  beautician_name?: string;
  service_ids?: string[];
  service_names?: string[];
  scheduled_start: string;
  scheduled_end?: string;
  duration_minutes: number;
  status: 'booked' | 'in_progress' | 'completed' | 'canceled' | 'no_show';
  notes?: string;
  price_estimate?: number;
};

type Beautician = { id: string; name: string };
type Service = { id: string; name: string; price: number; duration_minutes?: number };

const STATUS_META: Record<string, { label: string; color: string }> = {
  booked: { label: 'Booked', color: colors.info },
  in_progress: { label: 'In progress', color: colors.warning },
  completed: { label: 'Completed', color: colors.success },
  canceled: { label: 'Canceled', color: colors.onSurfaceTertiary },
  no_show: { label: 'No-show', color: colors.error },
};

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const fmtTime = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
  catch { return iso; }
};
const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return iso; }
};

export default function AppointmentsScreen() {
  const router = useRouter();
  const { currentBranchId } = useAuth();
  const [range, setRange] = useState<'today' | 'week' | 'all'>('today');
  const [list, setList] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [beauticians, setBeauticians] = useState<Beautician[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);

  const load = useCallback(async () => {
    try {
      let params: any = {};
      const now = new Date();
      if (range === 'today') {
        params.date_from = startOfDay(now).toISOString();
        params.date_to = addDays(startOfDay(now), 1).toISOString();
      } else if (range === 'week') {
        params.date_from = startOfDay(now).toISOString();
        params.date_to = addDays(startOfDay(now), 7).toISOString();
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

  const grouped = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    list.forEach(a => {
      const dkey = a.scheduled_start.slice(0, 10);
      if (!map.has(dkey)) map.set(dkey, []);
      map.get(dkey)!.push(a);
    });
    return Array.from(map.entries()).map(([k, v]) => ({ dateKey: k, items: v }));
  }, [list]);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (a: Appointment) => {
    setEditing(a);
    setEditorOpen(true);
  };

  const onDelete = (a: Appointment) => {
    Alert.alert('Cancel appointment?', `Delete booking for ${a.customer_name}?`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await appointmentApi.remove(a.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); await load(); }
        catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
      }},
    ]);
  };

  const cycleStatus = async (a: Appointment) => {
    const order = ['booked', 'in_progress', 'completed'];
    const idx = order.indexOf(a.status);
    const next = order[(idx + 1) % order.length];
    try { await appointmentApi.update(a.id, { status: next }); await load(); }
    catch (e: any) { Alert.alert('Failed', e.message || String(e)); }
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
          <Text style={styles.headerSub}>{list.length} bookings</Text>
        </View>
        <TouchableOpacity onPress={openNew} style={styles.addBtn} testID="add-apt-btn">
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      <View style={styles.chipRow}>
        {(['today', 'week', 'all'] as const).map(k => (
          <TouchableOpacity key={k} testID={`range-${k}`} style={[styles.chip, range === k && styles.chipActive]} onPress={() => setRange(k)}>
            <Text style={[styles.chipText, range === k && styles.chipTextActive]}>
              {k === 'today' ? 'Today' : k === 'week' ? 'This Week' : 'All Upcoming'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
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
              <Text style={styles.groupLabel}>{fmtDate(g.dateKey + 'T00:00:00Z')}</Text>
              {g.items.map(a => {
                const meta = STATUS_META[a.status] || STATUS_META.booked;
                return (
                  <TouchableOpacity key={a.id} style={styles.row} onPress={() => openEdit(a)} activeOpacity={0.85} testID={`apt-${a.id}`}>
                    <View style={styles.timeBlock}>
                      <Text style={styles.timeText}>{fmtTime(a.scheduled_start)}</Text>
                      <Text style={styles.durText}>{a.duration_minutes}m</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.custName}>{a.customer_name}</Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {a.beautician_name || 'Any staff'}
                        {a.service_names && a.service_names.length > 0 ? ` · ${a.service_names.join(', ')}` : ''}
                      </Text>
                      {a.customer_phone ? <Text style={styles.metaMuted}>📞 {a.customer_phone}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <TouchableOpacity onPress={() => cycleStatus(a)} style={[styles.statusChip, { backgroundColor: `${meta.color}20`, borderColor: meta.color }]}>
                        <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                      </TouchableOpacity>
                      {a.price_estimate ? <Text style={styles.priceText}>{fmtMoney(a.price_estimate)}</Text> : null}
                      <TouchableOpacity onPress={() => onDelete(a)} style={styles.trashBtn}>
                        <Ionicons name="trash-outline" size={14} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      <AppointmentEditor
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={async () => { setEditorOpen(false); await load(); }}
        editing={editing}
        beauticians={beauticians}
        services={services}
      />
    </View>
  );
}

// ---------------- Editor Modal ----------------
function AppointmentEditor({
  visible, onClose, onSaved, editing, beauticians, services,
}: {
  visible: boolean; onClose: () => void; onSaved: () => void;
  editing: Appointment | null;
  beauticians: Beautician[];
  services: Service[];
}) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  // Real phones with tall status bars/notches need us to subtract insets.top
  // otherwise the sheet content overlaps the system UI and pushes buttons off-screen.
  const sheetMaxHeight = Math.max(320, Math.min(winH * 0.88, winH - insets.top - 24));
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [beauticianId, setBeauticianId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [when, setWhen] = useState<Date>(new Date());
  const [dateStr, setDateStr] = useState<string>(''); // YYYY-MM-DD
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [hour12, setHour12] = useState(9); // 1..12
  const [minute, setMinute] = useState(0); // 0,5,10,...55
  const [ampm, setAmpm] = useState<'AM' | 'PM'>('AM');
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<Appointment['status']>('booked');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fmtCalendarDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  const to12h = (h24: number): { h: number; ampm: 'AM' | 'PM' } => {
    const isPm = h24 >= 12;
    let h = h24 % 12;
    if (h === 0) h = 12;
    return { h, ampm: isPm ? 'PM' : 'AM' };
  };
  const to24h = (h12: number, ampm: 'AM' | 'PM'): number => {
    let h = h12 % 12; // 12 → 0
    if (ampm === 'PM') h += 12;
    return h;
  };

  useEffect(() => {
    if (!visible) return;
    let start: Date;
    if (editing) {
      setCustomerName(editing.customer_name || '');
      setCustomerPhone(editing.customer_phone || '');
      setBeauticianId(editing.beautician_id || null);
      setSelectedServiceIds(editing.service_ids || []);
      start = new Date(editing.scheduled_start);
      setDuration(String(editing.duration_minutes || 60));
      setNotes(editing.notes || '');
      setStatus(editing.status || 'booked');
    } else {
      setCustomerName(''); setCustomerPhone(''); setBeauticianId(null);
      setSelectedServiceIds([]);
      const d = new Date();
      // round minutes to nearest 5, default 1 hour ahead
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      start = d;
      setDuration('60'); setNotes(''); setStatus('booked');
    }
    setWhen(start);
    setDateStr(fmtCalendarDate(start));
    const { h, ampm: ap } = to12h(start.getHours());
    setHour12(h);
    // round minute to nearest 5 for the picker
    const roundedMin = Math.round(start.getMinutes() / 5) * 5;
    setMinute(roundedMin >= 60 ? 0 : roundedMin);
    setAmpm(ap);
    setErr(null);
    setCalendarOpen(false);
    setTimePickerOpen(false);
  }, [visible, editing]);

  const rebuildWhen = () => {
    try {
      const parts = dateStr.split('-').map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        const nw = new Date(when);
        nw.setFullYear(parts[0], (parts[1] - 1), parts[2]);
        nw.setHours(to24h(hour12, ampm), minute, 0, 0);
        return nw;
      }
    } catch {}
    return when;
  };

  const toggleService = (id: string) => {
    setSelectedServiceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectedServiceObjs = services.filter(s => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServiceObjs.reduce((a, s) => a + (s.price || 0), 0);
  const bName = beauticians.find(b => b.id === beauticianId)?.name || '';

  const save = async () => {
    setErr(null);
    if (!customerName.trim()) { setErr('Customer name required'); return; }
    const start = rebuildWhen();
    if (isNaN(start.getTime())) { setErr('Invalid date/time. Use YYYY-MM-DD and HH:MM (24h).'); return; }
    setSaving(true);
    try {
      const payload: any = {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.replace(/\D/g, ''),
        beautician_id: beauticianId,
        beautician_name: bName,
        service_ids: selectedServiceIds,
        service_names: selectedServiceObjs.map(s => s.name),
        scheduled_start: start.toISOString(),
        duration_minutes: parseInt(duration, 10) || 60,
        notes: notes.trim(),
        status,
        price_estimate: totalPrice,
      };
      if (editing) await appointmentApi.update(editing.id, payload);
      else await appointmentApi.create(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (e: any) {
      setErr(e.message || 'Failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setSaving(false); }
  };

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* In-place overlay (NOT a native Modal) — this way, Android's
          windowSoftInputMode=adjustResize on the parent screen shrinks the
          sheet naturally when the keyboard opens, instead of pan-scrolling
          the whole modal window up and off the top of the screen. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' }}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              paddingTop: Math.max(spacing.md, insets.top + 4),
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{editing ? 'Edit Booking' : 'New Booking'}</Text>

          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={true}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          >
              <LabeledInput label="Customer Name *" value={customerName} onChangeText={setCustomerName} testID="apt-cust-name" />
              <LabeledInput label="Customer Phone" value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" testID="apt-cust-phone" />

              <View>
                <Text style={styles.label}>Date & Time</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity
                    style={[styles.pickBtn, { flex: 1.3 }]}
                    onPress={() => { setCalendarOpen(o => !o); setTimePickerOpen(false); }}
                    testID="apt-date-btn"
                  >
                    <Ionicons name="calendar-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.pickBtnText}>
                      {(() => {
                        try {
                          const [y, m, d] = dateStr.split('-').map(Number);
                          const dt = new Date(y, m - 1, d);
                          return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                        } catch { return dateStr || 'Select date'; }
                      })()}
                    </Text>
                    <Ionicons name={calendarOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.onSurfaceTertiary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pickBtn, { flex: 1 }]}
                    onPress={() => { setTimePickerOpen(o => !o); setCalendarOpen(false); }}
                    testID="apt-time-btn"
                  >
                    <Ionicons name="time-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.pickBtnText}>
                      {`${hour12}:${String(minute).padStart(2, '0')} ${ampm}`}
                    </Text>
                    <Ionicons name={timePickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.onSurfaceTertiary} />
                  </TouchableOpacity>
                </View>

                {calendarOpen && (
                  <View style={styles.calendarWrap} testID="apt-calendar">
                    <Calendar
                      current={dateStr || undefined}
                      onDayPress={(day) => {
                        setDateStr(day.dateString);
                        setCalendarOpen(false);
                        Haptics.selectionAsync();
                      }}
                      markedDates={dateStr ? { [dateStr]: { selected: true, selectedColor: colors.brandPrimary } } : {}}
                      minDate={fmtCalendarDate(new Date(new Date().setDate(new Date().getDate() - 30)))}
                      theme={{
                        backgroundColor: colors.surface,
                        calendarBackground: colors.surface,
                        selectedDayBackgroundColor: colors.brandPrimary,
                        selectedDayTextColor: '#ffffff',
                        todayTextColor: colors.brandPrimary,
                        dayTextColor: colors.onSurface,
                        textDisabledColor: colors.onSurfaceTertiary,
                        arrowColor: colors.brandPrimary,
                        monthTextColor: colors.onSurface,
                        textMonthFontWeight: '800',
                        textDayFontWeight: '500',
                        textDayHeaderFontWeight: '700',
                      }}
                    />
                  </View>
                )}

                {timePickerOpen && (
                  <View style={styles.timePickerWrap} testID="apt-time-picker">
                    <View style={styles.timeRow}>
                      <View style={styles.timeCol}>
                        <Text style={styles.timeColLabel}>Hour</Text>
                        <ScrollView style={styles.timeScroll} showsVerticalScrollIndicator={false}>
                          {[1,2,3,4,5,6,7,8,9,10,11,12].map(h => {
                            const sel = hour12 === h;
                            return (
                              <TouchableOpacity key={h} onPress={() => { setHour12(h); Haptics.selectionAsync(); }} style={[styles.timeCell, sel && styles.timeCellActive]} testID={`apt-hour-${h}`}>
                                <Text style={[styles.timeCellText, sel && styles.timeCellTextActive]}>{h}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                      <View style={styles.timeCol}>
                        <Text style={styles.timeColLabel}>Minute</Text>
                        <ScrollView style={styles.timeScroll} showsVerticalScrollIndicator={false}>
                          {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => {
                            const sel = minute === m;
                            return (
                              <TouchableOpacity key={m} onPress={() => { setMinute(m); Haptics.selectionAsync(); }} style={[styles.timeCell, sel && styles.timeCellActive]} testID={`apt-min-${m}`}>
                                <Text style={[styles.timeCellText, sel && styles.timeCellTextActive]}>{String(m).padStart(2, '0')}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                      <View style={styles.timeCol}>
                        <Text style={styles.timeColLabel}>AM/PM</Text>
                        <View style={{ gap: 6, paddingTop: 4 }}>
                          {(['AM', 'PM'] as const).map(t => {
                            const sel = ampm === t;
                            return (
                              <TouchableOpacity key={t} onPress={() => { setAmpm(t); Haptics.selectionAsync(); }} style={[styles.ampmBtn, sel && styles.ampmBtnActive]} testID={`apt-ampm-${t}`}>
                                <Text style={[styles.ampmText, sel && styles.ampmTextActive]}>{t}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => setTimePickerOpen(false)} style={styles.timeDoneBtn}>
                      <Ionicons name="checkmark" size={16} color="#fff" />
                      <Text style={styles.timeDoneText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <LabeledInput label="Duration (minutes)" value={duration} onChangeText={(v: string) => setDuration(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" testID="apt-duration" />

              <View>
                <Text style={styles.label}>Staff</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <TouchableOpacity onPress={() => setBeauticianId(null)} style={[styles.pill, beauticianId === null && styles.pillActive]}>
                    <Text style={[styles.pillText, beauticianId === null && styles.pillTextActive]}>Any staff</Text>
                  </TouchableOpacity>
                  {beauticians.map(b => {
                    const sel = beauticianId === b.id;
                    return (
                      <TouchableOpacity key={b.id} testID={`apt-b-${b.id}`} onPress={() => setBeauticianId(b.id)} style={[styles.pill, sel && styles.pillActive]}>
                        <Text style={[styles.pillText, sel && styles.pillTextActive]}>{b.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View>
                <Text style={styles.label}>Services {totalPrice > 0 && <Text style={{ color: colors.brandPrimary }}> · {fmtMoney(totalPrice)}</Text>}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {services.map(s => {
                    const sel = selectedServiceIds.includes(s.id);
                    return (
                      <TouchableOpacity key={s.id} testID={`apt-s-${s.id}`} onPress={() => toggleService(s.id)} style={[styles.pill, sel && styles.pillActive]}>
                        <Text style={[styles.pillText, sel && styles.pillTextActive]}>{s.name} · {fmtMoney(s.price)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {services.length === 0 && <Text style={styles.metaMuted}>No services yet. Add them under Manage → Services.</Text>}
              </View>

              <View>
                <Text style={styles.label}>Status</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(['booked', 'in_progress', 'completed', 'canceled', 'no_show'] as const).map(s => {
                    const sel = status === s;
                    const meta = STATUS_META[s];
                    return (
                      <TouchableOpacity key={s} testID={`apt-st-${s}`} onPress={() => setStatus(s)} style={[styles.pill, sel && { backgroundColor: meta.color, borderColor: meta.color }]}>
                        <Text style={[styles.pillText, sel && { color: '#fff' }]}>{meta.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <LabeledInput label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Any special requests…" />

              {err ? <Text style={styles.err}>{err}</Text> : null}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <TouchableOpacity style={styles.ghostBtn} onPress={onClose}>
                <Text style={styles.ghostBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={save} disabled={saving} testID="apt-save">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Book'}</Text>}
              </TouchableOpacity>
            </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function LabeledInput({ label, ...rest }: any) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary },

  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  groupLabel: { fontSize: 12, fontWeight: '800', color: colors.onSurfaceTertiary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },

  row: { flexDirection: 'row', gap: spacing.md, backgroundColor: '#FFFFFF', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card },
  timeBlock: { width: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingVertical: 6 },
  timeText: { fontSize: 14, fontWeight: '900', color: colors.brandPrimary },
  durText: { fontSize: 10, color: colors.brandPrimary, fontWeight: '700' },
  custName: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  meta: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  metaMuted: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  statusChip: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  statusText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  priceText: { fontSize: 12, color: colors.onSurface, fontWeight: '700' },
  trashBtn: { padding: 4 },

  // Editor
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md,
    width: '100%', maxWidth: 480, alignSelf: 'center',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.sm, fontSize: 15, color: colors.onSurface, minHeight: 44 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  dateText: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    minHeight: 44,
  },
  pickBtnText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.onSurface },
  calendarWrap: {
    marginTop: spacing.sm,
    borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.md,
    overflow: 'hidden', backgroundColor: colors.surface,
  },
  timePickerWrap: {
    marginTop: spacing.sm,
    borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.md,
    backgroundColor: colors.surface, padding: spacing.md,
  },
  timeRow: { flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  timeCol: { flex: 1, alignItems: 'center' },
  timeColLabel: { fontSize: 11, fontWeight: '800', color: colors.brandPrimary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  timeScroll: { maxHeight: 180, minWidth: 60 },
  timeCell: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.sm, marginBottom: 4, alignItems: 'center', backgroundColor: colors.surfaceTertiary },
  timeCellActive: { backgroundColor: colors.brandPrimary },
  timeCellText: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  timeCellTextActive: { color: '#fff' },
  ampmBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: 'center', minWidth: 60 },
  ampmBtnActive: { backgroundColor: colors.brandPrimary },
  ampmText: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  ampmTextActive: { color: '#fff' },
  timeDoneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: 10, marginTop: spacing.md },
  timeDoneText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  pillTextActive: { color: '#fff', fontWeight: '800' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, ...shadows.card },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghostBtn: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  ghostBtnText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 15 },
  err: { color: colors.error, fontSize: 12, textAlign: 'center' },
});
