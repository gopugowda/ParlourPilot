/**
 * SendConfirmationSheet — bottom-sheet UI for sending an appointment
 * confirmation over WhatsApp and/or Email.
 *
 * Contract (matches the shared backend used by both Web and Mobile):
 *   1. User picks a channel (WhatsApp / Email / WhatsApp + Email).
 *   2. We POST `/appointments/:id/send-confirmation { channels: [...] }`.
 *   3. Backend returns:
 *        • whatsapp: { status: 'opened_pending', url: 'https://wa.me/...' }
 *        • email:    { status: 'sent' | 'error', message?: string }
 *   4. If the backend provides a WhatsApp URL, we `Linking.openURL(url)` —
 *      WhatsApp opens with the message PRE-FILLED and the user must tap
 *      Send inside WhatsApp. We NEVER report WhatsApp as delivered.
 *   5. For Email we report whatever the backend actually returned.
 *
 * Important: this sheet is a THIN client. It never composes the WhatsApp
 * URL or the email body itself — the backend is the single source of
 * truth for both Web and Mobile so a future switch to the WhatsApp
 * Business API is a backend-only change.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  Pressable, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { appointmentApi } from '@/src/api/client';
import { fmtTime12 } from '@/src/utils/dateTime';

export type SendConfirmationAppointment = {
  id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;      // optional — only used for a preflight hint
  scheduled_start: string;             // ISO
  duration_minutes?: number;
};

type Channel = 'whatsapp' | 'email' | 'both';

const CHANNEL_META: { key: Channel; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; help: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp',            icon: 'logo-whatsapp', help: 'Opens WhatsApp with a pre-filled message. Tap Send inside WhatsApp.' },
  { key: 'email',    label: 'Email',               icon: 'mail-outline',  help: 'Sends via ParlourPilot email.' },
  { key: 'both',     label: 'WhatsApp + Email',    icon: 'send-outline',  help: 'Do both. WhatsApp still needs a manual tap.' },
];

function fmtDateHuman(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

export default function SendConfirmationSheet({
  visible, onClose, appointment,
}: {
  visible: boolean;
  onClose: () => void;
  appointment: SendConfirmationAppointment | null;
}) {
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [sending, setSending] = useState(false);

  // Reset the picker each time the sheet re-opens so it defaults to the
  // most-forgiving option (WhatsApp) instead of remembering a stale choice.
  useEffect(() => {
    if (visible) setChannel('whatsapp');
  }, [visible]);

  if (!visible || !appointment) return null;

  const hasPhone = !!(appointment.customer_phone && String(appointment.customer_phone).trim());
  const dateStr = fmtDateHuman(appointment.scheduled_start);
  const timeStr = fmtTime12(appointment.scheduled_start);

  const openWhatsAppFromBackend = async (url: string | undefined | null) => {
    if (!url) {
      Alert.alert('WhatsApp unavailable', 'The server did not return a WhatsApp link.');
      return;
    }
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert('Cannot open WhatsApp', 'This device could not open WhatsApp or a browser for the link. Please install WhatsApp and try again.');
        return;
      }
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Cannot open WhatsApp', e?.message || 'Could not launch WhatsApp.');
    }
  };

  const send = async () => {
    if (!appointment) return;
    // Client-side preflight — WhatsApp always needs a phone number. Email
    // may or may not be present in the mobile appointment object, so we
    // let the backend authoritatively decide for email.
    const channels: Array<'whatsapp' | 'email'> =
      channel === 'both' ? ['whatsapp', 'email'] : [channel];

    if (channels.includes('whatsapp') && !hasPhone) {
      Alert.alert('Missing phone', 'Customer phone number is required for WhatsApp confirmation.');
      return;
    }

    setSending(true);
    let resp: any;
    try {
      resp = await appointmentApi.sendConfirmation(appointment.id, channels);
    } catch (e: any) {
      setSending(false);
      const msg = e?.message || 'Could not send confirmation.';
      const status = (e as any)?.status;
      if (status === 404) {
        Alert.alert('Appointment not found', 'This appointment may have been deleted. Please refresh and try again.');
      } else if (status === 401 || status === 403) {
        Alert.alert('Not allowed', 'You do not have permission to send confirmations for this appointment.');
      } else if (status === 400) {
        Alert.alert('Invalid request', msg);
      } else {
        Alert.alert('Failed to send', msg);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Backend response shape (documented in appointmentApi.sendConfirmation):
    //   { whatsapp?: { status, url?, message? }, email?: { status, message? } }
    // We accept a few reasonable aliases for resilience against small
    // response-shape drift, but never invent a value the backend didn't send.
    const wa    = (resp?.whatsapp || resp?.wa)         as { status?: string; url?: string; wa_url?: string; message?: string } | undefined;
    const email = (resp?.email    || resp?.mail)       as { status?: string; message?: string; error?: string }                | undefined;

    let didOpenWa = false;
    if (channels.includes('whatsapp')) {
      const url = wa?.url || wa?.wa_url;
      if (url) {
        await openWhatsAppFromBackend(url);
        didOpenWa = true;
      } else if (wa?.status && String(wa.status).toLowerCase() !== 'opened_pending') {
        // Backend already knows WhatsApp cannot be attempted (e.g. missing phone).
        Alert.alert('WhatsApp unavailable', wa.message || 'WhatsApp confirmation could not be prepared.');
      }
    }

    let emailLine: string | null = null;
    if (channels.includes('email')) {
      const st = String(email?.status || '').toLowerCase();
      if (st === 'sent' || st === 'ok' || st === 'success' || st === 'queued') {
        emailLine = 'Appointment confirmation email sent successfully.';
      } else {
        emailLine = email?.message || email?.error || 'Email could not be sent. Please check the customer email address.';
      }
    }

    // Build a single, honest result summary. WhatsApp is ONLY described as
    // "opened" — never as "sent" — because we cannot verify the staff
    // member tapped Send inside WhatsApp.
    const lines: string[] = [];
    if (channels.includes('whatsapp')) {
      lines.push(didOpenWa
        ? 'WhatsApp opened. Please tap Send to deliver the confirmation.'
        : 'WhatsApp confirmation was not opened.');
    }
    if (emailLine) lines.push(emailLine);

    setSending(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Confirmation', lines.join('\n\n') || 'Done.');
    onClose();
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="send-confirmation-sheet">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} disabled={sending} />
      </View>
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Send Appointment Confirmation</Text>

          {/* Summary */}
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Customer</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>{appointment.customer_name || '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Appointment</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>{dateStr} · {timeStr}</Text>
            </View>
            {appointment.customer_phone ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Phone</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>{appointment.customer_phone}</Text>
              </View>
            ) : null}
          </View>

          {/* Channel picker */}
          <Text style={styles.sectionLabel}>Send via</Text>
          <View style={{ gap: spacing.sm }}>
            {CHANNEL_META.map(opt => {
              const active = channel === opt.key;
              // Non-blocking hint: disable WhatsApp options when we
              // clearly know the customer has no phone. Email is not
              // disabled here — the backend has the authoritative check.
              const needsPhone = opt.key === 'whatsapp' || opt.key === 'both';
              const disabled = needsPhone && !hasPhone;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => { if (!disabled) { setChannel(opt.key); Haptics.selectionAsync(); } }}
                  disabled={disabled}
                  style={[
                    styles.channelRow,
                    active && styles.channelRowActive,
                    disabled && styles.channelRowDisabled,
                  ]}
                  testID={`send-channel-${opt.key}`}
                >
                  <View style={[styles.channelIconWrap, active && { backgroundColor: colors.brandPrimary }]}>
                    <Ionicons
                      name={opt.icon}
                      size={18}
                      color={active ? '#fff' : (disabled ? colors.onSurfaceTertiary : colors.brandPrimary)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.channelLabel, disabled && { color: colors.onSurfaceTertiary }]}>{opt.label}</Text>
                    <Text style={styles.channelHelp} numberOfLines={2}>
                      {disabled ? 'Customer phone number is required for WhatsApp confirmation.' : opt.help}
                    </Text>
                  </View>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? colors.brandPrimary : colors.onSurfaceTertiary}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
            <TouchableOpacity style={styles.ghostBtn} onPress={onClose} disabled={sending} testID="send-confirmation-cancel">
              <Text style={styles.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, { flex: 1 }, sending && { opacity: 0.7 }]}
              onPress={send}
              disabled={sending}
              testID="send-confirmation-send"
            >
              {sending
                ? <ActivityIndicator color="#fff" />
                : (
                  <>
                    <Ionicons name="send" size={16} color="#fff" />
                    <Text style={styles.saveBtnText}>Send Confirmation</Text>
                  </>
                )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetWrap: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, paddingBottom: spacing.xl,
    gap: spacing.md, width: '100%', maxWidth: 480, alignSelf: 'center',
    ...shadows.card,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },

  summary: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  summaryLabel: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 13, color: colors.onSurface, fontWeight: '700', flex: 1, textAlign: 'right' },

  sectionLabel: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  channelRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  channelRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  channelRowDisabled: { opacity: 0.55 },
  channelIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandTertiary,
  },
  channelLabel: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  channelHelp:  { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  ghostBtn: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  ghostBtnText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 15 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, ...shadows.card },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
