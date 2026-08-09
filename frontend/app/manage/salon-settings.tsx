import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, Switch, Alert, Image as RNImage,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { tenantApi } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SalonSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tenant, refreshTenant } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('India');
  const [logo, setLogo] = useState<string | null>(null);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxNumber, setTaxNumber] = useState('');
  const [taxPercentage, setTaxPercentage] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [receiptHeader, setReceiptHeader] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [memberDiscount, setMemberDiscount] = useState('10');
  const [memberMinPrice, setMemberMinPrice] = useState('100');

  useEffect(() => {
    (async () => {
      await refreshTenant();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!tenant) return;
    setBusinessName(tenant.business_name || '');
    setOwnerName(tenant.owner_name || '');
    setEmail(tenant.email || '');
    setPhone(tenant.phone || '');
    setWebsite(tenant.website || '');
    setAddress(tenant.address || '');
    setCity(tenant.city || '');
    setState(tenant.state || '');
    setPostalCode(tenant.postal_code || '');
    setCountry(tenant.country || 'India');
    setLogo(tenant.logo || null);
    setTaxEnabled(!!tenant.tax_enabled);
    setTaxNumber(tenant.tax_number || '');
    setTaxPercentage(String(tenant.tax_percentage ?? ''));
    setInvoicePrefix(tenant.invoice_prefix || '');
    setReceiptHeader(tenant.receipt_header || '');
    setReceiptFooter(tenant.receipt_footer || '');
    setMemberDiscount(String(tenant.member_discount_pct ?? 10));
    setMemberMinPrice(String(tenant.member_min_price ?? 100));
  }, [tenant]);

  const pickLogo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert('Permission needed', 'Photos permission is required to upload a logo. Please enable it in Settings.', [{ text: 'OK' }]);
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
    // Validate
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address');
      return;
    }
    if (phone.trim()) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 15) {
        Alert.alert('Invalid phone', 'Phone number must be 6-15 digits');
        return;
      }
    }
    if (taxEnabled && taxPercentage) {
      const t = parseFloat(taxPercentage);
      if (!Number.isFinite(t) || t < 0 || t > 100) {
        Alert.alert('Invalid tax %', 'Tax percentage must be between 0 and 100');
        return;
      }
    }
    const md = parseFloat(memberDiscount);
    if (!Number.isFinite(md) || md < 0 || md > 100) {
      Alert.alert('Invalid discount %', 'Member discount % must be between 0 and 100');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        business_name: businessName.trim(),
        owner_name: ownerName.trim(),
        email: email.trim().toLowerCase() || undefined,
        phone: phone.replace(/\D/g, ''),
        website: website.trim(),
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        postal_code: postalCode.trim(),
        country: country.trim(),
        logo: logo,
        tax_enabled: taxEnabled,
        tax_number: taxNumber.trim(),
        tax_percentage: parseFloat(taxPercentage) || 0,
        invoice_prefix: invoicePrefix.trim(),
        receipt_header: receiptHeader.trim(),
        receipt_footer: receiptFooter.trim(),
        member_discount_pct: parseFloat(memberDiscount) || 10,
        member_min_price: parseFloat(memberMinPrice) || 100,
      };
      await tenantApi.updateMine(payload);
      await refreshTenant();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Salon settings updated');
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Failed', e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/(tabs)")} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Salon Settings</Text>
        <View style={{ width: 36 }} />
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

          {/* Logo Section */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Salon Logo</Text>
            <View style={styles.logoRow}>
              {logo ? (
                <RNImage source={{ uri: logo }} style={styles.logoImg} resizeMode="contain" />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Ionicons name="image-outline" size={32} color={colors.onSurfaceTertiary} />
                  <Text style={styles.placeholderText}>No logo</Text>
                </View>
              )}
              <View style={{ flex: 1, gap: spacing.sm }}>
                <TouchableOpacity style={styles.actionBtn} onPress={pickLogo}>
                  <Ionicons name="camera-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.actionText}>{logo ? 'Change Logo' : 'Upload Logo'}</Text>
                </TouchableOpacity>
                {logo && (
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FEE' }]} onPress={() => setLogo(null)}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <Text style={styles.helpText}>Logo will appear on invoices and receipts.</Text>
          </View>

          {/* Business Info */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Business Information</Text>
            <LabeledInput label="Business Name" value={businessName} onChangeText={setBusinessName} />
            <LabeledInput label="Owner Name" value={ownerName} onChangeText={setOwnerName} />
            <LabeledInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <LabeledInput label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <LabeledInput label="Website (optional)" value={website} onChangeText={setWebsite} autoCapitalize="none" />
          </View>

          {/* Address */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Address</Text>
            <LabeledInput label="Street / Locality" value={address} onChangeText={setAddress} multiline />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}><LabeledInput label="City" value={city} onChangeText={setCity} /></View>
              <View style={{ flex: 1 }}><LabeledInput label="State" value={state} onChangeText={setState} /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}><LabeledInput label="Postal Code" value={postalCode} onChangeText={setPostalCode} keyboardType="numeric" /></View>
              <View style={{ flex: 1 }}><LabeledInput label="Country" value={country} onChangeText={setCountry} /></View>
            </View>
          </View>

          {/* Tax Settings */}
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Enable Tax / GST</Text>
                <Text style={styles.helpText}>Show tax on invoices</Text>
              </View>
              <Switch value={taxEnabled} onValueChange={setTaxEnabled} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={taxEnabled ? colors.brandPrimary : '#f4f3f4'} />
            </View>
            {taxEnabled && (
              <>
                <LabeledInput label="GST/Tax Number" value={taxNumber} onChangeText={setTaxNumber} autoCapitalize="characters" />
                <LabeledInput label="Tax %" value={taxPercentage} onChangeText={(v) => setTaxPercentage(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" />
              </>
            )}
          </View>

          {/* Invoice / Receipt */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Invoice & Receipt</Text>
            <LabeledInput label="Invoice Prefix (e.g. INV, GLOW)" value={invoicePrefix} onChangeText={setInvoicePrefix} autoCapitalize="characters" />
            <LabeledInput label="Receipt Header" value={receiptHeader} onChangeText={setReceiptHeader} placeholder="Optional tagline" />
            <LabeledInput label="Receipt Footer" value={receiptFooter} onChangeText={setReceiptFooter} placeholder="Thank you! Powered by ParlourPilot" />
          </View>

          {/* Member Discount */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Membership Discount</Text>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}><LabeledInput label="Discount %" value={memberDiscount} onChangeText={(v) => setMemberDiscount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" /></View>
              <View style={{ flex: 1 }}><LabeledInput label="Min Service Price ₹" value={memberMinPrice} onChangeText={(v) => setMemberMinPrice(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" /></View>
            </View>
            <Text style={styles.helpText}>Auto discount applied to member bills on services above this price.</Text>
          </View>

          <TouchableOpacity testID="save-settings-btn" style={styles.saveBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="save-outline" size={18} color="#fff" />
                <Text style={styles.saveText}>Save Settings</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function LabeledInput({ label, value, onChangeText, ...rest }: any) {
  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value ?? ''}
        onChangeText={onChangeText}
        style={styles.input}
        placeholderTextColor={colors.onSurfaceTertiary}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },

  card: { backgroundColor: '#FFFFFF', padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.md },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  logoImg: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  logoPlaceholder: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  placeholderText: { fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12 },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  helpText: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.sm, fontSize: 15, color: colors.onSurface, minHeight: 44 },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.md, ...shadows.card,
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
