// -----------------------------------------------------------------------------
// Team Management (formerly Staff).
// Unified: one row = 1 user login + 1 staff profile (linked by user_id).
// Backend: /api/team GET/POST/PUT/DELETE.
// Login identifier can be email OR phone (both create a working login).
// Owner is locked; last-admin cannot be demoted or deleted.
// -----------------------------------------------------------------------------
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Modal, Pressable, Switch, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar } from 'react-native-calendars';
import { api } from '@/src/api/client';
import { useAuth, PERMISSION_KEYS, PERMISSION_LABELS, PermissionKey } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { sanitizePhone, emailError, PHONE_MAX, normalizeEmail } from '@/src/utils/validators';
import { useFilterState } from '@/src/hooks/useFilterState';
import { FilterSheet, FilterHeaderButton, FilterSection, FilterChip } from '@/src/components/FilterSheet';

type Branch = { id: string; name: string };
type TeamMember = {
  id: string; user_id?: string | null; beautician_id?: string | null;
  name: string; email: string; phone: string;
  has_login: boolean;
  access_level: 'owner' | 'admin' | 'staff' | null;
  branch_id?: string | null; is_active: boolean;
  role: string; employee_id: string;
  basic_salary: number; work_start: string; work_end: string; week_off: string[];
  commission_pct: number; monthly_target: number;
  address: string; id_type: string; id_number: string;
  is_owner_locked: boolean;
  is_owner?: boolean;
  permissions?: Partial<Record<PermissionKey, boolean>>;
  joined_date?: string;
  last_working_date?: string;
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
  if (!v) return true;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

type Seats = { seats_allowed: number; seats_used: number; can_add: boolean; seats_per_branch: number; branches: number; plan_tier?: string };

export default function TeamScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  // Only the OWNER can add/delete team members, edit the owner's record,
  // and change owner-only fields (salary, commission, target, employee ID,
  // job title, ID docs, address, access level, permissions). Admins can
  // still edit contact & schedule fields for staff/admin (but not owner).
  const isOwner = !!user?.is_owner;

  const [list, setList] = useState<TeamMember[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [seats, setSeats] = useState<Seats | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- Sheet state ----
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [pwdVisible, setPwdVisible] = useState(false);
  const [accessLevel, setAccessLevel] = useState<'staff' | 'admin'>('staff');
  const [role, setRole] = useState('Stylist');
  const [employeeId, setEmployeeId] = useState('');
  const [branchId, setBranchId] = useState<string>('');
  const [basicSalary, setBasicSalary] = useState('');
  const [workStart, setWorkStart] = useState('10:00');
  const [workEnd, setWorkEnd] = useState('20:00');
  const [weekOff, setWeekOff] = useState<string[]>([]);
  const [commissionPct, setCommissionPct] = useState('');
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [address, setAddress] = useState('');
  const [idType, setIdType] = useState('Aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [active, setActive] = useState(true);
  const [joinedDate, setJoinedDate] = useState('');
  const [lastWorkingDate, setLastWorkingDate] = useState('');
  // Date picker for Joined / Last Working
  const [dateField, setDateField] = useState<null | 'joined' | 'lastWorking'>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const isValidIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime());
  const fmtDateLabel = (s: string) => {
    if (!isValidIso(s)) return '';
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const openDatePicker = (which: 'joined' | 'lastWorking') => {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    setDateField(which);
  };
  const applyDatePick = (iso: string) => {
    if (dateField === 'joined') setJoinedDate(iso);
    else if (dateField === 'lastWorking') setLastWorkingDate(iso);
  };
  const clearDatePick = () => {
    if (dateField === 'joined') setJoinedDate('');
    else if (dateField === 'lastWorking') setLastWorkingDate('');
    setDateField(null);
  };

  // ---- Per-user permissions (11 booleans). Owner row → ignored on save. ----
  const initialPerms = (): Record<PermissionKey, boolean> => {
    const p: Record<string, boolean> = {};
    PERMISSION_KEYS.forEach(k => { p[k] = false; });
    return p as Record<PermissionKey, boolean>;
  };
  const [perms, setPerms] = useState<Record<PermissionKey, boolean>>(initialPerms());

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);

  // ---- Persistent filters ----
  const [fsOpen, setFsOpen] = useState(false);
  const { filters, setFilters, resetFilters, activeCount } = useFilterState('team', {
    access: null as 'owner' | 'admin' | 'staff' | 'no_login' | null,
    status: null as 'active' | 'inactive' | null,
  });

  const displayList = useMemo(() => list.filter(m => {
    if (filters.access === 'no_login' && m.has_login) return false;
    if (filters.access === 'owner' && m.access_level !== 'owner') return false;
    if (filters.access === 'admin' && m.access_level !== 'admin') return false;
    if (filters.access === 'staff' && m.access_level !== 'staff') return false;
    if (filters.status === 'active' && !m.is_active) return false;
    if (filters.status === 'inactive' && m.is_active) return false;
    return true;
  }), [list, filters]);

  const load = async () => {
    try {
      const [team, br, sc] = await Promise.all([
        api<TeamMember[]>('/team').catch(() => []),
        api<Branch[]>('/branches').catch(() => []),
        api<Seats>('/team/seats').catch(() => null),
      ]);
      setList(team || []);
      setBranches(br || []);
      setSeats(sc);
    } catch {}
  };
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));

  const resetForm = () => {
    setName(''); setEmail(''); setPhone(''); setPassword(''); setPassword2('');
    setPwdVisible(false); setAccessLevel('staff');
    setRole('Stylist'); setEmployeeId(''); setBranchId(branches[0]?.id || '');
    setBasicSalary(''); setWorkStart('10:00'); setWorkEnd('20:00');
    setWeekOff([]); setCommissionPct(''); setMonthlyTarget('');
    setAddress(''); setIdType('Aadhaar'); setIdNumber(''); setActive(true);
    setJoinedDate(''); setLastWorkingDate('');
    setErr(null); setEmailErr(null); setPwdErr(null);
    // New members: default ALL permissions OFF (owner enables what they need).
    setPerms(initialPerms());
  };

  const openAdd = () => { setEditing(null); resetForm(); setEditOpen(true); };

  const openEdit = (m: TeamMember) => {
    setEditing(m); setErr(null); setEmailErr(null); setPwdErr(null);
    setName(m.name || '');
    setEmail(m.email || '');
    setPhone(m.phone || '');
    setPassword(''); setPassword2(''); setPwdVisible(false);
    setAccessLevel(m.access_level === 'admin' ? 'admin' : 'staff');
    setRole(m.role || 'Stylist');
    setEmployeeId(m.employee_id || '');
    setBranchId(m.branch_id || branches[0]?.id || '');
    setBasicSalary(m.basic_salary != null ? String(m.basic_salary) : '');
    setWorkStart(m.work_start || '10:00');
    setWorkEnd(m.work_end || '20:00');
    setWeekOff(Array.isArray(m.week_off) ? [...m.week_off] : []);
    setCommissionPct(m.commission_pct != null ? String(m.commission_pct) : '');
    setMonthlyTarget(m.monthly_target != null ? String(m.monthly_target) : '');
    setAddress(m.address || '');
    setIdType(m.id_type || 'Aadhaar');
    setIdNumber(m.id_number || '');
    setActive(m.is_active !== false);
    setJoinedDate(m.joined_date || '');
    setLastWorkingDate(m.last_working_date || '');
    // Load per-user permissions (all defaults false if missing).
    const p = initialPerms();
    if (m.permissions) {
      PERMISSION_KEYS.forEach(k => { p[k] = !!m.permissions?.[k]; });
    }
    setPerms(p);
    setEditOpen(true);
  };

  const toggleDay = (day: string) => {
    Haptics.selectionAsync();
    setWeekOff(prev => {
      if (day === 'Flexible') return prev.includes('Flexible') ? [] : ['Flexible'];
      const base = prev.filter(d => d !== 'Flexible');
      return base.includes(day) ? base.filter(d => d !== day) : [...base, day];
    });
  };

  const save = async () => {
    setErr(null); setEmailErr(null); setPwdErr(null);
    if (!name.trim()) { setErr('Name is required'); return; }
    // At least one identifier
    const emailNorm = normalizeEmail(email);
    const phoneNorm = sanitizePhone(phone);
    if (!emailNorm && !phoneNorm) {
      setErr('Email or phone is required — this is the login identifier'); return;
    }
    if (emailNorm) {
      const emsg = emailError(email, { required: false });
      if (emsg) { setEmailErr(emsg); emailRef.current?.focus(); return; }
    }
    if (!isValidTime(workStart) || !isValidTime(workEnd)) {
      setErr('Work times must be HH:MM (24-hour)'); return;
    }
    // Password rules:
    //  - CREATE: required
    //  - EDIT with has_login: optional (blank = keep)
    //  - EDIT legacy profile (no login) with email/phone: required
    const isNew = !editing;
    const editingHasLogin = !!editing?.has_login;
    const needPassword = isNew || (!editingHasLogin);
    if (needPassword) {
      if (!password || password.length < 6) { setPwdErr('Password must be at least 6 characters'); return; }
      if (password !== password2) { setPwdErr('Passwords do not match'); return; }
    } else if (password) {
      if (password.length < 6) { setPwdErr('New password must be at least 6 characters'); return; }
      if (password !== password2) { setPwdErr('Passwords do not match'); return; }
    }

    // ---- Employment date validation (Joined = required on add) -------
    const isNew2 = !editing;
    if (isNew2 && !joinedDate) { setErr('Joined Date is required'); return; }
    if (lastWorkingDate && joinedDate && lastWorkingDate < joinedDate) {
      setErr("Last Working Date can't be before Joined Date"); return;
    }

    setSaving(true);
    try {
      const asNum = (v: string) => { const n = Number(String(v || '').trim()); return Number.isFinite(n) ? n : 0; };
      const body: any = {
        name: name.trim(),
        email: emailNorm,
        phone: phoneNorm,
        access_level: editing?.is_owner_locked ? 'owner' : accessLevel,
        branch_id: branchId || null,
        is_active: active,
        role: role.trim() || 'Stylist',
        employee_id: employeeId.trim(),
        basic_salary: asNum(basicSalary),
        work_start: workStart || '',
        work_end: workEnd || '',
        week_off: weekOff,
        commission_pct: asNum(commissionPct),
        monthly_target: asNum(monthlyTarget),
        address: address.trim(),
        id_type: idType,
        id_number: idNumber.trim(),
        joined_date: joinedDate || null,
        last_working_date: lastWorkingDate || null,
      };
      if (password) body.password = password;
      // Permissions: only send for non-owner. Owner is always full access on backend.
      if (!editing?.is_owner_locked) body.permissions = perms;

      if (editing) {
        body.user_id = editing.user_id || null;
        body.beautician_id = editing.beautician_id || null;
        await api('/team', { method: 'PUT', body });
      } else {
        // POST requires password
        await api('/team', { method: 'POST', body });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false);
      await load();
    } catch (e: any) {
      const raw = (e?.message || 'Failed').toString();
      if (/team limit|seat/i.test(raw)) {
        // Backend seat-cap 403 — close the sheet and surface via alert so user sees it clearly.
        setEditOpen(false);
        await load(); // refresh seat count
        Alert.alert('Team limit reached', raw, [
          { text: 'Close', style: 'cancel' },
          { text: 'View plans', onPress: () => router.push('/subscription' as any) },
        ]);
      } else if (/email/i.test(raw) && /valid/i.test(raw)) setEmailErr(raw);
      else if (/password/i.test(raw)) setPwdErr(raw);
      else setErr(raw);
    } finally { setSaving(false); }
  };

  const remove = (m: TeamMember) => {
    if (m.is_owner_locked) return;
    Alert.alert(
      'Delete team member?',
      `This will remove ${m.name}'s login and staff profile permanently.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              const qs = new URLSearchParams();
              if (m.user_id) qs.append('user_id', m.user_id);
              if (m.beautician_id) qs.append('beautician_id', m.beautician_id);
              await api(`/team?${qs.toString()}`, { method: 'DELETE' });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await load();
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Could not delete');
            }
          } },
      ],
    );
  };

  const roleColors: Record<string, string> = {
    admin: colors.brandPrimary, owner: '#8B5CF6', staff: colors.info,
  };
  const accessLabel = (a: TeamMember['access_level']) => a === 'owner' ? 'Owner' : a === 'admin' ? 'Admin' : a === 'staff' ? 'Staff' : 'No login';

  return (
    <View style={styles.root} testID="team-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Team</Text>
          <Text style={styles.headerSub}>
            {displayList.length} of {list.length} shown
            {seats ? `  ·  ${seats.seats_used} / ${seats.seats_allowed} seats used` : ''}
          </Text>
        </View>
        <FilterHeaderButton count={activeCount} onPress={() => setFsOpen(true)} testID="team-filter-btn" />
        {isOwner && (
          <TouchableOpacity
            testID="add-header"
            onPress={() => {
              if (seats && !seats.can_add) {
                Alert.alert(
                  'Team limit reached',
                  'Add a new branch or upgrade your plan to unlock 10 more seats.',
                  [
                    { text: 'Close', style: 'cancel' },
                    { text: 'View plans', onPress: () => router.push('/subscription' as any) },
                  ],
                );
                return;
              }
              openAdd();
            }}
            style={[
              styles.headerBtn,
              { marginLeft: spacing.sm },
              seats && !seats.can_add && { backgroundColor: colors.borderStrong },
            ]}
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
          {seats && !seats.can_add && isAdmin && (
            <View style={styles.limitBanner} testID="seat-limit-banner">
              <Ionicons name="lock-closed-outline" size={18} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.limitTitle}>Team limit reached</Text>
                <Text style={styles.limitBody}>Add a new branch or upgrade your plan to unlock 10 more seats.</Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/subscription' as any)} style={styles.limitCta}>
                <Text style={styles.limitCtaText}>Upgrade</Text>
              </TouchableOpacity>
            </View>
          )}
          {list.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No team members yet</Text>
              {isOwner && (
                <TouchableOpacity
                  testID="empty-add"
                  style={[styles.ctaBtn, seats && !seats.can_add && { backgroundColor: colors.borderStrong }]}
                  disabled={!!(seats && !seats.can_add)}
                  onPress={openAdd}
                >
                  <Text style={styles.ctaBtnText}>Add first team member</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {displayList.map(m => (
            <View key={m.id} style={styles.row} testID={`team-row-${m.id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(m.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{m.name || 'Unnamed'}</Text>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                  {m.access_level && (
                    <View style={[styles.rolePill, { backgroundColor: (roleColors[m.access_level] || colors.info) + '22' }]}>
                      <Text style={[styles.roleText, { color: roleColors[m.access_level] || colors.info }]}>
                        {accessLabel(m.access_level)}{m.is_owner_locked ? ' 🔒' : ''}
                      </Text>
                    </View>
                  )}
                  {!m.has_login && (
                    <View style={[styles.rolePill, { backgroundColor: colors.warning + '22' }]}>
                      <Text style={[styles.roleText, { color: colors.warning }]}>No login</Text>
                    </View>
                  )}
                  {!m.is_active && <Text style={styles.rowMeta}>· Inactive</Text>}
                  {m.role ? <Text style={styles.rowMeta}>· {m.role}</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                  {m.email ? <Text style={styles.rowMetaSmall} numberOfLines={1}>{m.email}</Text> : null}
                  {m.phone ? <Text style={styles.rowMetaSmall}>{m.email ? ' · ' : ''}{m.phone}</Text> : null}
                </View>
              </View>
              {isAdmin && (
                <>
                  {/* Non-owner admins cannot edit the owner's account (backend 403). */}
                  {(!m.is_owner_locked || isOwner) && (
                    <TouchableOpacity testID={`team-edit-${m.id}`} style={styles.smallBtn} onPress={() => openEdit(m)}>
                      <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
                    </TouchableOpacity>
                  )}
                  {/* Delete is OWNER-ONLY. */}
                  {isOwner && !m.is_owner_locked && (
                    <TouchableOpacity testID={`team-del-${m.id}`} style={[styles.smallBtn, { backgroundColor: '#FDE7E7' }]} onPress={() => remove(m)}>
                      <Ionicons name="trash" size={14} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* ============ Add / Edit sheet ============ */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.kav}
          >
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>
                {editing ? (editing.is_owner_locked ? 'Edit Owner' : 'Edit Team Member') : 'Add Team Member'}
              </Text>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.sheetScroll}
                contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
                showsVerticalScrollIndicator={true}
              >
                <View style={styles.field}>
                  <Text style={styles.label}>Full name *</Text>
                  <TextInput testID="team-name-input" value={name} onChangeText={setName} placeholder="e.g. Preetha P" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>

                {/* ---- Login identifier (email OR phone) ---- */}
                <View style={styles.loginBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="key-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.loginTitle}>Login credentials</Text>
                    {editing?.has_login && (
                      <View style={styles.linkedBadge}><Text style={styles.linkedBadgeText}>Linked</Text></View>
                    )}
                  </View>
                  <Text style={styles.loginHint}>
                    {editing?.is_owner_locked
                      ? 'Owner login — you can update name, email, phone and password. Access level is locked.'
                      : 'Provide email OR phone (or both). They\'ll use this + password to sign in.'}
                  </Text>

                  <View style={styles.field}>
                    <Text style={styles.label}>Email {(!phone) ? '*' : '(optional if phone set)'}</Text>
                    <TextInput
                      testID="team-email-input"
                      ref={emailRef}
                      value={email}
                      onChangeText={(v) => { setEmail(v); if (emailErr) setEmailErr(null); }}
                      onBlur={() => { if (email) { const m = emailError(email, { required: false }); if (m) setEmailErr(m); } }}
                      placeholder="staff@salon.com"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
                      style={[styles.input, emailErr && { borderColor: colors.error, borderWidth: 1, backgroundColor: '#FDECEC' }]}
                    />
                    {emailErr && <Text style={styles.errSmall}>{emailErr}</Text>}
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>Phone {(!email) ? '*' : '(can also log in)'}</Text>
                    <TextInput
                      testID="team-phone-input"
                      value={phone}
                      onChangeText={(v) => setPhone(sanitizePhone(v))}
                      placeholder="10-digit number"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="number-pad" maxLength={PHONE_MAX}
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>
                      {editing?.has_login ? 'New password (leave blank to keep current)' : 'Password *'}
                    </Text>
                    <View style={{ position: 'relative' }}>
                      <TextInput
                        testID="team-password"
                        value={password}
                        onChangeText={(v) => { setPassword(v); if (pwdErr) setPwdErr(null); }}
                        placeholder={editing?.has_login ? '••••••' : 'Min 6 characters'}
                        placeholderTextColor={colors.onSurfaceTertiary}
                        secureTextEntry={!pwdVisible}
                        autoCapitalize="none" autoCorrect={false}
                        style={[styles.input, { paddingRight: 40 }]}
                      />
                      <TouchableOpacity onPress={() => setPwdVisible(v => !v)} style={styles.eyeBtn} testID="team-pwd-eye">
                        <Ionicons name={pwdVisible ? 'eye-off' : 'eye'} size={18} color={colors.onSurfaceTertiary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {(!editing?.has_login || password) && (
                    <View style={styles.field}>
                      <Text style={styles.label}>Confirm password *</Text>
                      <TextInput
                        testID="team-password2"
                        value={password2}
                        onChangeText={(v) => { setPassword2(v); if (pwdErr) setPwdErr(null); }}
                        placeholder="Re-enter password"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        secureTextEntry={!pwdVisible} autoCapitalize="none" autoCorrect={false}
                        style={styles.input}
                      />
                    </View>
                  )}
                  {pwdErr && <Text style={styles.errSmall}>{pwdErr}</Text>}
                </View>

                {/* ---- Access level ---- */}
                <View style={styles.field}>
                  <Text style={styles.label}>Access level</Text>
                  {editing?.is_owner_locked ? (
                    <View style={styles.ownerLockRow}>
                      <Ionicons name="lock-closed" size={14} color={colors.onSurfaceSecondary} />
                      <Text style={styles.ownerLockText}>Owner (locked)</Text>
                    </View>
                  ) : !isOwner ? (
                    // Non-owner admins cannot change access level — backend
                    // ignores the field silently, so we show it read-only.
                    <View style={styles.ownerLockRow} testID="team-access-readonly">
                      <Ionicons name="lock-closed" size={14} color={colors.onSurfaceSecondary} />
                      <Text style={styles.ownerLockText}>
                        {accessLabel(accessLevel)}{'  '}(read-only)
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        testID="team-access-staff"
                        onPress={() => setAccessLevel('staff')}
                        style={[styles.suggChip, accessLevel === 'staff' && styles.suggChipActive, { flex: 1 }]}
                      >
                        <Text style={[styles.suggChipText, accessLevel === 'staff' && styles.suggChipTextActive]}>Staff</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        testID="team-access-admin"
                        onPress={() => setAccessLevel('admin')}
                        style={[styles.suggChip, accessLevel === 'admin' && styles.suggChipActive, { flex: 1 }]}
                      >
                        <Text style={[styles.suggChipText, accessLevel === 'admin' && styles.suggChipTextActive]}>Admin</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* ---- Permissions (11 keys) — OWNER-ONLY editor ---- */}
                {!editing?.is_owner_locked && isOwner && (
                  <View style={styles.permsBox}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="shield-checkmark-outline" size={16} color={colors.brandPrimary} />
                      <Text style={styles.loginTitle}>Feature access</Text>
                    </View>
                    <Text style={styles.loginHint}>
                      Toggle exactly what this member can use. Changes take effect on their next tap — no re-login.
                    </Text>
                    <View style={styles.permsList}>
                      {PERMISSION_KEYS.map(k => (
                        <View key={k} style={styles.permRow}>
                          <Text style={styles.permLabel}>{PERMISSION_LABELS[k]}</Text>
                          <Switch
                            testID={`team-perm-${k}`}
                            value={!!perms[k]}
                            onValueChange={(v) => setPerms(prev => ({ ...prev, [k]: v }))}
                            trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
                          />
                        </View>
                      ))}
                    </View>
                    <View style={styles.permsBulkRow}>
                      <TouchableOpacity
                        testID="team-perm-all"
                        style={styles.permBulkBtn}
                        onPress={() => {
                          const on: Record<string, boolean> = {};
                          PERMISSION_KEYS.forEach(k => { on[k] = true; });
                          setPerms(on as Record<PermissionKey, boolean>);
                        }}
                      >
                        <Text style={styles.permBulkText}>Enable all</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        testID="team-perm-none"
                        style={[styles.permBulkBtn, { backgroundColor: colors.surfaceTertiary }]}
                        onPress={() => setPerms(initialPerms())}
                      >
                        <Text style={[styles.permBulkText, { color: colors.onSurfaceSecondary }]}>Disable all</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                {editing?.is_owner_locked && (
                  <View style={styles.ownerLockRow}>
                    <Ionicons name="shield" size={14} color={colors.brandPrimary} />
                    <Text style={styles.ownerLockText}>Owner has full access to everything</Text>
                  </View>
                )}
                {!editing?.is_owner_locked && !isOwner && (
                  <View style={styles.ownerLockRow} testID="team-perms-locked-note">
                    <Ionicons name="information-circle-outline" size={14} color={colors.onSurfaceSecondary} />
                    <Text style={styles.ownerLockText}>
                      Feature permissions can only be changed by the salon owner.
                    </Text>
                  </View>
                )}

                {/* ---- OWNER-ONLY FIELDS (admins get 403 on the backend if they
                       try to change these). We hide them entirely for admins. ---- */}
                {isOwner && (
                  <>
                    {/* ---- Employment information (drives leave accrual) ---- */}
                    <View style={styles.field}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="briefcase-outline" size={14} color={colors.brandPrimary} />
                        <Text style={[styles.label, { color: colors.brandPrimary, marginBottom: 0 }]}>Employment information</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: 8 }}>
                        Joined Date is the actual employment start — it drives monthly leave accrual (not the date added here).
                      </Text>
                      {editing && !editing.is_owner_locked && !editing.joined_date && (
                        <View style={{ backgroundColor: '#FFF6E0', borderColor: '#F0C060', borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 8, flexDirection: 'row', gap: 6 }}>
                          <Ionicons name="alert-circle-outline" size={14} color="#8A5300" />
                          <Text style={{ flex: 1, fontSize: 11, color: '#8A5300' }}>
                            Joined Date required — set it to enable monthly leave accrual for this staff member.
                          </Text>
                        </View>
                      )}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.label}>Joined date *</Text>
                          <TouchableOpacity
                            testID="team-joined-date-input"
                            onPress={() => openDatePicker('joined')}
                            style={[styles.input, styles.dateInputBtn]}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="calendar-outline" size={16} color={joinedDate ? colors.brandPrimary : colors.onSurfaceTertiary} />
                            <Text style={[styles.dateInputText, !joinedDate && { color: colors.onSurfaceTertiary }]} numberOfLines={1}>
                              {joinedDate ? fmtDateLabel(joinedDate) || joinedDate : 'Select date'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.label}>Last working date <Text style={{ color: colors.onSurfaceTertiary, fontWeight: '400' }}>(if left)</Text></Text>
                          <TouchableOpacity
                            testID="team-last-working-input"
                            onPress={() => openDatePicker('lastWorking')}
                            style={[styles.input, styles.dateInputBtn]}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="calendar-outline" size={16} color={lastWorkingDate ? colors.brandPrimary : colors.onSurfaceTertiary} />
                            <Text style={[styles.dateInputText, !lastWorkingDate && { color: colors.onSurfaceTertiary }]} numberOfLines={1}>
                              {lastWorkingDate ? fmtDateLabel(lastWorkingDate) || lastWorkingDate : 'Select date'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {joinedDate ? (
                        <Text style={{ fontSize: 11, marginTop: 6, color: lastWorkingDate ? colors.onSurfaceTertiary : colors.success, fontWeight: '600' }}>
                          Status: {lastWorkingDate ? `Former employee (accrual stopped after ${lastWorkingDate})` : 'Active'}
                        </Text>
                      ) : null}
                    </View>

                    {/* ---- Job title (Role) ---- */}
                <View style={styles.field}>
                  <Text style={styles.label}>Job title</Text>
                  <TextInput testID="team-role-input" value={role} onChangeText={setRole} placeholder="Type role or pick below" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                    {ROLE_SUGGESTIONS.map(r => (
                      <TouchableOpacity key={r} onPress={() => setRole(r)} style={[styles.suggChip, role === r && styles.suggChipActive]}>
                        <Text style={[styles.suggChipText, role === r && styles.suggChipTextActive]}>{r}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* Employee ID */}
                <View style={styles.field}>
                  <Text style={styles.label}>Employee ID</Text>
                  <TextInput testID="team-empid-input" value={employeeId} onChangeText={setEmployeeId} placeholder="e.g. EMP-001" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>

                {/* Basic salary */}
                <View style={styles.field}>
                  <Text style={styles.label}>Basic salary (₹)</Text>
                  <TextInput
                    testID="team-basic-salary-input"
                    value={basicSalary}
                    onChangeText={(v) => setBasicSalary(v.replace(/[^0-9.]/g, ''))}
                    placeholder="0" placeholderTextColor={colors.onSurfaceTertiary}
                    keyboardType="numeric" style={styles.input}
                  />
                </View>
                  </>
                )}
                {/* End of first owner-only block. Branch + Work times + Week off
                    are admin-editable so they live outside the owner gate. */}

                {/* Branch */}
                {branches.length > 0 && (
                  <View style={styles.field}>
                    <Text style={styles.label}>Branch</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                      {branches.map(br => (
                        <TouchableOpacity
                          key={br.id}
                          testID={`team-branch-${br.id}`}
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
                    <Text style={styles.label}>Work start</Text>
                    <TextInput
                      testID="team-work-start"
                      value={workStart}
                      onChangeText={(v) => setWorkStart(sanitizeTime(v))}
                      placeholder="10:00" placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="numbers-and-punctuation" maxLength={5}
                      style={styles.input}
                    />
                  </View>
                  <View style={styles.gridField}>
                    <Text style={styles.label}>Work end</Text>
                    <TextInput
                      testID="team-work-end"
                      value={workEnd}
                      onChangeText={(v) => setWorkEnd(sanitizeTime(v))}
                      placeholder="20:00" placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="numbers-and-punctuation" maxLength={5}
                      style={styles.input}
                    />
                  </View>
                </View>

                {/* Week off */}
                <View style={styles.field}>
                  <Text style={styles.label}>Week off</Text>
                  <View style={styles.chipsWrap}>
                    {WEEK_DAYS.map(d => {
                      const sel = weekOff.includes(d);
                      return (
                        <TouchableOpacity key={d} onPress={() => toggleDay(d)} style={[styles.suggChip, sel && styles.suggChipActive]}>
                          <Text style={[styles.suggChipText, sel && styles.suggChipTextActive]}>{d}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    <TouchableOpacity onPress={() => toggleDay('Flexible')} style={[styles.suggChip, weekOff.includes('Flexible') && styles.suggChipActive]}>
                      <Text style={[styles.suggChipText, weekOff.includes('Flexible') && styles.suggChipTextActive]}>Flexible</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Second owner-only block: Commission + target, Address, ID type, ID number */}
                {isOwner && (
                  <>
                {/* Commission + target */}
                <View style={styles.gridRow}>
                  <View style={styles.gridField}>
                    <Text style={styles.label}>Commission %</Text>
                    <TextInput
                      testID="team-commission"
                      value={commissionPct}
                      onChangeText={(v) => setCommissionPct(v.replace(/[^0-9.]/g, ''))}
                      placeholder="0" placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="numeric" style={styles.input}
                    />
                  </View>
                  <View style={styles.gridField}>
                    <Text style={styles.label}>Monthly target (₹)</Text>
                    <TextInput
                      testID="team-monthly-target"
                      value={monthlyTarget}
                      onChangeText={(v) => setMonthlyTarget(v.replace(/[^0-9.]/g, ''))}
                      placeholder="0" placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="numeric" style={styles.input}
                    />
                  </View>
                </View>

                {/* Address */}
                <View style={styles.field}>
                  <Text style={styles.label}>Address</Text>
                  <TextInput
                    testID="team-address" value={address} onChangeText={setAddress}
                    placeholder="Home address" placeholderTextColor={colors.onSurfaceTertiary}
                    multiline style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                  />
                </View>

                {/* ID type + number */}
                <View style={styles.field}>
                  <Text style={styles.label}>ID type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                    {ID_TYPES.map(t => (
                      <TouchableOpacity key={t} onPress={() => setIdType(t)} style={[styles.suggChip, idType === t && styles.suggChipActive]}>
                        <Text style={[styles.suggChipText, idType === t && styles.suggChipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>ID number</Text>
                  <TextInput testID="team-id-number" value={idNumber} onChangeText={setIdNumber} placeholder="e.g. 1234-5678-9012" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>
                </>)}
                {/* End of owner-only fields */}

                {!editing?.is_owner_locked && (
                  <View style={styles.switchRow}>
                    <Text style={styles.label}>Active</Text>
                    <Switch testID="team-active-switch" value={active} onValueChange={setActive} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} />
                  </View>
                )}

                {err && <Text style={styles.err}>{err}</Text>}
              </ScrollView>

              <TouchableOpacity testID="team-save-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Add'}</Text>
                )}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* ============ Employment date picker (Joined / Last Working) ============ */}
      {dateField && Platform.OS !== 'web' ? (
        Platform.OS === 'ios' ? (
          <Modal transparent animationType="fade" visible onRequestClose={() => setDateField(null)}>
            <Pressable style={styles.dateBackdrop} onPress={() => setDateField(null)}>
              <Pressable style={styles.dateSheet} onPress={() => {}}>
                <View style={styles.handle} />
                <Text style={styles.dateSheetTitle}>
                  {dateField === 'joined' ? 'Joined date' : 'Last working date'}
                </Text>
                <DateTimePicker
                  testID="employment-date-native"
                  value={new Date(
                    (dateField === 'joined' ? joinedDate : lastWorkingDate) && isValidIso(dateField === 'joined' ? joinedDate : lastWorkingDate)
                      ? (dateField === 'joined' ? joinedDate : lastWorkingDate) + 'T00:00:00'
                      : todayIso + 'T00:00:00'
                  )}
                  mode="date"
                  display="spinner"
                  maximumDate={dateField === 'lastWorking' ? new Date(todayIso + 'T00:00:00') : undefined}
                  minimumDate={dateField === 'lastWorking' && isValidIso(joinedDate) ? new Date(joinedDate + 'T00:00:00') : undefined}
                  onChange={(_, d) => { if (d) applyDatePick(d.toISOString().slice(0, 10)); }}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.dateDone, { flex: 1, backgroundColor: '#F3F3F3' }]} onPress={clearDatePick}>
                    <Text style={[styles.dateDoneText, { color: colors.onSurfaceSecondary }]}>Clear</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="employment-date-done"
                    style={[styles.dateDone, { flex: 1 }]}
                    onPress={() => { Haptics.selectionAsync().catch(() => {}); setDateField(null); }}
                  >
                    <Text style={styles.dateDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        ) : (
          <DateTimePicker
            testID="employment-date-native"
            value={new Date(
              (dateField === 'joined' ? joinedDate : lastWorkingDate) && isValidIso(dateField === 'joined' ? joinedDate : lastWorkingDate)
                ? (dateField === 'joined' ? joinedDate : lastWorkingDate) + 'T00:00:00'
                : todayIso + 'T00:00:00'
            )}
            mode="date"
            display="default"
            maximumDate={dateField === 'lastWorking' ? new Date(todayIso + 'T00:00:00') : undefined}
            minimumDate={dateField === 'lastWorking' && isValidIso(joinedDate) ? new Date(joinedDate + 'T00:00:00') : undefined}
            onChange={(evt, d) => {
              setDateField(null);
              if (evt?.type === 'set' && d) applyDatePick(d.toISOString().slice(0, 10));
            }}
          />
        )
      ) : (
        <Modal
          transparent
          animationType="fade"
          visible={!!dateField}
          onRequestClose={() => setDateField(null)}
        >
          <Pressable style={styles.dateBackdrop} onPress={() => setDateField(null)}>
            <Pressable style={styles.dateSheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.dateSheetTitle}>
                {dateField === 'joined' ? 'Joined date' : 'Last working date'}
              </Text>
              <Calendar
                testID="employment-date-calendar"
                current={
                  (dateField === 'joined' ? joinedDate : lastWorkingDate) && isValidIso(dateField === 'joined' ? joinedDate : lastWorkingDate)
                    ? (dateField === 'joined' ? joinedDate : lastWorkingDate)
                    : todayIso
                }
                maxDate={dateField === 'lastWorking' ? todayIso : undefined}
                minDate={dateField === 'lastWorking' && isValidIso(joinedDate) ? joinedDate : undefined}
                onDayPress={(d) => {
                  applyDatePick(d.dateString);
                  setDateField(null);
                }}
                markedDates={
                  (dateField === 'joined' ? joinedDate : lastWorkingDate)
                    ? { [dateField === 'joined' ? joinedDate : lastWorkingDate]: { selected: true, selectedColor: colors.brandPrimary } }
                    : {}
                }
                theme={{
                  backgroundColor: colors.surface,
                  calendarBackground: colors.surface,
                  selectedDayBackgroundColor: colors.brandPrimary,
                  selectedDayTextColor: '#fff',
                  todayTextColor: colors.brandPrimary,
                  dayTextColor: colors.onSurface,
                  monthTextColor: colors.onSurface,
                  arrowColor: colors.brandPrimary,
                }}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[styles.dateDone, { flex: 1, backgroundColor: '#F3F3F3' }]} onPress={clearDatePick}>
                  <Text style={[styles.dateDoneText, { color: colors.onSurfaceSecondary }]}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.dateDone, { flex: 1 }]} onPress={() => setDateField(null)}>
                  <Text style={styles.dateDoneText}>Close</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* ============ Filter sheet ============ */}
      <FilterSheet
        visible={fsOpen}
        onClose={() => setFsOpen(false)}
        onClear={resetFilters}
        title="Filter team"
        testID="team-filter-sheet"
      >
        <FilterSection label="Access">
          <FilterChip label="Any" selected={!filters.access} onPress={() => setFilters({ access: null })} testID="team-fs-access-any" />
          <FilterChip label="Owner" selected={filters.access === 'owner'} onPress={() => setFilters({ access: 'owner' })} testID="team-fs-access-owner" />
          <FilterChip label="Admin" selected={filters.access === 'admin'} onPress={() => setFilters({ access: 'admin' })} testID="team-fs-access-admin" />
          <FilterChip label="Staff" selected={filters.access === 'staff'} onPress={() => setFilters({ access: 'staff' })} testID="team-fs-access-staff" />
          <FilterChip label="No login" selected={filters.access === 'no_login'} onPress={() => setFilters({ access: 'no_login' })} testID="team-fs-access-nologin" />
        </FilterSection>
        <FilterSection label="Status">
          <FilterChip label="Any" selected={!filters.status} onPress={() => setFilters({ status: null })} testID="team-fs-status-any" />
          <FilterChip label="Active" selected={filters.status === 'active'} onPress={() => setFilters({ status: 'active' })} testID="team-fs-status-active" />
          <FilterChip label="Inactive" selected={filters.status === 'inactive'} onPress={() => setFilters({ status: 'inactive' })} testID="team-fs-status-inactive" />
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
  rowMetaSmall: { fontSize: 11, color: colors.onSurfaceSecondary },
  rolePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  roleText: { fontSize: 10, fontWeight: '700' },
  smallBtn: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 16, color: colors.onSurfaceTertiary },
  ctaBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  kav: { width: '100%', maxHeight: '92%', alignSelf: 'center' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md, width: '100%', maxWidth: 480, alignSelf: 'center', flexShrink: 1 },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  // ---- Employment date picker ----
  dateInputBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  dateInputText: { flex: 1, fontSize: 14, color: colors.onSurface, fontWeight: '500' },
  dateBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dateSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  dateSheetTitle: { fontSize: 16, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  dateDone: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDoneText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },

  gridRow: { flexDirection: 'row', gap: spacing.md },
  gridField: { flex: 1, gap: 6 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  suggChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  suggChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  suggChipText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceSecondary },
  suggChipTextActive: { color: '#fff', fontWeight: '700' },

  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  err: { color: colors.error, fontSize: 13 },
  errSmall: { color: colors.error, fontSize: 11, fontWeight: '600' },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  loginBox: {
    backgroundColor: colors.brandTertiary + '55',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandTertiary,
    padding: spacing.md, gap: spacing.sm,
  },
  loginTitle: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  loginHint: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2, marginBottom: 4 },
  linkedBadge: { backgroundColor: colors.success + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  linkedBadgeText: { fontSize: 10, fontWeight: '700', color: colors.success },
  eyeBtn: { position: 'absolute', right: 8, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  ownerLockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.md, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm },
  ownerLockText: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceSecondary },

  permsBox: {
    backgroundColor: '#FFF8E7',
    borderRadius: radius.md, borderWidth: 1, borderColor: '#F0D97A',
    padding: spacing.md, gap: spacing.sm,
  },
  permsList: { gap: 4, marginTop: spacing.xs },
  permRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0D97A',
  },
  permLabel: { fontSize: 13, fontWeight: '600', color: colors.onSurface, flex: 1 },
  permsBulkRow: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  permBulkBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    backgroundColor: colors.brandPrimary, borderRadius: radius.sm,
  },
  permBulkText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  limitBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: '#FFF3E0', borderWidth: 1, borderColor: '#F0C36D',
    marginBottom: spacing.md,
  },
  limitTitle: { fontSize: 13, fontWeight: '800', color: '#8A4B00' },
  limitBody: { fontSize: 11, color: '#8A4B00', marginTop: 2 },
  limitCta: {
    backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.pill,
  },
  limitCtaText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
