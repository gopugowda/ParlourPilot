/**
 * Shared filter bottom-sheet primitives.
 *
 *   <FilterHeaderButton count={n} onPress={openFilters} />
 *   <FilterSheet visible={open} onClose={close} onApply={apply} onClear={clear}>
 *     ...arbitrary filter fields (chips, date inputs, etc.)...
 *   </FilterSheet>
 */
import React, { ReactNode } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows } from '@/src/theme';

export function FilterHeaderButton({
  count, onPress, testID,
}: { count: number; onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.iconBtnWrap}
      testID={testID || 'filter-header-btn'}
    >
      <Ionicons name="options-outline" size={20} color={colors.brandPrimary} />
      {count > 0 && (
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function FilterSheet({
  visible, onClose, onApply, onClear, title, children, testID,
}: {
  visible: boolean;
  onClose: () => void;
  onApply?: () => void;
  onClear: () => void;
  title?: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.sheet} onPress={() => { /* swallow */ }} testID={testID || 'filter-sheet'}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.title}>{title || 'Filters'}</Text>
              <TouchableOpacity onPress={onClose} testID="filter-sheet-close">
                <Ionicons name="close" size={22} color={colors.onSurfaceSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            <View style={styles.actionsRow}>
              <TouchableOpacity onPress={onClear} style={styles.clearBtn} testID="filter-sheet-clear">
                <Text style={styles.clearBtnText}>Clear all</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onApply || onClose}
                style={styles.applyBtn}
                testID="filter-sheet-apply"
              >
                <Text style={styles.applyBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

/** Small chip helper — use inside FilterSheet children. */
export function FilterChip({
  label, selected, onPress, testID,
}: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, selected && styles.chipActive]}
      testID={testID}
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Section label for grouping chips inside FilterSheet. */
export function FilterSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionChipRow}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconBtnWrap: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandTertiary,
    borderWidth: 1, borderColor: colors.brandSecondary,
  },
  countBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  countBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl,
    width: '100%', maxWidth: 480, alignSelf: 'center',
    ...shadows.strong,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: '800', color: colors.onSurface },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  clearBtn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  clearBtnText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 14 },
  applyBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brandPrimary, ...shadows.card },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  section: { marginBottom: spacing.lg },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  sectionChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff', fontWeight: '700' },
});
