import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, Switch, Alert, Image as RNImage, Modal, Pressable,
  DevSettings,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { tenantApi, branchApi } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, CURRENCY_CHOICES, BRAND_COLOR_PRESETS, contrastText } from '@/src/theme';
import { emailError, phoneError, sanitizePhone, normalizeEmail, PHONE_MAX } from '@/src/utils/validators';

// EMAIL_RE removed — validation is now handled by isValidEmail() from /src/utils/validators.ts

export default function SalonSettingsScreen() {
  const router = useRouter();
  const { tenant, refreshTenant, branches, refreshBranches } = useAuth();

  const [loading, setLoading] = useState(true);
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingBranch, setSavingBranch] = useState(false);

  // Company (tenant-level) fields
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [country, setCountry] = useState('India');
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [brandColor, setBrandColorState] = useState<string>('#C42032');
  const [brandCustomHex, setBrandCustomHex] = useState<string>('');
  const [companyLogo, setCompanyLogo] = useState<string | null>(null); // fallback logo
  const [memberDiscount, setMemberDiscount] = useState('10');
  const [memberMinPrice, setMemberMinPrice] = useState('100');
  const [memberTiers, setMemberTiers] = useState<{ id: string; name: string; discount_pct: number; min_price: number }[]>([]);

  // Branch selector
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const selectedBranch = useMemo(
    () => (branches || []).find((b: any) => b.id === selectedBranchId) || null,
    [branches, selectedBranchId]
  );

  // Branch-level fields
  const [branchLogo, setBranchLogo] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchEmail, setBranchEmail] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxNumber, setTaxNumber] = useState('');
  const [taxPercentage, setTaxPercentage] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [receiptHeader, setReceiptHeader] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  // GPS geofence fields (for staff attendance gating)
  const [branchLat, setBranchLat] = useState('');
  const [branchLng, setBranchLng] = useState('');
  const [branchRadiusM, setBranchRadiusM] = useState('');
  const [capturingLoc, setCapturingLoc] = useState(false);

  useEffect(() => {
    (async () => {
      await Promise.all([refreshTenant(), refreshBranches()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Populate company fields when tenant loads
  useEffect(() => {
    if (!tenant) return;
    setBusinessName(tenant.business_name || '');
    setOwnerName(tenant.owner_name || '');
    setCompanyEmail(tenant.email || '');
    setCompanyPhone(tenant.phone || '');
    setWebsite(tenant.website || '');
    setCountry(tenant.country || 'India');
    setCurrencyCode((tenant.currency || 'INR').toUpperCase());
    const brand = (tenant as any).brand_color || '#C42032';
    setBrandColorState(brand);
    setBrandCustomHex(brand);
    setCompanyLogo(tenant.logo || null);
    setMemberDiscount(String(tenant.member_discount_pct ?? 10));
    setMemberMinPrice(String(tenant.member_min_price ?? 100));
    const defaultTiers = [
      { id: 'regular', name: 'Regular', discount_pct: 10, min_price: 100 },
      { id: 'student', name: 'Student', discount_pct: 20, min_price: 100 },
    ];
    setMemberTiers(Array.isArray((tenant as any).member_tiers) && (tenant as any).member_tiers.length > 0 ? (tenant as any).member_tiers : defaultTiers);
  }, [tenant]);

  // Default-select head branch when branches load
  useEffect(() => {
    if (!branches || branches.length === 0) return;
    if (selectedBranchId && branches.find((b: any) => b.id === selectedBranchId)) return;
    const head = branches.find((b: any) => b.is_head) || branches[0];
    setSelectedBranchId(head?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches]);

  // Populate branch fields when selection changes
  useEffect(() => {
    const b: any = selectedBranch;
    if (!b) {
      setBranchLogo(null); setAddress(''); setCity(''); setStateName(''); setPostalCode('');
      setBranchPhone(''); setBranchEmail('');
      setTaxEnabled(false); setTaxNumber(''); setTaxPercentage('');
      setInvoicePrefix(''); setReceiptHeader(''); setReceiptFooter('');
      setBranchLat(''); setBranchLng(''); setBranchRadiusM('');
      return;
    }
    setBranchLogo(b.logo || null);
    setAddress(b.address || '');
    setCity(b.city || '');
    setStateName(b.state || '');
    setPostalCode(b.postal_code || '');
    setBranchPhone(b.phone || '');
    setBranchEmail(b.email || '');
    setTaxEnabled(!!b.tax_enabled);
    setTaxNumber(b.tax_number || '');
    setTaxPercentage(String(b.tax_percentage ?? ''));
    setInvoicePrefix(b.invoice_prefix || '');
    setReceiptHeader(b.receipt_header || '');
    setReceiptFooter(b.receipt_footer || '');
    setBranchLat(b.latitude != null ? String(b.latitude) : '');
    setBranchLng(b.longitude != null ? String(b.longitude) : '');
    setBranchRadiusM(b.geofence_radius_m != null ? String(b.geofence_radius_m) : '');
  }, [selectedBranch]);

  const pickImage = async (target: 'company' | 'branch') => {
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
          if (target === 'company') setCompanyLogo(dataUri);
          else setBranchLogo(dataUri);
          Haptics.selectionAsync();
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not pick image');
    }
  };

  const saveCompany = async () => {
    const eErr = emailError(companyEmail, { required: true });
    if (eErr) { Alert.alert('Email', eErr); return; }
    const pErr = phoneError(companyPhone, { required: false });
    if (pErr) { Alert.alert('Mobile number', pErr); return; }
    const md = parseFloat(memberDiscount);
    if (!Number.isFinite(md) || md < 0 || md > 100) {
      Alert.alert('Invalid discount %', 'Member discount % must be between 0 and 100'); return;
    }
    setSavingCompany(true);
    try {
      const prevBrand = ((tenant as any)?.brand_color || '#C42032').toUpperCase();
      const nextBrand = (brandColor || '#C42032').toUpperCase();
      const brandChanged = prevBrand !== nextBrand;
      const payload: any = {
        business_name: businessName.trim(),
        owner_name: ownerName.trim(),
        email: normalizeEmail(companyEmail) || undefined,
        phone: sanitizePhone(companyPhone),
        website: website.trim(),
        country: country.trim(),
        currency: currencyCode,
        currency_symbol: (CURRENCY_CHOICES.find(c => c.code === currencyCode)?.symbol) || '₹',
        brand_color: brandColor,
        logo: companyLogo,
        member_discount_pct: parseFloat(memberDiscount) || 10,
        member_min_price: parseFloat(memberMinPrice) || 100,
        member_tiers: memberTiers,
      };
      await tenantApi.updateMine(payload);
      await refreshTenant();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (brandChanged) {
        Alert.alert(
          'Saved · Brand updated',
          'A quick reload is needed for the new brand color to apply everywhere.',
          [{
            text: 'Reload now',
            onPress: () => {
              if (Platform.OS === 'web') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                try { (globalThis as any).location?.reload?.(); } catch {}
              } else {
                try { DevSettings.reload(); } catch {}
              }
            },
          }],
          { cancelable: false },
        );
      } else {
        Alert.alert('Saved', 'Company info updated');
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Failed', e.message || String(e));
    } finally {
      setSavingCompany(false);
    }
  };

  const saveBranch = async () => {
    if (!selectedBranch) { Alert.alert('No branch', 'Select a branch first'); return; }
    const eErr = emailError(branchEmail, { required: false });
    if (eErr) { Alert.alert('Branch email', eErr); return; }
    const pErr = phoneError(branchPhone, { required: false });
    if (pErr) { Alert.alert('Branch mobile', pErr); return; }
    if (taxEnabled && taxPercentage) {
      const t = parseFloat(taxPercentage);
      if (!Number.isFinite(t) || t < 0 || t > 100) {
        Alert.alert('Invalid tax %', 'Tax percentage must be between 0 and 100'); return;
      }
    }
    setSavingBranch(true);
    try {
      const payload: any = {
        name: (selectedBranch as any).name, // required by backend model
        logo: branchLogo,
        address: address.trim(),
        city: city.trim(),
        state: stateName.trim(),
        postal_code: postalCode.trim(),
        phone: sanitizePhone(branchPhone),
        email: normalizeEmail(branchEmail),
        tax_enabled: taxEnabled,
        tax_number: taxNumber.trim(),
        tax_percentage: parseFloat(taxPercentage) || 0,
        invoice_prefix: invoicePrefix.trim(),
        receipt_header: receiptHeader.trim(),
        receipt_footer: receiptFooter.trim(),
        // GPS gating (blank → disable). Send numeric or explicit null so
        // backend can clear the geofence when user wipes the field.
        latitude: branchLat.trim() ? parseFloat(branchLat) : null,
        longitude: branchLng.trim() ? parseFloat(branchLng) : null,
        geofence_radius_m: branchRadiusM.trim() ? parseInt(branchRadiusM, 10) : null,
        is_head: (selectedBranch as any).is_head, // preserve
        active: (selectedBranch as any).active !== false,
      };
      await branchApi.update((selectedBranch as any).id, payload);
      await refreshBranches();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', `Branch settings updated for ${(selectedBranch as any).name}`);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Failed', e.message || String(e));
    } finally {
      setSavingBranch(false);
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
        <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="home-outline" size={20} color="#3A3937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Salon Settings</Text>
        <View style={{ width: 36 }} />
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

          {/* ------ Company (tenant) section ------ */}
          <View style={styles.sectionHeader}>
            <Ionicons name="briefcase-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.sectionTitle}>Company Info</Text>
          </View>
          <Text style={styles.sectionHint}>Applies to your whole salon. Used as fallback for invoices.</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Default Logo</Text>
            <View style={styles.logoRow}>
              {companyLogo ? (
                <RNImage source={{ uri: companyLogo }} style={styles.logoImg} resizeMode="contain" />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Ionicons name="image-outline" size={30} color={colors.onSurfaceTertiary} />
                  <Text style={styles.placeholderText}>No logo</Text>
                </View>
              )}
              <View style={{ flex: 1, gap: spacing.sm }}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => pickImage('company')}>
                  <Ionicons name="camera-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.actionText}>{companyLogo ? 'Change' : 'Upload'}</Text>
                </TouchableOpacity>
                {companyLogo && (
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FEE' }]} onPress={() => setCompanyLogo(null)}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <Text style={styles.helpText}>Used on invoices when a branch has no logo of its own.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Business Details</Text>
            <LabeledInput label="Business Name" value={businessName} onChangeText={setBusinessName} />
            <LabeledInput label="Owner Name" value={ownerName} onChangeText={setOwnerName} />
            <LabeledInput label="Company Email *" value={companyEmail} onChangeText={setCompanyEmail} keyboardType="email-address" autoCapitalize="none" />
            <LabeledInput label="Company Phone" value={companyPhone} onChangeText={(v) => setCompanyPhone(sanitizePhone(v))} keyboardType="phone-pad" maxLength={PHONE_MAX} />
            <LabeledInput label="Website (optional)" value={website} onChangeText={setWebsite} autoCapitalize="none" />
            <LabeledInput label="Country" value={country} onChangeText={setCountry} />

            {/* Currency selector */}
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.label}>Currency for Bills / Invoices / Expenses</Text>
              <TouchableOpacity style={styles.currencyBtn} onPress={() => setCurrencyPickerOpen(true)} testID="currency-picker">
                <Text style={styles.currencySymbol}>{(CURRENCY_CHOICES.find(c => c.code === currencyCode)?.symbol) || '₹'}</Text>
                <Text style={styles.currencyLabel}>
                  {currencyCode} — {(CURRENCY_CHOICES.find(c => c.code === currencyCode)?.label) || 'Indian Rupee'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.onSurfaceTertiary} />
              </TouchableOpacity>
              <Text style={styles.helpText}>Display-only. Amounts are not converted; you enter values in this currency.</Text>
            </View>

            {/* Brand Color */}
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.label}>Brand Color</Text>
              <View style={styles.brandPreviewRow}>
                <View style={[styles.brandSwatchLg, { backgroundColor: brandColor }]}>
                  <Text style={{ color: contrastText(brandColor), fontWeight: '800', fontSize: 12 }}>Sample</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.brandCode}>{brandColor.toUpperCase()}</Text>
                  <Text style={styles.brandContrast}>Text on this color: <Text style={{ color: contrastText(brandColor), backgroundColor: brandColor, fontWeight: '800', paddingHorizontal: 6, borderRadius: 4 }}>Aa</Text></Text>
                </View>
              </View>
              <View style={styles.swatchGrid}>
                {BRAND_COLOR_PRESETS.map(hex => {
                  const sel = hex.toLowerCase() === brandColor.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={hex}
                      onPress={() => { setBrandColorState(hex); setBrandCustomHex(hex); }}
                      testID={`brand-swatch-${hex}`}
                      style={[styles.swatch, { backgroundColor: hex }, sel && styles.swatchSelected]}
                    >
                      {sel && <Ionicons name="checkmark" size={16} color={contrastText(hex)} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.customHexRow}>
                <Text style={styles.label}>Custom hex</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TextInput
                    value={brandCustomHex}
                    onChangeText={setBrandCustomHex}
                    placeholder="#RRGGBB"
                    style={[styles.input, { flex: 1, textTransform: 'uppercase' }]}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={7}
                    testID="brand-custom-hex"
                  />
                  <TouchableOpacity
                    style={styles.applyHexBtn}
                    onPress={() => {
                      const val = brandCustomHex.trim();
                      const withHash = val.startsWith('#') ? val : `#${val}`;
                      if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) {
                        Alert.alert('Invalid hex', 'Please enter a 6-digit hex like #3B82F6'); return;
                      }
                      setBrandColorState(withHash.toUpperCase());
                    }}
                  >
                    <Text style={styles.applyHexText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.helpText}>Used for buttons, chips, headers, and active nav items. Text auto-switches to black or white based on the background brightness for readability.</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Membership Discount</Text>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}><LabeledInput label="Discount %" value={memberDiscount} onChangeText={(v: string) => setMemberDiscount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" /></View>
              <View style={{ flex: 1 }}><LabeledInput label="Min Service ₹" value={memberMinPrice} onChangeText={(v: string) => setMemberMinPrice(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" /></View>
            </View>
            <Text style={styles.helpText}>Auto-applied on member bills. Per-member overrides can be set on the Members screen.</Text>
          </View>

          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.cardTitle}>Membership Tiers</Text>
              <TouchableOpacity
                testID="add-tier-btn"
                onPress={() => {
                  const id = `tier_${Date.now()}`;
                  setMemberTiers([...memberTiers, { id, name: 'New Tier', discount_pct: 15, min_price: 100 }]);
                }}
                style={styles.addTierBtn}
              >
                <Ionicons name="add" size={16} color={colors.brandPrimary} />
                <Text style={styles.addTierText}>Add Tier</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.helpText}>Assign a tier to each member for a custom % and min price. Order shown to staff when creating a member.</Text>
            {memberTiers.map((t, idx) => (
              <View key={t.id} style={styles.tierRow} testID={`tier-row-${t.id}`}>
                <TextInput
                  testID={`tier-name-${t.id}`}
                  value={t.name}
                  onChangeText={(v) => {
                    const copy = [...memberTiers];
                    copy[idx] = { ...copy[idx], name: v };
                    setMemberTiers(copy);
                  }}
                  placeholder="Name"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={[styles.tierInput, { flex: 2 }]}
                />
                <TextInput
                  testID={`tier-pct-${t.id}`}
                  value={String(t.discount_pct)}
                  onChangeText={(v) => {
                    const n = parseFloat(v.replace(/[^0-9.]/g, '')) || 0;
                    const copy = [...memberTiers];
                    copy[idx] = { ...copy[idx], discount_pct: n };
                    setMemberTiers(copy);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="10%"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={[styles.tierInput, { flex: 1 }]}
                />
                <TextInput
                  testID={`tier-min-${t.id}`}
                  value={String(t.min_price)}
                  onChangeText={(v) => {
                    const n = parseFloat(v.replace(/[^0-9.]/g, '')) || 0;
                    const copy = [...memberTiers];
                    copy[idx] = { ...copy[idx], min_price: n };
                    setMemberTiers(copy);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="₹100"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={[styles.tierInput, { flex: 1 }]}
                />
                <TouchableOpacity
                  testID={`tier-delete-${t.id}`}
                  onPress={() => setMemberTiers(memberTiers.filter((_, i) => i !== idx))}
                  style={styles.tierDeleteBtn}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
            {memberTiers.length === 0 && (
              <Text style={[styles.helpText, { textAlign: 'center', paddingVertical: spacing.md }]}>No tiers yet — tap Add Tier.</Text>
            )}
          </View>

          <TouchableOpacity testID="save-company-btn" style={styles.saveBtn} onPress={saveCompany} disabled={savingCompany}>
            {savingCompany ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="save-outline" size={18} color="#fff" />
                <Text style={styles.saveText}>Save Company Info</Text>
              </>
            )}
          </TouchableOpacity>

          {/* ------ Branch section ------ */}
          <View style={[styles.sectionHeader, { marginTop: spacing.xl }]}>
            <Ionicons name="business-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.sectionTitle}>Branch Settings</Text>
          </View>
          <Text style={styles.sectionHint}>Overrides the company defaults for the chosen branch. Applied to bills of that branch.</Text>

          {/* Branch picker */}
          <TouchableOpacity style={styles.branchPicker} onPress={() => setBranchPickerOpen(true)} testID="branch-picker">
            <Ionicons name="git-branch-outline" size={16} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.branchPickerLabel}>Editing Branch</Text>
              <Text style={styles.branchPickerValue}>
                {selectedBranch ? (selectedBranch as any).name : 'Select a branch'}
                {selectedBranch && (selectedBranch as any).is_head ? '  · HEAD' : ''}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={20} color={colors.onSurfaceTertiary} />
          </TouchableOpacity>

          {selectedBranch && (
            <>
              {/* Branch logo */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Branch Logo</Text>
                <View style={styles.logoRow}>
                  {branchLogo ? (
                    <RNImage source={{ uri: branchLogo }} style={styles.logoImg} resizeMode="contain" />
                  ) : (
                    <View style={styles.logoPlaceholder}>
                      <Ionicons name="image-outline" size={30} color={colors.onSurfaceTertiary} />
                      <Text style={styles.placeholderText}>No logo</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, gap: spacing.sm }}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => pickImage('branch')} testID="pick-branch-logo">
                      <Ionicons name="camera-outline" size={16} color={colors.brandPrimary} />
                      <Text style={styles.actionText}>{branchLogo ? 'Change' : 'Upload'}</Text>
                    </TouchableOpacity>
                    {branchLogo && (
                      <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FEE' }]} onPress={() => setBranchLogo(null)}>
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                        <Text style={[styles.actionText, { color: colors.error }]}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <Text style={styles.helpText}>Shown on invoices for this branch. If empty, the company default logo is used.</Text>
              </View>

              {/* Branch address */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Branch Address & Contact</Text>
                <LabeledInput label="Street / Locality" value={address} onChangeText={setAddress} multiline />
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={{ flex: 1 }}><LabeledInput label="City" value={city} onChangeText={setCity} /></View>
                  <View style={{ flex: 1 }}><LabeledInput label="State" value={stateName} onChangeText={setStateName} /></View>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={{ flex: 1 }}><LabeledInput label="Postal Code" value={postalCode} onChangeText={setPostalCode} keyboardType="numeric" /></View>
                  <View style={{ flex: 1 }}><LabeledInput label="Branch Phone" value={branchPhone} onChangeText={(v) => setBranchPhone(sanitizePhone(v))} keyboardType="phone-pad" maxLength={PHONE_MAX} /></View>
                </View>
                <LabeledInput label="Branch Email" value={branchEmail} onChangeText={setBranchEmail} keyboardType="email-address" autoCapitalize="none" />
              </View>

              {/* Staff attendance geofence */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Staff Attendance Geofence</Text>
                <Text style={styles.helpText}>Set the salon&rsquo;s coordinates so staff can only check-in within {branchRadiusM || 100}m. Leave blank to disable gating for this branch.</Text>
                <View style={styles.rowGap}>
                  <View style={{ flex: 1 }}>
                    <LabeledInput
                      label="Latitude"
                      value={branchLat}
                      onChangeText={(v: string) => setBranchLat(v.replace(/[^0-9.\-]/g, ''))}
                      keyboardType="numbers-and-punctuation"
                      testID="branch-lat"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <LabeledInput
                      label="Longitude"
                      value={branchLng}
                      onChangeText={(v: string) => setBranchLng(v.replace(/[^0-9.\-]/g, ''))}
                      keyboardType="numbers-and-punctuation"
                      testID="branch-lng"
                    />
                  </View>
                </View>
                <LabeledInput
                  label="Check-in radius (m, default 100)"
                  value={branchRadiusM}
                  onChangeText={(v: string) => setBranchRadiusM(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  testID="branch-radius"
                />
                <TouchableOpacity
                  testID="capture-loc-btn"
                  disabled={capturingLoc}
                  onPress={async () => {
                    setCapturingLoc(true);
                    try {
                      const { getFreshLocation } = await import('@/src/utils/attendance');
                      const loc = await getFreshLocation();
                      if (!loc) {
                        Alert.alert('Location', 'Could not read GPS. Enable location and try again.');
                        return;
                      }
                      setBranchLat(loc.coords.latitude.toFixed(6));
                      setBranchLng(loc.coords.longitude.toFixed(6));
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    } finally { setCapturingLoc(false); }
                  }}
                  style={[styles.captureBtn, { opacity: capturingLoc ? 0.6 : 1 }]}
                >
                  <Ionicons name="locate" size={16} color="#fff" />
                  <Text style={styles.captureBtnText}>{capturingLoc ? 'Capturing…' : 'Capture My Location'}</Text>
                </TouchableOpacity>
              </View>

              {/* Branch tax */}
              <View style={styles.card}>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Enable Tax / GST for this branch</Text>
                    <Text style={styles.helpText}>Show tax on invoices generated for this branch</Text>
                  </View>
                  <Switch value={taxEnabled} onValueChange={setTaxEnabled} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={taxEnabled ? colors.brandPrimary : '#f4f3f4'} />
                </View>
                {taxEnabled && (
                  <>
                    <LabeledInput label="GST/Tax Number" value={taxNumber} onChangeText={setTaxNumber} autoCapitalize="characters" />
                    <LabeledInput label="Tax %" value={taxPercentage} onChangeText={(v: string) => setTaxPercentage(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" />
                  </>
                )}
              </View>

              {/* Branch invoice */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Invoice & Receipt (Branch)</Text>
                <LabeledInput label="Invoice Prefix (e.g. INV, B1)" value={invoicePrefix} onChangeText={setInvoicePrefix} autoCapitalize="characters" />
                <LabeledInput label="Receipt Header" value={receiptHeader} onChangeText={setReceiptHeader} placeholder="Optional tagline" />
                <LabeledInput label="Receipt Footer" value={receiptFooter} onChangeText={setReceiptFooter} placeholder="Thank you! Powered by ParlourPilot" />
              </View>

              <TouchableOpacity testID="save-branch-btn" style={styles.saveBtn} onPress={saveBranch} disabled={savingBranch}>
                {savingBranch ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="save-outline" size={18} color="#fff" />
                    <Text style={styles.saveText}>Save Branch Settings</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          {(!branches || branches.length === 0) && (
            <View style={styles.card}>
              <Text style={styles.helpText}>No branches found. Go to Manage → Branches to add one.</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Branch picker modal */}
      <Modal visible={branchPickerOpen} transparent animationType="fade" onRequestClose={() => setBranchPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setBranchPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Choose a branch</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {(branches || []).map((b: any) => {
                const isSelected = b.id === selectedBranchId;
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                    onPress={() => { setSelectedBranchId(b.id); setBranchPickerOpen(false); Haptics.selectionAsync(); }}
                    testID={`branch-opt-${b.id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerItemText, isSelected && { color: colors.brandPrimary, fontWeight: '800' }]}>
                        {b.name} {b.is_head ? '· HEAD' : ''}
                      </Text>
                      {(b.address || b.city) ? (
                        <Text style={styles.pickerItemMeta}>{[b.address, b.city].filter(Boolean).join(', ')}</Text>
                      ) : null}
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.actionBtn, { alignSelf: 'stretch', justifyContent: 'center' }]} onPress={() => setBranchPickerOpen(false)}>
              <Text style={styles.actionText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Currency picker modal */}
      <Modal visible={currencyPickerOpen} transparent animationType="fade" onRequestClose={() => setCurrencyPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCurrencyPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Choose Currency</Text>
            <ScrollView style={{ maxHeight: 480 }}>
              {CURRENCY_CHOICES.map(c => {
                const isSelected = c.code === currencyCode;
                return (
                  <TouchableOpacity
                    key={c.code}
                    testID={`currency-${c.code}`}
                    onPress={() => { setCurrencyCode(c.code); setCurrencyPickerOpen(false); Haptics.selectionAsync(); }}
                    style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                  >
                    <Text style={{ fontSize: 20, fontWeight: '800', color: isSelected ? colors.brandPrimary : colors.onSurface, minWidth: 40 }}>{c.symbol}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerItemText, isSelected && { color: colors.brandPrimary, fontWeight: '800' }]}>{c.code}</Text>
                      <Text style={styles.pickerItemMeta}>{c.label}</Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.actionBtn, { alignSelf: 'stretch', justifyContent: 'center' }]} onPress={() => setCurrencyPickerOpen(false)}>
              <Text style={styles.actionText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4, marginTop: spacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.brandPrimary, letterSpacing: 0.4 },
  sectionHint: { fontSize: 11, color: colors.onSurfaceTertiary, marginBottom: spacing.md },

  branchPicker: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  branchPickerLabel: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 0.5 },
  branchPickerValue: { fontSize: 15, fontWeight: '800', color: colors.brandPrimary, marginTop: 2 },

  card: { backgroundColor: '#FFFFFF', padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.md },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  logoImg: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  logoPlaceholder: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  placeholderText: { fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12 },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  helpText: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowGap: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  captureBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingVertical: 10, borderRadius: radius.sm, marginTop: spacing.sm },
  captureBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  addTierBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },
  addTierText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  tierInput: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: 10, paddingVertical: 10, borderRadius: radius.sm, fontSize: 13, color: colors.onSurface },
  tierDeleteBtn: { padding: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },

  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.sm, fontSize: 15, color: colors.onSurface, minHeight: 44 },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.md, ...shadows.card,
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  pickerSheet: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, width: '100%', maxWidth: 420, gap: spacing.md },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  pickerItemActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary },
  pickerItemText: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  pickerItemMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  currencyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
  },
  currencySymbol: { fontSize: 20, fontWeight: '800', color: colors.brandPrimary, minWidth: 32 },
  currencyLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.onSurface },
  brandPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  brandSwatchLg: { width: 80, height: 80, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  brandCode: { fontSize: 16, fontWeight: '900', color: colors.onSurface, letterSpacing: 0.5 },
  brandContrast: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4 },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  swatch: { width: 40, height: 40, borderRadius: 10, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchSelected: { borderColor: colors.onSurface },
  customHexRow: { gap: 6, marginBottom: spacing.sm },
  applyHexBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  applyHexText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
