import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fmtMoney } from '@/src/theme';
import { fmtTime12 } from '@/src/utils/dateTime';
import { styles } from './styles';
import { Appointment, STATUS_META } from './types';

/**
 * Single appointment row in the day-grouped list.
 *
 * Extracted from the screen so we can reason about touch-target sizing,
 * status-cycle taps, and the row-level quick actions (Send / Delete) in
 * isolation. Props are intentionally callbacks — the row is a dumb
 * presenter that never talks to the API directly.
 */
type Props = {
  item: Appointment;
  onPress: (a: Appointment) => void;
  onCycleStatus: (a: Appointment) => void;
  onSend: (a: Appointment) => void;
  onDelete: (a: Appointment) => void;
};

function AppointmentRow({ item, onPress, onCycleStatus, onSend, onDelete }: Props) {
  const meta = STATUS_META[item.status] || STATUS_META.booked;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(item)}
      activeOpacity={0.85}
      testID={`apt-${item.id}`}
    >
      <View style={styles.timeBlock}>
        <Text style={styles.timeText}>{fmtTime12(item.scheduled_start)}</Text>
        <Text style={styles.durText}>{item.duration_minutes}m</Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.custName}>{item.customer_name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.beautician_name || 'Any staff'}
          {item.service_names && item.service_names.length > 0
            ? ` · ${item.service_names.join(', ')}`
            : ''}
        </Text>
        {item.customer_phone ? (
          <Text style={styles.metaMuted}>📞 {item.customer_phone}</Text>
        ) : null}
      </View>

      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <TouchableOpacity
          onPress={() => onCycleStatus(item)}
          style={[styles.statusChip, { backgroundColor: `${meta.color}20`, borderColor: meta.color }]}
        >
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </TouchableOpacity>
        {item.price_estimate ? (
          <Text style={styles.priceText}>{fmtMoney(item.price_estimate)}</Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {/*
            Quick action — Send Confirmation. Icon-only to keep the row
            compact; the full picker still lives inside the editor sheet.
          */}
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); onSend(item); }}
            style={styles.iconAction}
            testID={`apt-send-${item.id}`}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="paper-plane-outline" size={14} color={colors.brandPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(item)} style={styles.trashBtn}>
            <Ionicons name="trash-outline" size={14} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Memoised so re-renders of the parent list don't re-render every row.
export default React.memo(AppointmentRow);
