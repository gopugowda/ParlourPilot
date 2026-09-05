/**
 * Shared reporting UI primitives used by Expenses / Members / Services /
 * Attendance / Stock / Customer reports. Keeps every report screen visually
 * consistent and enforces the "Screen = CSV = PDF = Share" contract by
 * sharing one filtered dataset from the caller.
 *
 * Components:
 *   <ReportToolbar>          — Filter button + kebab menu (CSV / PDF / Share)
 *   <ExportMenu>             — Bottom-sheet with CSV / PDF / Share actions
 *   <DatePresetChips>        — Today / Yesterday / Last 7 / This Week / This
 *                              Month / Last Month / Custom
 *   <ReportEmptyState>       — "No X found for the selected filters" + Reset
 *   <ReportSummaryCard>      — Aggregate stat card row (label / value)
 *   <ReportSectionTitle>     — Small caps section header
 */
import React, { ReactNode } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { FilterHeaderButton } from '@/src/components/FilterSheet';

// ---------------------------------------------------------------------------
// Date presets
// ---------------------------------------------------------------------------

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'custom';

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'custom', label: 'Custom' },
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Compute [from, to] ISO date pair for the given preset.
 * Returns null for 'custom' (caller keeps its existing range).
 */
export function rangeFromPreset(p: DatePreset, now: Date = new Date()): { from: string; to: string } | null {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const today = new Date(start);
  switch (p) {
    case 'today':
      return { from: ymd(today), to: ymd(today) };
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { from: ymd(y), to: ymd(y) };
    }
    case 'last7': {
      const f = new Date(today); f.setDate(f.getDate() - 6);
      return { from: ymd(f), to: ymd(today) };
    }
    case 'this_week': {
      // Monday-start week (India norm). getDay(): Sun=0 → treat as end-of-week.
      const dow = today.getDay(); const diff = dow === 0 ? 6 : dow - 1;
      const monday = new Date(today); monday.setDate(monday.getDate() - diff);
      return { from: ymd(monday), to: ymd(today) };
    }
    case 'this_month': {
      const f = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: ymd(f), to: ymd(today) };
    }
    case 'last_month': {
      const f = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const t = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: ymd(f), to: ymd(t) };
    }
    case 'custom':
    default:
      return null;
  }
}

