import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import * as Haptics from 'expo-haptics';
import { colors } from '@/src/theme';
import { styles } from './styles';

/**
 * Date + Time picker used inside the Appointment editor.
 *
 * The parent owns state (dateStr / hour12 / minute / ampm) and passes
 * setters down — this keeps the picker completely stateless so it can
 * be dropped into any other flow (e.g. reschedule sheet later) without
 * dragging its own local state.
 */
type Props = {
  dateStr: string;
  onDateChange: (v: string) => void;
  calendarOpen: boolean;
  setCalendarOpen: (v: boolean | ((prev: boolean) => boolean)) => void;

  hour12: number; // 1..12
  minute: number; // 0,5,...,55
  ampm: 'AM' | 'PM';
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  onAmpmChange: (v: 'AM' | 'PM') => void;
  timePickerOpen: boolean;
  setTimePickerOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
};

const fmtCalendarDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

export default function AppointmentDateTimePicker({
  dateStr, onDateChange, calendarOpen, setCalendarOpen,
  hour12, minute, ampm, onHourChange, onMinuteChange, onAmpmChange,
  timePickerOpen, setTimePickerOpen,
}: Props) {
  return (
    <View>
      <Text style={styles.label}>Date & Time</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
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
                return dt.toLocaleDateString('en-IN', {
                  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                });
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
              onDateChange(day.dateString);
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
                    <TouchableOpacity
                      key={h}
                      onPress={() => { onHourChange(h); Haptics.selectionAsync(); }}
                      style={[styles.timeCell, sel && styles.timeCellActive]}
                      testID={`apt-hour-${h}`}
                    >
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
                    <TouchableOpacity
                      key={m}
                      onPress={() => { onMinuteChange(m); Haptics.selectionAsync(); }}
                      style={[styles.timeCell, sel && styles.timeCellActive]}
                      testID={`apt-min-${m}`}
                    >
                      <Text style={[styles.timeCellText, sel && styles.timeCellTextActive]}>
                        {String(m).padStart(2, '0')}
                      </Text>
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
                    <TouchableOpacity
                      key={t}
                      onPress={() => { onAmpmChange(t); Haptics.selectionAsync(); }}
                      style={[styles.ampmBtn, sel && styles.ampmBtnActive]}
                      testID={`apt-ampm-${t}`}
                    >
                      <Text style={[styles.ampmText, sel && styles.ampmTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => setTimePickerOpen(false)}
            style={styles.timeDoneBtn}
          >
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.timeDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export { fmtCalendarDate };
