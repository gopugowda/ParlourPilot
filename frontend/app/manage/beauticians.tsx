import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { sanitizePhone, emailError, PHONE_MAX, normalizeEmail } from '@/src/utils/validators';
import { useFilterState } from '@/src/hooks/useFilterState';
import { FilterSheet, FilterHeaderButton, FilterSection, FilterChip } from '@/src/components/FilterSheet';

type Branch = { id: string; name: string };
type Beautician = {
  id: string; name: string; role: string; phone?: string; active: boolean;
  employee_id?: string; email?: string; basic_salary?: number; branch_id?: string;
  work_start?: string; work_end?: string; week_off?: string[];
  commission_pct?: number; monthly_target?: number;
  address?: string; id_type?: string; id_number?: string;
};

const ROLE_SUGGESTIONS = ['Stylist', 'Senior Stylist', 'Manager', 'Therapist', 'Beautician', 'Assistant', 'Receptionist'];
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ID_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving License', 'Voter ID', 'Other'];

/** Accept "9", "9:", "930", "9:3", "9:30" — coerce as user types. Returns "HH:MM" or ''. */
function sanitizeTime(v: string): string {
  const d = (v || '').replace(/[^0-9]/g, '').slice(0, 4);
  if (!d) return '';
  if (d.length <= 2) return d;
  return d.slice(0, 2) + ':' + d.slice(2);
}
function isValidTime(v: string): boolean {
  if (!v) return true; // optional
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

export default function BeauticiansScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [list, setList] = useState<Beautician[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Beautician | null>(null);

  // Full field set — mirrors web parity.
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState('Stylist');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [basicSalary, setBasicSalary] = useState('');
  const [branchId, setBranchId] = useState<string>('');
  const [workStart, setWorkStart] = useState('10:00');
  const [workEnd, setWorkEnd] = useState('20:00');
  const [weekOff, setWeekOff] = useState<string[]>([]);
  const [commissionPct, setCommissionPct] = useState('');
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [address, setAddress] = useState('');
  const [idType, setIdType] = useState('Aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [active, setActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);

  // Persistent filters (role + status).
  const [fsOpen, setFsOpen] = useState(false);
  const { filters, setFilters, resetFilters, activeCount } = useFilterState('staff', {
    role: null as string | null,
    status: null as 'active' | 'inactive' | null,
  });

  const availableRoles = Array.from(new Set(list.map(b => b.role || 'Stylist')));
  const displayList = list.filter(b => {
    if (filters.role && (b.role || 'Stylist') !== filters.role) return false;
    if (filters.status === 'active' && !b.active) return false;
    if (filters.status === 'inactive' && b.active) return false;
    return true;
  });

  const load = async () => {
    try {
      const [ppl, br] = await Promise.all([
        api<Beautician[]>('/beauticians'),
        api<Branch[]>('/branches').catch(() => []),
      ]);
      setList(ppl || []);
      setBranches(br || []);
    } catch {}
  };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const resetForm = () => {
    setName(''); setEmployeeId(''); setRole('Stylist'); setPhone(''); setEmail('');
    setBasicSalary(''); setBranchId(branches[0]?.id || '');
    setWorkStart('10:00'); setWorkEnd('20:00'); setWeekOff([]);
    setCommissionPct(''); setMonthlyTarget(''); setAddress('');
    setIdType('Aadhaar'); setIdNumber(''); setActive(true);
    setErr(null); setEmailErr(null);
  };

  const openAdd = () => { setEditing(null); resetForm(); setEditOpen(true); };

  const openEdit = (b: Beautician) => {
    setEditing(b); setErr(null); setEmailErr(null);
    setName(b.name || '');
    setEmployeeId(b.employee_id || '');
    setRole(b.role || 'Stylist');
    setPhone(b.phone || '');
    setEmail(b.email || '');
    setBasicSalary(b.basic_salary != null ? String(b.basic_salary) : '');
    setBranchId(b.branch_id || branches[0]?.id || '');
    setWorkStart(b.work_start || '10:00');
    setWorkEnd(b.work_end || '20:00');
    setWeekOff(Array.isArray(b.week_off) ? [...b.week_off] : []);
    setCommissionPct(b.commission_pct != null ? String(b.commission_pct) : '');
    setMonthlyTarget(b.monthly_target != null ? String(b.monthly_target) : '');
    setAddress(b.address || '');
    setIdType(b.id_type || 'Aadhaar');
    setIdNumber(b.id_number || '');
    setActive(b.active !== false);
    setEditOpen(true);
  };

  const toggleDay = (day: string) => {
    Haptics.selectionAsync();
    setWeekOff(prev => {
      // If picking Flexible → clear everything else and set only Flexible.
      if (day === 'Flexible') {
        return prev.includes('Flexible') ? [] : ['Flexible'];
      }
      // If any real day picked → drop Flexible from the list.
      const base = prev.filter(d => d !== 'Flexible');
      return base.includes(day) ? base.filter(d => d !== day) : [...base, day];
    });
  };

  const save = async () => {
    setErr(null); setEmailErr(null);
    if (!name.trim()) { setErr('Name is required'); return; }
    // Email — optional but must be valid if filled.
    const emsg = emailError(email, { required: false });
    if (emsg) { setEmailErr(emsg); emailRef.current?.focus(); return; }
    if (!isValidTime(workStart) || !isValidTime(workEnd)) {
      setErr('Work times must be HH:MM (24-hour)'); return;
    }
    setSaving(true);
    try {
      // Numbers send 0 when blank (never "").
      const asNum = (v: string) => {
        const n = Number(String(v || '').trim());
        return Number.isFinite(n) ? n : 0;
      };
      const body: any = {
        name: name.trim(),
        role: role.trim() || 'Stylist',
        phone: sanitizePhone(phone),
        active,
        employee_id: employeeId.trim(),
        email: normalizeEmail(email),
        basic_salary: asNum(basicSalary),
        work_start: workStart || '',
        work_end: workEnd || '',
        week_off: weekOff,
        commission_pct: asNum(commissionPct),
        monthly_target: asNum(monthlyTarget),
        address: address.trim(),
        id_type: idType,
        id_number: idNumber.trim(),
      };
      if (branchId) body.branch_id = branchId;
      if (editing) await api(`/beauticians/${editing.id}`, { method: 'PUT', body });
      else await api('/beauticians', { method: 'POST', body });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false); await load();
    } catch (e: any) {
      const raw = (e?.message || 'Failed').toString();
      if (/email/i.test(raw)) setEmailErr('Please enter a valid email address');
      else setErr(raw);
    }
    finally { setSaving(false); }
  };

  const remove = async (b: Beautician) => {
    try { await api(`/beauticians/${b.id}`, { method: 'DELETE' }); await load(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  };

  const roleColors: Record<string, string> = {
    Barber: colors.info, Beautician: colors.brandPrimary, Stylist: colors.success,
  };

  return (
    <View style={styles.root} testID="beauticians-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Staff</Text>
          <Text style={styles.headerSub}>{displayList.length} of {list.length} shown</Text>
        </View>
        <FilterHeaderButton count={activeCount} onPress={() => setFsOpen(true)} testID="staff-filter-btn" />
        {isAdmin && (
          <TouchableOpacity testID="add-header" onPress={openAdd} style={[styles.headerBtn, { marginLeft: spacing.sm }]}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          {list.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No staff yet</Text>
              {isAdmin && (
                <TouchableOpacity testID="empty-add" style={styles.ctaBtn} onPress={openAdd}>
                  <Text style={styles.ctaBtnText}>Add first team member</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {displayList.map(b => (
            <View key={b.id} style={styles.row} testID={`bt-row-${b.id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{b.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{b.name}</Text>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                  <View style={[styles.rolePill, { backgroundColor: (roleColors[b.role] || colors.info) + '22' }]}>
                    <Text style={[styles.roleText, { color: roleColors[b.role] || colors.info }]}>{b.role}</Text>
                  </View>
                  {b.employee_id ? <Text style={styles.rowMeta}>· {b.employee_id}</Text> : null}
                  {!b.active && <Text style={styles.rowMeta}>· Inactive</Text>}
                  {b.phone ? <Text style={styles.rowMeta}>· {b.phone}</Text> : null}
                </View>
              </View>
              {isAdmin && (
                <>
                  <TouchableOpacity testID={`bt-edit-${b.id}`} style={styles.smallBtn} onPress={() => openEdit(b)}>
                    <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity testID={`bt-del-${b.id}`} style={[styles.smallBtn, { backgroundColor: '#FDE7E7' }]} onPress={() => remove(b)}>
                    <Ionicons name="trash" size={14} color={colors.error} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Add / Edit Staff — full web-parity sheet */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit Staff' : 'Add Staff'}</Text>

              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
                {/* Name — required */}
                <View style={styles.field}>
                  <Text style={styles.label}>Full name *</Text>
                  <TextInput testID="bt-name-input" value={name} onChangeText={setName} placeholder="e.g. Preetha P" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>

                {/* Employee ID */}
                <View style={styles.field}>
                  <Text style={styles.label}>Employee ID</Text>
                  <TextInput testID="bt-empid-input" value={employeeId} onChangeText={setEmployeeId} placeholder="e.g. EMP-001" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>

                {/* Role — free text + suggestion chips */}
                <View style={styles.field}>
                  <Text style={styles.label}>Role</Text>
                  <TextInput testID="bt-role-input" value={role} onChangeText={setRole} placeholder="Type role or pick below" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                    {ROLE_SUGGESTIONS.map(r => (
                      <TouchableOpacity
                        key={r}
                        testID={`bt-role-chip-${r}`}
                        onPress={() => setRole(r)}
                        style={[styles.suggChip, role === r && styles.suggChipActive]}
                      >
                        <Text style={[styles.suggChipText, role === r && styles.suggChipTextActive]}>{r}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* Phone */}
                <View style={styles.field}>
                  <Text style={styles.label}>Phone</Text>
                  <TextInput testID="bt-phone-input" value={phone} onChangeText={(v) => setPhone(sanitizePhone(v))} placeholder="10-digit number" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" maxLength={PHONE_MAX} style={styles.input} />
                </View>

                {/* Email */}
                <View style={styles.field}>
                  <Text style={styles.label}>Email</Text>
                  <TextInput
                    testID="bt-email-input"
                    ref={emailRef}
                    value={email}
                    onChangeText={(v) => { setEmail(v); if (emailErr) setEmailErr(null); }}
                    onBlur={() => { const m = emailError(email, { required: false }); if (m) setEmailErr(m); }}
                    placeholder="staff@salon.com"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    style={[styles.input, emailErr && { borderColor: colors.error, borderWidth: 1, backgroundColor: '#FDECEC' }]}
                  />
                  {emailErr && <Text style={styles.errSmall}>{emailErr}</Text>}
                </View>

                {/* Basic salary */}
                <View style={styles.field}>
                  <Text style={styles.label}>Basic salary (₹)</Text>
                  <TextInput
                    testID="bt-basic-salary-input"
                    value={basicSalary}
                    onChangeText={(v) => setBasicSalary(v.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    keyboardType="numeric"
                    style={styles.input}
                  />
                </View>

                {/* Branch */}
                {branches.length > 0 && (
                  <View style={styles.field}>
                    <Text style={styles.label}>Branch</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                      {branches.map(br => (
                        <TouchableOpacity
                          key={br.id}
                          testID={`bt-branch-${br.id}`}
                          onPress={() => setBranchId(br.id)}
                          style={[styles.suggChip, branchId === br.id && styles.suggChipActive]}
                        >
                          <Text style={[styles.suggChipText, branchId === br.id && styles.suggChipTextActive]}>{br.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Work times */}
                <View style={styles.gridRow}>
                  <View style={styles.gridField}>
                    <Text style={styles.label}>Work start (HH:MM)</Text>
                    <TextInput
                      testID="bt-work-start"
                      value={workStart}
                      onChangeText={(v) => setWorkStart(sanitizeTime(v))}
                      placeholder="10:00"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      style={styles.input}
                    />
                  </View>
                  <View style={styles.gridField}>
                    <Text style={styles.label}>Work end (HH:MM)</Text>
                    <TextInput
                      testID="bt-work-end"
                      value={workEnd}
                      onChangeText={(v) => setWorkEnd(sanitizeTime(v))}
                      placeholder="20:00"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      style={styles.input}
                    />
                  </View>
                </View>

                {/* Week off — multi-select + Flexible mutually exclusive */}
                <View style={styles.field}>
                  <Text style={styles.label}>Week off</Text>
                  <View style={styles.chipsWrap}>
                    {WEEK_DAYS.map(d => {
                      const sel = weekOff.includes(d);
                      return (
                        <TouchableOpacity
                          key={d}
                          testID={`bt-day-${d}`}
                          onPress={() => toggleDay(d)}
                          style={[styles.suggChip, sel && styles.suggChipActive]}
                        >
                          <Text style={[styles.suggChipText, sel && styles.suggChipTextActive]}>{d}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    <TouchableOpacity
                      testID="bt-day-Flexible"
                      onPress={() => toggleDay('Flexible')}
                      style={[styles.suggChip, weekOff.includes('Flexible') && styles.suggChipActive]}
                    >
                      <Text style={[styles.suggChipText, weekOff.includes('Flexible') && styles.suggChipTextActive]}>Flexible</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Commission & monthly target */}
                <View style={styles.gridRow}>
                  <View style={styles.gridField}>
                    <Text style={styles.label}>Commission %</Text>
                    <TextInput
                      testID="bt-commission"
                      value={commissionPct}
                      onChangeText={(v) => setCommissionPct(v.replace(/[^0-9.]/g, ''))}
                      placeholder="0"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="numeric"
                      style={styles.input}
                    />
                  </View>
                  <View style={styles.gridField}>
                    <Text style={styles.label}>Monthly target (₹)</Text>
                    <TextInput
                      testID="bt-monthly-target"
                      value={monthlyTarget}
                      onChangeText={(v) => setMonthlyTarget(v.replace(/[^0-9.]/g, ''))}
                      placeholder="0"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="numeric"
                      style={styles.input}
                    />
                  </View>
                </View>

                {/* Address */}
                <View style={styles.field}>
                  <Text style={styles.label}>Address</Text>
                  <TextInput
                    testID="bt-address"
                    value={address}
                    onChangeText={setAddress}
                    placeholder="Home address"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    multiline
                    style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                  />
                </View>

                {/* ID type + number */}
                <View style={styles.field}>
                  <Text style={styles.label}>ID type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                    {ID_TYPES.map(t => (
                      <TouchableOpacity
                        key={t}
                        testID={`bt-idtype-${t}`}
                        onPress={() => setIdType(t)}
                        style={[styles.suggChip, idType === t && styles.suggChipActive]}
                      >
                        <Text style={[styles.suggChipText, idType === t && styles.suggChipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>ID number</Text>
                  <TextInput
                    testID="bt-id-number"
                    value={idNumber}
                    onChangeText={setIdNumber}
                    placeholder="e.g. 1234-5678-9012"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.input}
                  />
                </View>

                <View style={styles.switchRow}>
                  <Text style={styles.label}>Active</Text>
                  <Switch testID="bt-active-switch" value={active} onValueChange={setActive} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} />
                </View>

                {err && <Text style={styles.err}>{err}</Text>}
              </ScrollView>

              <TouchableOpacity testID="bt-save-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Add'}</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <FilterSheet
        visible={fsOpen}
        onClose={() => setFsOpen(false)}
        onClear={resetFilters}
        title="Filter staff"
        testID="staff-filter-sheet"
      >
        <FilterSection label="Role">
          <FilterChip label="Any" selected={!filters.role} onPress={() => setFilters({ role: null })} testID="staff-fs-role-any" />
          {availableRoles.map(r => (
            <FilterChip
              key={r}
              label={r}
              selected={filters.role === r}
              onPress={() => setFilters({ role: r })}
              testID={`staff-fs-role-${r}`}
            />
          ))}
        </FilterSection>
        <FilterSection label="Status">
          <FilterChip label="Any" selected={!filters.status} onPress={() => setFilters({ status: null })} testID="staff-fs-status-any" />
          <FilterChip label="Active" selected={filters.status === 'active'} onPress={() => setFilters({ status: 'active' })} testID="staff-fs-status-active" />
          <FilterChip label="Inactive" selected={filters.status === 'inactive'} onPress={() => setFilters({ status: 'inactive' })} testID="staff-fs-status-inactive" />
        </FilterSection>
      </FilterSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brandPrimary, fontWeight: '800', fontSize: 13 },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  rowMeta: { fontSize: 11, color: colors.onSurfaceTertiary },
  rolePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  roleText: { fontSize: 10, fontWeight: '700' },
  smallBtn: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 16, color: colors.onSurfaceTertiary },
  ctaBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },

  gridRow: { flexDirection: 'row', gap: spacing.md },
  gridField: { flex: 1, gap: 6 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  suggChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  suggChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  suggChipText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  suggChipTextActive: { color: '#fff', fontWeight: '700' },

  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  err: { color: colors.error, fontSize: 13 },
  errSmall: { color: colors.error, fontSize: 11, fontWeight: '600' },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