export function DatePresetChips({
  value, onChange, testID,
}: { value: DatePreset; onChange: (p: DatePreset) => void; testID?: string }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
      testID={testID}
    >
      {PRESETS.map(p => {
        const selected = value === p.key;
        return (
          <TouchableOpacity
            key={p.key}
            onPress={() => onChange(p.key)}
            style={[styles.chip, selected && styles.chipActive]}
            testID={`${testID || 'preset'}-${p.key}`}
          >
            <Text style={[styles.chipText, selected && styles.chipTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Report toolbar (filter icon + kebab / more)
// ---------------------------------------------------------------------------

export function ReportToolbar({
  filterCount, onOpenFilters, onOpenMenu, filterTestID, menuTestID,
}: {
  filterCount: number;
  onOpenFilters: () => void;
  onOpenMenu: () => void;
  filterTestID?: string;
  menuTestID?: string;
}) {
  return (
    <View style={styles.toolbar}>
      <FilterHeaderButton count={filterCount} onPress={onOpenFilters} testID={filterTestID || 'report-filter-btn'} />
      <TouchableOpacity
        onPress={onOpenMenu}
        style={styles.iconBtnWrap}
        testID={menuTestID || 'report-menu-btn'}
      >
        <Ionicons name="ellipsis-vertical" size={20} color={colors.brandPrimary} />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Export menu — bottom sheet with CSV / PDF / Share options
// ---------------------------------------------------------------------------

export type ExportAction = 'csv' | 'pdf' | 'share';

export function ExportMenu({
  visible, onClose, title, subtitle, onPick, extraActions,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  onPick: (a: ExportAction) => void | Promise<void>;
  /** Optional extra rows (e.g. "Reset filters") appended below core actions. */
  extraActions?: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; destructive?: boolean }[];
}) {
  const handle = async (a: ExportAction) => { onClose(); await onPick(a); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
          {subtitle ? <Text style={styles.sheetSub}>{subtitle}</Text> : null}

          <TouchableOpacity style={styles.action} onPress={() => handle('csv')} testID="export-csv">
            <View style={[styles.actionIcon, { backgroundColor: '#DDF3E4' }]}>
              <Ionicons name="grid-outline" size={20} color="#207447" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Download CSV</Text>
              <Text style={styles.actionDesc}>Spreadsheet for analysis · same rows as shown</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.action} onPress={() => handle('pdf')} testID="export-pdf">
            <View style={[styles.actionIcon, { backgroundColor: '#FFE5E5' }]}>
              <Ionicons name="document-text-outline" size={20} color="#C42032" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Download PDF</Text>
              <Text style={styles.actionDesc}>Formatted report · same rows as shown</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.action} onPress={() => handle('share')} testID="export-share">
            <View style={[styles.actionIcon, { backgroundColor: '#E3EAFB' }]}>
              <Ionicons name="share-social-outline" size={20} color="#2B4C9E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Share</Text>
              <Text style={styles.actionDesc}>Use the native share sheet (WhatsApp, Email…)</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </TouchableOpacity>

          {(extraActions || []).map(ea => (
            <TouchableOpacity key={ea.key} style={styles.action} onPress={() => { onClose(); ea.onPress(); }}>
              <View style={[styles.actionIcon, { backgroundColor: ea.destructive ? '#FDECEC' : '#EEEBE2' }]}>
                <Ionicons name={ea.icon} size={20} color={ea.destructive ? colors.error : colors.onSurfaceSecondary} />
              </View>
              <Text style={[styles.actionTitle, ea.destructive && { color: colors.error }]}>{ea.label}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Empty state + summary + section title
// ---------------------------------------------------------------------------

export function ReportEmptyState({
  icon = 'file-tray-outline',
  message,
  onReset,
  resetLabel = 'Reset Filters',
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  message: string;
  onReset?: () => void;
  resetLabel?: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={colors.onSurfaceTertiary} />
      <Text style={styles.emptyText}>{message}</Text>
      {onReset && (
        <TouchableOpacity onPress={onReset} style={styles.emptyBtn}>
          <Ionicons name="refresh" size={14} color={colors.brandPrimary} />
          <Text style={styles.emptyBtnText}>{resetLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function ReportSummaryCard({
  items,
}: { items: { label: string; value: string; tone?: 'default' | 'accent' | 'warning' | 'success' }[] }) {
  return (
    <View style={styles.summaryRow}>
      {items.map((it, idx) => (
        <View key={idx} style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{it.label}</Text>
          <Text
            style={[
              styles.summaryValue,
              it.tone === 'accent' && { color: colors.brandPrimary },
              it.tone === 'warning' && { color: colors.warning },
              it.tone === 'success' && { color: colors.success },
            ]}
            numberOfLines={1}
          >
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ReportSectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtnWrap: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border,
    position: 'relative',
  },
  chip: {
    paddingHorizontal: 12, height: 32,
    borderRadius: radius.pill,
    justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, paddingBottom: spacing.xxl,
    gap: 10,
    ...shadows.md,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: 6 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  sheetSub: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center', marginBottom: 6 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
  },
  actionIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  actionTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  actionDesc: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  cancel: {
    marginTop: 8, alignItems: 'center', paddingVertical: 12,
  },
  cancelText: { color: colors.onSurfaceSecondary, fontWeight: '700' },

  empty: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.xxxl, gap: 8,
  },
  emptyText: {
    color: colors.onSurfaceSecondary,
    fontSize: 14, fontWeight: '500', textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyBtn: {
    marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary + '18',
    borderWidth: 1, borderColor: colors.brandPrimary + '55',
  },
  emptyBtnText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 12 },

  summaryRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  summaryCard: {
    flex: 1, minWidth: 100,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 10,
  },
  summaryLabel: { fontSize: 10, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryValue: { fontSize: 16, fontWeight: '800', color: colors.onSurface, marginTop: 2 },

  sectionTitle: {
    fontSize: 12, fontWeight: '800', color: colors.onSurfaceSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
});
