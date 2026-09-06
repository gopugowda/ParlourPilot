// Branches management — matches Web app layout & fields.
// Web parity: modal includes address, contact, GST toggle, invoice prefix/footer, geofence (with radius on mobile).
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Modal, Pressable, TextInput, KeyboardAvoidingView, Platform, Switch, Alert,
  Image as RNImage,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { branchApi } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';
import { sanitizePhone, PHONE_MAX, emailError, normalizeEmail } from '@/src/utils/validators';

type Branch = any;

export default function BranchesScreen() {
  const router = useRouter();
  const { refreshBranches, currentBranchId, selectBranch } = useAuth();
  const [list, setList] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);

  // ---- Modal form state (mirrors web app fields) ----
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [country, setCountry] = useState('India');
  const [postal, setPostal] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxNumber, setTaxNumber] = useState('');
  const [taxPct, setTaxPct] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [invoiceFooter, setInvoiceFooter] = useState('');
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [checkInRadius, setCheckInRadius] = useState('');
  const [checkOutRadius, setCheckOutRadius] = useState('');
  const [isHead, setIsHead] = useState(false);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [capturingLoc, setCapturingLoc] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList(await branchApi.list() as any); await refreshBranches(); }
    catch (e: any) { Alert.alert('Error', e.message || String(e)); }
    finally { setLoading(false); }
  }, [refreshBranches]);
  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setName(''); setLogo(null);
    setAddr1(''); setAddr2(''); setCity(''); setStateVal(''); setCountry('India'); setPostal('');
    setEmail(''); setPhone('');
    setTaxEnabled(false); setTaxNumber(''); setTaxPct('');
    setInvoicePrefix(''); setInvoiceFooter('');
    setLat(''); setLng('');
    setGeoEnabled(false);
    setCheckInRadius(''); setCheckOutRadius('');
    setIsHead(false); setActive(true);
    setErr(null); setEmailErr(null);
  };

  const openAdd = () => {
    // Adding an EXTRA branch requires a paid subscription → route to checkout first.
    router.push('/checkout?type=branch');
  };
  const openEdit = (b: Branch) => {
    setEditing(b); resetForm();
    setName(b.name || ''); setLogo(b.logo || null);
    setAddr1(b.address || ''); setAddr2(b.address_line_2 || '');
    setCity(b.city || ''); setStateVal(b.state || ''); setCountry(b.country || 'India'); setPostal(b.postal_code || '');
    setEmail(b.email || ''); setPhone(b.phone || '');
    setTaxEnabled(!!b.tax_enabled); setTaxNumber(b.tax_number || '');
    setTaxPct(b.tax_percentage != null ? String(b.tax_percentage) : '');
    setInvoicePrefix(b.invoice_prefix || '');
    setInvoiceFooter(b.receipt_footer || '');
    setLat(b.latitude != null ? String(b.latitude) : '');
    setLng(b.longitude != null ? String(b.longitude) : '');
    // Backend field names:
    //   geofence_radius_m  → check-in radius (m)
    //   checkout_radius_m  → check-out radius (m)  (also drives auto-checkout)
    //   geo_fencing_enabled → master toggle
    setCheckInRadius(b.geofence_radius_m != null ? String(b.geofence_radius_m) : '');
    setCheckOutRadius(b.checkout_radius_m != null ? String(b.checkout_radius_m) : '');
    setGeoEnabled(!!b.geo_fencing_enabled);
    setIsHead(!!b.is_head); setActive(b.active !== false);
    setEditOpen(true);
  };

  const pickLogo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) Alert.alert('Permission needed', 'Photos permission is required. Enable it in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], base64: true, quality: 0.6,
      });
      if (!result.canceled && result.assets?.[0]?.base64) {
        const a = result.assets[0];
        setLogo(`data:image/${a.uri.endsWith('.png') ? 'png' : 'jpeg'};base64,${a.base64}`);
        Haptics.selectionAsync();
      }
    } catch (e: any) { Alert.alert('Error', e.message || 'Could not pick image'); }
  };

  const captureMyLocation = async () => {
    setCapturingLoc(true);
    try {
      const { getFreshLocation } = await import('@/src/utils/attendance');
      const loc = await getFreshLocation();
      if (!loc) { Alert.alert('Location', 'Could not read GPS. Enable location and try again.'); return; }
      setLat(loc.coords.latitude.toFixed(6));
      setLng(loc.coords.longitude.toFixed(6));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally { setCapturingLoc(false); }
  };

  const save = async () => {
    setErr(null); setEmailErr(null);
    if (!name.trim()) { setErr('Branch name is required'); return; }
    if (email) {
      const em = emailError(email, { required: false });
      if (em) { setEmailErr(em); return; }
    }
    if (taxEnabled && taxPct) {
      const t = parseFloat(taxPct);
      if (!Number.isFinite(t) || t < 0 || t > 100) { setErr('Tax % must be between 0 and 100'); return; }
    }
    setSaving(true);
    try {
      const body: any = {
        name: name.trim(),
        logo,
        address: addr1.trim(),
        address_line_2: addr2.trim(),
        city: city.trim(),
        state: stateVal.trim(),
        country: country.trim(),
        postal_code: postal.trim(),
        email: normalizeEmail(email),
        phone: sanitizePhone(phone),
        tax_enabled: taxEnabled,
        tax_number: taxEnabled ? taxNumber.trim() : '',
        tax_percentage: taxEnabled && taxPct ? parseFloat(taxPct) : 0,
        invoice_prefix: invoicePrefix.trim(),
        receipt_footer: invoiceFooter.trim(),
        latitude: lat.trim() ? parseFloat(lat) : null,
        longitude: lng.trim() ? parseFloat(lng) : null,
        // Mirror web app: master toggle + two independent radii.
        geo_fencing_enabled: geoEnabled,
        geofence_radius_m: checkInRadius.trim() ? parseInt(checkInRadius, 10) : 100,
        checkout_radius_m: checkOutRadius.trim() ? parseInt(checkOutRadius, 10) : 1000,
        is_head: isHead,
        active,
      };
      if (editing) await branchApi.update(editing.id, body);
      else await branchApi.create(body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditOpen(false);
      await load();
    } catch (e: any) { setErr(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (b: Branch) => {
    Alert.alert('Delete branch?', `This removes ${b.name} permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await branchApi.remove(b.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            if (currentBranchId === b.id) await selectBranch(null);
            await load();
          } catch (e: any) { Alert.alert('Cannot delete', e.message || 'Failed'); }
        } },
    ]);
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
          <Text style={styles.headerTitle}>Branches</Text>
          <Text style={styles.headerSub}>Your salon locations · {list.length} branch{list.length === 1 ? '' : 'es'}</Text>
        </View>
        <TouchableOpacity onPress={openAdd} style={styles.headerBtn}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          {list.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={48} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>No branches yet</Text>
              <TouchableOpacity style={styles.ctaBtn} onPress={openAdd}>
                <Text style={styles.ctaBtnText}>Add first branch</Text>
              </TouchableOpacity>
            </View>
          )}
          {list.map(b => (
            <View key={b.id} style={styles.row}>
              {b.logo ? (
                <RNImage source={{ uri: b.logo }} style={styles.rowLogo} resizeMode="contain" />
              ) : (
                <View style={styles.rowLogoPh}><Ionicons name="business-outline" size={18} color={colors.brandPrimary} /></View>
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.rowName}>{b.name}</Text>
                  {b.is_head && (<View style={styles.headBadge}><Text style={styles.headBadgeText}>HEAD</Text></View>)}
                  {!b.active && (<View style={styles.inactiveBadge}><Text style={styles.inactiveBadgeText}>INACTIVE</Text></View>)}
                  {currentBranchId === b.id && (<View style={styles.activeBadge}><Text style={styles.activeBadgeText}>CURRENT</Text></View>)}
                </View>
                <Text style={styles.rowMeta}>
                  {[b.city, b.state, b.country].filter(Boolean).join(', ') || 'No address set'}
                  {b.invoice_prefix ? ` · ${b.invoice_prefix}` : ''}
                  {b.geo_fencing_enabled && b.latitude != null && b.longitude != null ? ' · 📍 geo-fencing on' : ''}
                </Text>
              </View>
              <TouchableOpacity style={styles.smallBtn} onPress={() => openEdit(b)} testID={`branch-edit-${b.id}`}>
                <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
              </TouchableOpacity>
              {!b.is_head && (
                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FDE7E7' }]} onPress={() => remove(b)} testID={`branch-del-${b.id}`}>
                  <Ionicons name="trash" size={14} color={colors.error} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {list.length > 0 && (
            <TouchableOpacity testID="add-branch-cta" style={[styles.ctaBtn, { alignSelf: 'stretch', marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]} onPress={openAdd}>
              <Ionicons name="add-circle" size={18} color="#fff" />
              <Text style={styles.ctaBtnText}>Add branch (paid)</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* ============ Edit / Add sheet ============ */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit branch' : 'Add branch'}</Text>
              <Text style={styles.sheetSubtitle}>Location details.</Text>

              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
                {/* Branch name */}
                <View style={styles.field}>
                  <Text style={styles.label}>Branch name *</Text>
                  <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="e.g. Head Branch" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>

                {/* Logo */}
                <View>
                  <Text style={styles.label}>Branch logo</Text>
                  <View style={styles.logoRow}>
                    {logo ? (
                      <RNImage source={{ uri: logo }} style={styles.logoImg} resizeMode="contain" />
                    ) : (
                      <View style={styles.logoPlaceholder}><Ionicons name="image-outline" size={26} color={colors.onSurfaceTertiary} /></View>
                    )}
                    <View style={{ flex: 1, gap: 6 }}>
                      <TouchableOpacity onPress={pickLogo} style={styles.logoBtn}>
                        <Ionicons name="camera-outline" size={14} color={colors.brandPrimary} />
                        <Text style={styles.logoBtnText}>{logo ? 'Change logo' : 'Upload logo'}</Text>
                      </TouchableOpacity>
                      {logo && (
                        <TouchableOpacity onPress={() => setLogo(null)} style={[styles.logoBtn, { backgroundColor: '#FEE' }]}>
                          <Ionicons name="trash-outline" size={14} color={colors.error} />
                          <Text style={[styles.logoBtnText, { color: colors.error }]}>Remove</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  <Text style={styles.help}>Shown on this branch&apos;s dashboard & invoices. PNG/JPG/SVG · max 3 MB</Text>
                </View>

                {/* Address 1 & 2 */}
                <View style={styles.field}>
                  <Text style={styles.label}>Address Line 1 *</Text>
                  <TextInput value={addr1} onChangeText={setAddr1} style={styles.input} placeholder="Building, street" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Address Line 2</Text>
                  <TextInput value={addr2} onChangeText={setAddr2} style={styles.input} placeholder="Area, landmark (optional)" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>

                {/* City / State */}
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>City *</Text>
                    <TextInput value={city} onChangeText={setCity} style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
                  </View>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>State</Text>
                    <TextInput value={stateVal} onChangeText={setStateVal} style={styles.input} placeholder="State / Province" placeholderTextColor={colors.onSurfaceTertiary} />
                  </View>
                </View>

                {/* Country / Postal */}
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>Country</Text>
                    <TextInput value={country} onChangeText={setCountry} style={styles.input} placeholder="e.g. India" placeholderTextColor={colors.onSurfaceTertiary} />
                  </View>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>Postal Code *</Text>
                    <TextInput value={postal} onChangeText={setPostal} keyboardType="numeric" style={styles.input} placeholder="ZIP / PIN" placeholderTextColor={colors.onSurfaceTertiary} />
                  </View>
                </View>

                {/* Email / Phone */}
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>Email ID</Text>
                    <TextInput
                      value={email}
                      onChangeText={(v) => { setEmail(v); if (emailErr) setEmailErr(null); }}
                      style={[styles.input, emailErr && styles.inputErr]}
                      placeholder="branch@salon.com"
                      autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
                      placeholderTextColor={colors.onSurfaceTertiary}
                    />
                    {emailErr && <Text style={styles.errSmall}>{emailErr}</Text>}
                  </View>
                  <View style={[styles.field, { flex: 1 }]}>
                    <Text style={styles.label}>Phone Number *</Text>
                    <TextInput
                      value={phone} onChangeText={(v) => setPhone(sanitizePhone(v))}
                      keyboardType="phone-pad" maxLength={PHONE_MAX}
                      style={styles.input} placeholderTextColor={colors.onSurfaceTertiary}
                    />
                  </View>
                </View>

                {/* Tax */}
                <View style={styles.switchRow}>
                  <Text style={styles.label}>Enable GST / tax</Text>
                  <Switch value={taxEnabled} onValueChange={setTaxEnabled} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={taxEnabled ? colors.brandPrimary : '#f4f3f4'} />
                </View>
                {taxEnabled && (
                  <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    <View style={[styles.field, { flex: 2 }]}>
                      <Text style={styles.label}>GST / Tax number</Text>
                      <TextInput value={taxNumber} onChangeText={setTaxNumber} autoCapitalize="characters" style={styles.input} placeholder="e.g. 29ABCDE1234F1Z5" placeholderTextColor={colors.onSurfaceTertiary} />
                    </View>
                    <View style={[styles.field, { flex: 1 }]}>
                      <Text style={styles.label}>Tax %</Text>
                      <TextInput value={taxPct} onChangeText={(v) => setTaxPct(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={styles.input} placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} />
                    </View>
                  </View>
                )}

                {/* Invoice prefix + footer */}
                <View style={styles.field}>
                  <Text style={styles.label}>Invoice prefix</Text>
                  <TextInput value={invoicePrefix} onChangeText={setInvoicePrefix} autoCapitalize="characters" style={styles.input} placeholder="e.g. INV, B1" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Invoice footer (tax / registration line)</Text>
                  <TextInput value={invoiceFooter} onChangeText={setInvoiceFooter} style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline placeholder="Shown under this branch's address on every bill" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>

                {/* Attendance geofence — mirrors web app card */}
                <View style={[styles.geoBox, geoEnabled && styles.geoBoxActive]}>
                  <View style={styles.geoHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      <Ionicons name="location" size={16} color={colors.brandPrimary} />
                      <Text style={styles.geoTitle}>Attendance geo-fencing</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.geoStateBadge, geoEnabled ? styles.geoStateOn : styles.geoStateOff]}>
                        {geoEnabled ? 'ON' : 'OFF'}
                      </Text>
                      <Switch
                        value={geoEnabled}
                        onValueChange={setGeoEnabled}
                        trackColor={{ true: colors.brandSecondary, false: '#ccc' }}
                        thumbColor={geoEnabled ? colors.brandPrimary : '#f4f3f4'}
                      />
                    </View>
                  </View>

                  {!geoEnabled ? (
                    <Text style={styles.help}>
                      Geo-fencing is disabled. Employees can check in and check out from any location.
                    </Text>
                  ) : (
                    <>
                      <View style={styles.geoTopRow}>
                        <Text style={[styles.help, { flex: 1 }]}>
                          Staff can check in within the check-in radius and check out within the check-out radius of these coordinates.
                        </Text>
                        <TouchableOpacity onPress={captureMyLocation} disabled={capturingLoc} style={[styles.captureBtn, { opacity: capturingLoc ? 0.6 : 1 }]}>
                          <Ionicons name="locate" size={14} color={colors.brandPrimary} />
                          <Text style={styles.captureBtnText}>{capturingLoc ? 'Capturing…' : 'Capture my location'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        <View style={[styles.field, { flex: 1 }]}>
                          <Text style={styles.label}>Latitude</Text>
                          <TextInput value={lat} onChangeText={(v) => setLat(v.replace(/[^0-9.\-]/g, ''))} keyboardType="numbers-and-punctuation" style={styles.input} placeholder="e.g. 12.971599" placeholderTextColor={colors.onSurfaceTertiary} />
                        </View>
                        <View style={[styles.field, { flex: 1 }]}>
                          <Text style={styles.label}>Longitude</Text>
                          <TextInput value={lng} onChangeText={(v) => setLng(v.replace(/[^0-9.\-]/g, ''))} keyboardType="numbers-and-punctuation" style={styles.input} placeholder="e.g. 77.594566" placeholderTextColor={colors.onSurfaceTertiary} />
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        <View style={[styles.field, { flex: 1 }]}>
                          <Text style={styles.label}>Check-in radius (m)</Text>
                          <TextInput value={checkInRadius} onChangeText={(v) => setCheckInRadius(v.replace(/[^0-9]/g, ''))} keyboardType="numeric" style={styles.input} placeholder="100" placeholderTextColor={colors.onSurfaceTertiary} />
                        </View>
                        <View style={[styles.field, { flex: 1 }]}>
                          <Text style={styles.label}>Check-out radius (m)</Text>
                          <TextInput value={checkOutRadius} onChangeText={(v) => setCheckOutRadius(v.replace(/[^0-9]/g, ''))} keyboardType="numeric" style={styles.input} placeholder="1000" placeholderTextColor={colors.onSurfaceTertiary} />
                        </View>
                      </View>
                      <Text style={styles.help}>
                        The check-out radius also controls the automatic post-work-hours check-out distance.
                      </Text>
                    </>
                  )}
                </View>

                {/* Head + Active */}
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Head branch</Text>
                    <Text style={styles.help}>Only one branch can be head</Text>
                  </View>
                  <Switch value={isHead} onValueChange={setIsHead} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={isHead ? colors.brandPrimary : '#f4f3f4'} />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.label}>Active</Text>
                  <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={active ? colors.brandPrimary : '#f4f3f4'} />
                </View>

                {err && <Text style={styles.err}>{err}</Text>}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditOpen(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, ...shadows.card },
  rowName: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  rowMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  smallBtn: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowLogo: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surfaceTertiary },
  rowLogoPh: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },

  headBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  headBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  inactiveBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  inactiveBadgeText: { color: colors.onSurfaceTertiary, fontSize: 9, fontWeight: '900' },
  activeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: '#E9F1E7' },
  activeBadgeText: { color: colors.success, fontSize: 9, fontWeight: '900' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyTitle: { fontSize: 16, color: colors.onSurfaceTertiary },
  ctaBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.pill },
  ctaBtnText: { color: '#fff', fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  sheetSubtitle: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center', marginTop: -8 },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  help: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  inputErr: { borderColor: colors.error, borderWidth: 1, backgroundColor: '#FDECEC' },
  errSmall: { color: colors.error, fontSize: 11, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  err: { color: colors.error, fontSize: 13 },
  cancelBtn: { flex: 1, backgroundColor: colors.surfaceTertiary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  cancelBtnText: { color: colors.onSurface, fontWeight: '700', fontSize: 15 },
  saveBtn: { flex: 1, backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logoImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  logoPlaceholder: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  logoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12 },
  logoBtnText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },

  geoBox: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.md },
  geoBoxActive: { backgroundColor: colors.brandTertiary + '55', borderColor: colors.brandTertiary },
  geoHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  geoTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  geoStateBadge: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  geoStateOn: { color: colors.success, backgroundColor: '#E9F1E7' },
  geoStateOff: { color: colors.onSurfaceTertiary, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  geoTitle: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  captureBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandSecondary, paddingVertical: 8, borderRadius: radius.pill, paddingHorizontal: 12 },
  captureBtnText: { color: colors.brandPrimary, fontSize: 12, fontWeight: '700' },
});
