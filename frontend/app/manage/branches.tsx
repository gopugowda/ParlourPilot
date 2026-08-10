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

type Branch = any;

export default function BranchesScreen() {
  const router = useRouter();
  const { refreshBranches, currentBranchId, selectBranch } = useAuth();
  const [list, setList] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [isHead, setIsHead] = useState(false);
  const [active, setActive] = useState(true);
  const [logo, setLogo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList(await branchApi.list() as any); await refreshBranches(); }
    catch (e: any) { Alert.alert('Error', e.message || String(e)); }
    finally { setLoading(false); }
  }, [refreshBranches]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    // Adding an EXTRA branch requires a paid subscription → route to checkout first.
    // The checkout screen will create the branch on successful (mock) payment.
    router.push('/checkout?type=branch');
  };
  const openEdit = (b: Branch) => {
    setEditing(b); setName(b.name || ''); setAddress(b.address || ''); setCity(b.city || '');
    setPhone(b.phone || ''); setInvoicePrefix(b.invoice_prefix || '');
    setIsHead(!!b.is_head); setActive(b.active !== false); setLogo(b.logo || null); setErr(null); setEditOpen(true);
  };

  const pickLogo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert('Permission needed', 'Photos permission is required to upload a logo. Please enable it in Settings.');
        }
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        base64: true,
        quality: 0.6,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        if (a.base64) {
          const dataUri = `data:image/${a.uri.endsWith('.png') ? 'png' : 'jpeg'};base64,${a.base64}`;
          setLogo(dataUri);
          Haptics.selectionAsync();
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not pick image');
    }
  };

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Branch name required'); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(), address: address.trim(), city: city.trim(),
        phone: phone.replace(/\D/g, ''), invoice_prefix: invoicePrefix.trim(),
        is_head: isHead, active, logo,
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
    try {
      await branchApi.remove(b.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (currentBranchId === b.id) await selectBranch(null);
      await load();
    } catch (e: any) {
      Alert.alert('Cannot delete', e.message || 'Failed');
    }
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
          <Text style={styles.headerSub}>{list.length} branch{list.length === 1 ? '' : 'es'}</Text>
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
                <Text style={styles.ctaBtnText}>Add First Branch</Text>
              </TouchableOpacity>
            </View>
          )}
          {list.map(b => (
            <View key={b.id} style={styles.row}>
              {b.logo ? (
                <RNImage source={{ uri: b.logo }} style={styles.rowLogo} resizeMode="contain" />
              ) : (
                <View style={styles.rowLogoPh}><Ionicons name="business-outline" size={18} color={colors.onSurfaceTertiary} /></View>
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.rowName}>{b.name}</Text>
                  {b.is_head && (
                    <View style={styles.headBadge}><Text style={styles.headBadgeText}>HEAD</Text></View>
                  )}
                  {!b.active && (
                    <View style={styles.inactiveBadge}><Text style={styles.inactiveBadgeText}>INACTIVE</Text></View>
                  )}
                  {currentBranchId === b.id && (
                    <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>CURRENT</Text></View>
                  )}
                </View>
                <Text style={styles.rowMeta}>
                  {[b.address, b.city].filter(Boolean).join(', ')}{b.invoice_prefix ? ` · Prefix: ${b.invoice_prefix}` : ''}
                </Text>
              </View>
              <TouchableOpacity style={styles.smallBtn} onPress={() => openEdit(b)}>
                <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FDE7E7' }]} onPress={() => remove(b)}>
                <Ionicons name="trash" size={14} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}

          {list.length > 0 && (
            <View style={styles.pricingBox}>
              <Ionicons name="card-outline" size={18} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pricingTitle}>Subscription cost</Text>
                <Text style={styles.pricingText}>Main salon: ₹999/mo or ₹9999/yr · Extra branch: ₹888/mo or ₹8888/yr</Text>
                <Text style={styles.pricingText}>Active branches: {list.filter(b => b.active).length}</Text>
              </View>
            </View>
          )}

          {list.length > 0 && (
            <TouchableOpacity testID="add-branch-cta" style={[styles.ctaBtn, { alignSelf: 'stretch', marginTop: spacing.md }]} onPress={openAdd}>
              <Ionicons name="add-circle" size={18} color="#fff" />
              <Text style={styles.ctaBtnText}>Add Branch (paid)</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing ? 'Edit Branch' : 'Add Branch'}</Text>

              {/* Branch logo */}
              <View style={styles.logoBlock}>
                <View style={styles.logoRow}>
                  {logo ? (
                    <RNImage source={{ uri: logo }} style={styles.logoImg} resizeMode="contain" />
                  ) : (
                    <View style={styles.logoPlaceholder}>
                      <Ionicons name="image-outline" size={26} color={colors.onSurfaceTertiary} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 6 }}>
                    <TouchableOpacity onPress={pickLogo} style={styles.logoBtn}>
                      <Ionicons name="camera-outline" size={14} color={colors.brandPrimary} />
                      <Text style={styles.logoBtnText}>{logo ? 'Change Logo' : 'Upload Branch Logo'}</Text>
                    </TouchableOpacity>
                    {logo && (
                      <TouchableOpacity onPress={() => setLogo(null)} style={[styles.logoBtn, { backgroundColor: '#FEE' }]}>
                        <Ionicons name="trash-outline" size={14} color={colors.error} />
                        <Text style={[styles.logoBtnText, { color: colors.error }]}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <Text style={styles.help}>Shown on invoices for this branch. Falls back to salon logo if empty.</Text>
              </View>

              <View style={styles.field}><Text style={styles.label}>Branch Name *</Text>
                <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="e.g. Bangalore Branch" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.field}><Text style={styles.label}>Address</Text>
                <TextInput value={address} onChangeText={setAddress} style={styles.input} placeholder="Street / locality" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={[styles.field, { flex: 1 }]}><Text style={styles.label}>City</Text>
                  <TextInput value={city} onChangeText={setCity} style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
                </View>
                <View style={[styles.field, { flex: 1 }]}><Text style={styles.label}>Phone</Text>
                  <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
                </View>
              </View>
              <View style={styles.field}><Text style={styles.label}>Invoice Prefix (e.g. B1, HR)</Text>
                <TextInput value={invoicePrefix} onChangeText={setInvoicePrefix} autoCapitalize="characters" style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Head Branch</Text>
                  <Text style={styles.help}>Only one branch can be head</Text>
                </View>
                <Switch value={isHead} onValueChange={setIsHead} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={isHead ? colors.brandPrimary : '#f4f3f4'} />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>Active</Text>
                <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={active ? colors.brandPrimary : '#f4f3f4'} />
              </View>

              {err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Add Branch'}</Text>}
              </TouchableOpacity>
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
  rowLogoPh: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },

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

  pricingBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandSecondary },
  pricingTitle: { fontSize: 13, fontWeight: '700', color: colors.brandPrimary },
  pricingText: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxHeight: '92%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  help: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  err: { color: colors.error, fontSize: 13 },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  logoBlock: { gap: 6 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logoImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  logoPlaceholder: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  logoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12 },
  logoBtnText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
});
