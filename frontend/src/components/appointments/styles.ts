import { StyleSheet } from 'react-native';
import { colors, spacing, radius, shadows } from '@/src/theme';

/**
 * Styles shared across the Appointments feature split.
 *
 * Grouped by which sub-component owns them; every consumer only imports
 * `styles.<key>` so we avoid re-declaring the same visual language 3x.
 */
export const styles = StyleSheet.create({
  // ---------- Screen header + chip row ----------
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary },

  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceSecondary },
  chipTextActive: { color: '#fff' },

  // ---------- Empty state ----------
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  // ---------- List row ----------
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
  iconAction: { padding: 4 },

  // ---------- Editor sheet chrome ----------
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md,
    width: '100%', maxWidth: 480, alignSelf: 'center',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },

  // ---------- Shared form primitives (label, input, pill) ----------
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.sm, fontSize: 15, color: colors.onSurface, minHeight: 44 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  pillTextActive: { color: '#fff', fontWeight: '800' },

  // ---------- Date & Time pickers ----------
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary, minHeight: 44,
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

  // ---------- Editor footer buttons ----------
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, ...shadows.card },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghostBtn: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  ghostBtnText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 15 },
  err: { color: colors.error, fontSize: 12, textAlign: 'center' },
  sendConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brandPrimary,
    backgroundColor: colors.brandTertiary,
  },
  sendConfirmBtnText: { color: colors.brandPrimary, fontWeight: '800', fontSize: 14 },

  // ---------- Filter sheet date range inputs ----------
  filterInput: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radius.sm, fontSize: 13,
    color: colors.onSurface,
  },
});
