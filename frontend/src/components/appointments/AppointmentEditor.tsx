import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Pressable, useWindowDimensions,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { appointmentApi } from '@/src/api/client';
import { colors, spacing, fmtMoney } from '@/src/theme';
import { sanitizePhone, PHONE_MAX } from '@/src/utils/validators';
import { styles } from './styles';
import { Appointment, Beautician, Service, STATUS_ORDER, STATUS_META } from './types';
import LabeledInput from './LabeledInput';
import AppointmentDateTimePicker, { fmtCalendarDate } from './AppointmentDateTimePicker';

/**
 * Full-screen bottom-sheet editor for booking / editing appointments.
 *
 * Contract:
 *  • `onSaved({ created })` fires with the new appointment when a fresh
 *    booking is created so the parent can offer to send a confirmation
 *    (spec §7). Updates fire `onSaved()` with no payload.
 *  • `onSendConfirmation(a)` is only rendered for EXISTING appointments
 *    inside the editor — the create flow uses the parent's post-save hook.
 */
type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (result?: { created?: Appointment }) => void;
  editing: Appointment | null;
  beauticians: Beautician[];
  services: Service[];
  onSendConfirmation?: (a: Appointment) => void;
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

export default function AppointmentEditor({
  visible, onClose, onSaved, editing, beauticians, services, onSendConfirmation,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const sheetMaxHeight = Math.max(320, Math.min(winH * 0.88, winH - insets.top - 24));

  const [customerName, setCustomerName]     = useState('');
  const [customerPhone, setCustomerPhone]   = useState('');
  const [beauticianId, setBeauticianId]     = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [when, setWhen]                     = useState<Date>(new Date());
  const [dateStr, setDateStr]               = useState<string>('');
  const [calendarOpen, setCalendarOpen]     = useState(false);
  const [hour12, setHour12]                 = useState(9);
  const [minute, setMinute]                 = useState(0);
  const [ampm, setAmpm]                     = useState<'AM' | 'PM'>('AM');
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [duration, setDuration]             = useState('60');
  const [notes, setNotes]                   = useState('');
  const [status, setStatus]                 = useState<Appointment['status']>('booked');
  const [saving, setSaving]                 = useState(false);
  const [err, setErr]                       = useState<string | null>(null);

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
      // Round minutes to top of hour, default 1 hour ahead of "now".
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      start = d;
      setDuration('60'); setNotes(''); setStatus('booked');
    }
    setWhen(start);
    setDateStr(fmtCalendarDate(start));
    const { h, ampm: ap } = to12h(start.getHours());
    setHour12(h);
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
    if (isNaN(start.getTime())) {
      setErr('Invalid date/time. Use YYYY-MM-DD and HH:MM (24h).');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        customer_name:    customerName.trim(),
        customer_phone:   sanitizePhone(customerPhone),
        beautician_id:    beauticianId,
        beautician_name:  bName,
        service_ids:      selectedServiceIds,
        service_names:    selectedServiceObjs.map(s => s.name),
        scheduled_start:  start.toISOString(),
        duration_minutes: parseInt(duration, 10) || 60,
        notes:            notes.trim(),
        status,
        price_estimate:   totalPrice,
      };
      if (editing) {
        await appointmentApi.update(editing.id, payload);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onSaved();
      } else {
        // Capture the created appointment so the parent can immediately
        // offer to send a WhatsApp/Email confirmation (spec §7).
        const created = await appointmentApi.create(payload) as Appointment;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onSaved({ created });
      }
    } catch (e: any) {
      setErr(e.message || 'Failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* In-place overlay (NOT a native Modal) — this way Android's
          windowSoftInputMode=adjustResize shrinks the sheet naturally
          when the keyboard opens, instead of pan-scrolling the modal
          window up and off the top of the screen. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </View>
      <View
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

          <KeyboardAwareScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={true}
            bottomOffset={24}
          >
            <LabeledInput
              label="Customer Name *"
              value={customerName}
              onChangeText={setCustomerName}
              testID="apt-cust-name"
            />
            <LabeledInput
              label="Customer Phone"
              value={customerPhone}
              onChangeText={(v: string) => setCustomerPhone(sanitizePhone(v))}
              keyboardType="number-pad"
              maxLength={PHONE_MAX}
              testID="apt-cust-phone"
            />

            <AppointmentDateTimePicker
              dateStr={dateStr}
              onDateChange={setDateStr}
              calendarOpen={calendarOpen}
              setCalendarOpen={setCalendarOpen}
              hour12={hour12}
              minute={minute}
              ampm={ampm}
              onHourChange={setHour12}
              onMinuteChange={setMinute}
              onAmpmChange={setAmpm}
              timePickerOpen={timePickerOpen}
              setTimePickerOpen={setTimePickerOpen}
            />

            <LabeledInput
              label="Duration (minutes)"
              value={duration}
              onChangeText={(v: string) => setDuration(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              testID="apt-duration"
            />

            <View>
              <Text style={styles.label}>Staff</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setBeauticianId(null)}
                  style={[styles.pill, beauticianId === null && styles.pillActive]}
                >
                  <Text style={[styles.pillText, beauticianId === null && styles.pillTextActive]}>
                    Any staff
                  </Text>
                </TouchableOpacity>
                {beauticians.map(b => {
                  const sel = beauticianId === b.id;
                  return (
                    <TouchableOpacity
                      key={b.id}
                      testID={`apt-b-${b.id}`}
                      onPress={() => setBeauticianId(b.id)}
                      style={[styles.pill, sel && styles.pillActive]}
                    >
                      <Text style={[styles.pillText, sel && styles.pillTextActive]}>{b.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View>
              <Text style={styles.label}>
                Services
                {totalPrice > 0 && (
                  <Text style={{ color: colors.brandPrimary }}> · {fmtMoney(totalPrice)}</Text>
                )}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {services.map(s => {
                  const sel = selectedServiceIds.includes(s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      testID={`apt-s-${s.id}`}
                      onPress={() => toggleService(s.id)}
                      style={[styles.pill, sel && styles.pillActive]}
                    >
                      <Text style={[styles.pillText, sel && styles.pillTextActive]}>
                        {s.name} · {fmtMoney(s.price)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {services.length === 0 && (
                <Text style={styles.metaMuted}>
                  No services yet. Add them under Manage → Services.
                </Text>
              )}
            </View>

            <View>
              <Text style={styles.label}>Status</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {STATUS_ORDER.map(s => {
                  const sel = status === s;
                  const meta = STATUS_META[s];
                  return (
                    <TouchableOpacity
                      key={s}
                      testID={`apt-st-${s}`}
                      onPress={() => setStatus(s)}
                      style={[styles.pill, sel && { backgroundColor: meta.color, borderColor: meta.color }]}
                    >
                      <Text style={[styles.pillText, sel && { color: '#fff' }]}>{meta.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <LabeledInput
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Any special requests…"
            />

            {/*
              Editor-level Send Confirmation button — only meaningful for
              an existing appointment (spec §3). Post-booking (new
              appointments) is handled by the parent after `onSaved`.
            */}
            {editing && onSendConfirmation ? (
              <TouchableOpacity
                onPress={() => {
                  onClose();
                  // Slight delay so the editor unmount doesn't race the
                  // send-sheet mount on some Android devices.
                  setTimeout(() => onSendConfirmation(editing), 60);
                }}
                style={styles.sendConfirmBtn}
                testID="apt-editor-send"
              >
                <Ionicons name="paper-plane-outline" size={16} color={colors.brandPrimary} />
                <Text style={styles.sendConfirmBtnText}>Send Confirmation</Text>
              </TouchableOpacity>
            ) : null}

            {err ? <Text style={styles.err}>{err}</Text> : null}
          </KeyboardAwareScrollView>

          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
            <TouchableOpacity style={styles.ghostBtn} onPress={onClose}>
              <Text style={styles.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, { flex: 1 }]}
              onPress={save}
              disabled={saving}
              testID="apt-save"
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Book'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}
