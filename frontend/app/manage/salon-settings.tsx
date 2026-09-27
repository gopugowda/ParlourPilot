// Salon Settings — mirrors the web app.
// Company-level ONLY (branch-level fields moved to /manage/branches modal).
// Sections: Business • Address & contact • Branding • Tax & invoicing • Member pricing
//           • Automated report emails • Membership Tiers (mobile power-user extra).
import React, { useEffect, useState, useCallback } from 'react';
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
import { tenantApi, authApi } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { useRevenueCat } from '@/src/lib/revenuecat';
import { colors, spacing, radius, shadows, CURRENCY_CHOICES, BRAND_COLOR_PRESETS, contrastText } from '@/src/theme';
import { emailError, phoneError, sanitizePhone, normalizeEmail, PHONE_MAX } from '@/src/utils/validators';

const NUMBER_FORMATS = [
  { code: 'indian', label: 'Indian — 1,00,000' },
  { code: 'us', label: 'US / International — 100,000' },
  { code: 'uk', label: 'UK — 100,000' },
  { code: 'european', label: 'European — 100.000' },
  { code: 'french', label: 'French — 100 000' },
  { code: 'arabic', label: 'Arabic (UAE)' },
];

export default function SalonSettingsScreen() {
  const router = useRouter();
  const { tenant, refreshTenant, user, logout } = useAuth();
  const isOwner = !!(user?.is_owner || user?.role === 'owner');
  const rc = useRevenueCat();

  // ============ Danger zone — Delete Business Account ============
  // Apple 5.1.1(v) requires an in-app deletion path. This is intentionally
  // a THREE-step flow to avoid accidental deletion:
  //   1. Owner reads the multi-tenant impact copy in the DangerZone card,
  //   2. taps "Delete Business Account" → password + confirmation modal opens,
  //   3. types the exact phrase "DELETE MY BUSINESS" AND their password → save.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePwd, setDeletePwd] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const performDelete = useCallback(async () => {
    setDeleteErr(null);
    if (!deletePwd) { setDeleteErr('Enter your password.'); return; }
    if (deleteConfirm.trim() !== 'DELETE MY BUSINESS') {
      setDeleteErr('Type DELETE MY BUSINESS exactly to confirm.');
      return;
    }
    setDeleteBusy(true);
    try {
      // Pre-check: get freshest Apple state before we even ask the backend
      // to delete. Cheaper than a round-trip if the user just cancelled on
      // Apple's screen — but the SERVER re-verifies regardless.
      try { await rc.refresh(); } catch {}
      const res = await authApi.deleteBusinessAccount({
        password: deletePwd,
        confirm_text: deleteConfirm.trim(),
      });
      // Server confirmed deletion — clear local session and route to login.
      await logout();
      Alert.alert(
        'Account deleted',
        res?.message || 'Your business account has been permanently disabled.',
        [{ text: 'OK', onPress: () => router.replace('/login' as any) }],
      );
    } catch (e: any) {
      // Backend returns 409 { code: 'apple_subscription_active', ... } if the
      // owner still has an active Apple sub. Surface the "Manage Apple
      // Subscription" affordance instead of the generic error.
      const detail = e?.data?.detail || e?.detail;
      if (detail && typeof detail === 'object' && detail.code === 'apple_subscription_active') {
        setDeleteErr(detail.message || 'Your Apple subscription is still active. Manage it in Apple to stop future billing before deleting the account.');
      } else {
        setDeleteErr(typeof detail === 'string' ? detail : (e?.message || 'Deletion failed. Please try again.'));
      }
    } finally {
      setDeleteBusy(false);
    }
  }, [deletePwd, deleteConfirm, logout, router, rc]);

  const openAppleManage = useCallback(async () => {
    try { await rc.showManageSubscriptions(); } catch (e: any) { setDeleteErr(e?.message || 'Could not open Apple subscription management'); }
  }, [rc]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ---- Business ----
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [numberFormat, setNumberFormat] = useState('indian');
  const [website, setWebsite] = useState('');

  // ---- Address & contact (tenant-level) ----
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [country, setCountry] = useState('India');
  const [postal, setPostal] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');

  // ---- Branding ----
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState<string>('#C42032');
  const [brandCustomHex, setBrandCustomHex] = useState<string>('');

  // ---- Tax & invoicing ----
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxNumber, setTaxNumber] = useState('');
  const [taxPct, setTaxPct] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('INV');

  // ---- Member pricing ----
  const [memberDiscount, setMemberDiscount] = useState('10');
  const [memberMinPrice, setMemberMinPrice] = useState('100');

  // ---- Automated report emails ----
  const [dailySummary, setDailySummary] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(false);

  // ---- Membership tiers (mobile-only power feature) ----
  const [memberTiers, setMemberTiers] = useState<{ id: string; name: string; discount_pct: number; min_price: number }[]>([]);

  // Modals
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [formatPickerOpen, setFormatPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      await refreshTenant();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenant) return;
    const t = tenant as any;
    setBusinessName(t.business_name || '');
    setOwnerName(t.owner_name || '');
    setCurrencyCode((t.currency || 'INR').toUpperCase());
    setNumberFormat(t.number_format || 'indian');
    setWebsite(t.website || '');
    setAddr1(t.address || '');
    setAddr2(t.address_line_2 || '');
    setCity(t.city || '');
    setStateVal(t.state || '');
    setCountry(t.country || 'India');
    setPostal(t.postal_code || '');
    setCompanyEmail(t.email || '');
    setCompanyPhone(t.phone || '');
    setCompanyLogo(t.logo || null);
    const brand = t.brand_color || '#C42032';
    setBrandColor(brand); setBrandCustomHex(brand);
    setTaxEnabled(!!t.tax_enabled);
    setTaxNumber(t.tax_number || '');
    setTaxPct(t.tax_percentage != null ? String(t.tax_percentage) : '');
    setInvoicePrefix(t.invoice_prefix || 'INV');
    setMemberDiscount(String(t.member_discount_pct ?? 10));
    setMemberMinPrice(String(t.member_min_price ?? 100));
    setDailySummary(!!t.daily_summary_email);
    setWeeklySummary(!!t.weekly_summary_email);
    const defaultTiers = [
      { id: 'regular', name: 'Regular', discount_pct: 10, min_price: 100 },
      { id: 'student', name: 'Student', discount_pct: 20, min_price: 100 },
    ];
    setMemberTiers(Array.isArray(t.member_tiers) && t.member_tiers.length > 0 ? t.member_tiers : defaultTiers);
  }, [tenant]);

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
        setCompanyLogo(`data:image/${a.uri.endsWith('.png') ? 'png' : 'jpeg'};base64,${a.base64}`);
        Haptics.selectionAsync();
      }
    } catch (e: any) { Alert.alert('Error', e.message || 'Could not pick image'); }
  };

  const save = async () => {
    // Validation
    if (!businessName.trim()) { Alert.alert('Business name', 'Business name is required'); return; }
    if (!addr1.trim()) { Alert.alert('Address', 'Address Line 1 is required'); return; }
    if (!city.trim()) { Alert.alert('City', 'City is required'); return; }
    if (!postal.trim()) { Alert.alert('Postal code', 'Postal code is required'); return; }
    if (companyPhone && phoneError(companyPhone, { required: false })) {
      Alert.alert('Phone', 'Please enter a valid phone number'); return;
    }
    if (!companyPhone.trim()) { Alert.alert('Phone', 'Phone number is required'); return; }
    if (companyEmail) {
      const em = emailError(companyEmail, { required: false });
      if (em) { Alert.alert('Email', em); return; }
    }
    const md = parseFloat(memberDiscount);
    if (!Number.isFinite(md) || md < 0 || md > 100) { Alert.alert('Discount %', 'Must be between 0 and 100'); return; }
    if (taxEnabled && taxPct) {
      const t = parseFloat(taxPct);
      if (!Number.isFinite(t) || t < 0 || t > 100) { Alert.alert('Tax %', 'Must be between 0 and 100'); return; }
    }

    setSaving(true);
    try {
      const prevBrand = ((tenant as any)?.brand_color || '#C42032').toUpperCase();
      const nextBrand = (brandColor || '#C42032').toUpperCase();
      const brandChanged = prevBrand !== nextBrand;
      const payload: any = {
        business_name: businessName.trim(),
        owner_name: ownerName.trim(),
        currency: currencyCode,
        currency_symbol: (CURRENCY_CHOICES.find(c => c.code === currencyCode)?.symbol) || '₹',
        number_format: numberFormat,
        website: website.trim(),
        address: addr1.trim(),
        address_line_2: addr2.trim(),
        city: city.trim(),
        state: stateVal.trim(),
        country: country.trim(),
        postal_code: postal.trim(),
        email: normalizeEmail(companyEmail) || undefined,
        phone: sanitizePhone(companyPhone),
        logo: companyLogo,
        brand_color: brandColor,
        tax_enabled: taxEnabled,
        tax_number: taxEnabled ? taxNumber.trim() : '',
        tax_percentage: taxEnabled && taxPct ? parseFloat(taxPct) : 0,
        invoice_prefix: invoicePrefix.trim() || 'INV',
        member_discount_pct: parseFloat(memberDiscount) || 10,
        member_min_price: parseFloat(memberMinPrice) || 100,
        member_tiers: memberTiers,
        daily_summary_email: dailySummary,
        weekly_summary_email: weeklySummary,
      };
      await tenantApi.updateMine(payload);
      await refreshTenant();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (brandChanged) {
        Alert.alert('Saved · Brand updated', 'A quick reload is needed for the new brand color to apply everywhere.', [{
          text: 'Reload now',
          onPress: () => {
            if (Platform.OS === 'web') { try { (globalThis as any).location?.reload?.(); } catch {} }
            else { try { DevSettings.reload(); } catch {} }
          },
        }], { cancelable: false });
      } else {
        Alert.alert('Saved', 'Salon settings updated');
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Failed', e.message || String(e));
    } finally { setSaving(false); }
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
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.iconBtn}>
          <Ionicons name="home-outline" size={20} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Business Settings</Text>
          <Text style={styles.headerSub}>Business identity, tax and member pricing.</Text>
        </View>
        <TouchableOpacity onPress={save} disabled={saving} style={styles.headerSaveBtn} testID="save-settings-btn">
          {saving ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Ionicons name="save-outline" size={14} color="#fff" />
              <Text style={styles.headerSaveBtnText}>Save</Text>
            </>
          )}
        </TouchableOpacity>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

          {/* ============ 1. Business ============ */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Business</Text>
            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>Business name</Text>
                <TextInput value={businessName} onChangeText={setBusinessName} style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>Owner name</Text>
                <TextInput value={ownerName} onChangeText={setOwnerName} style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
            </View>
            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>Currency</Text>
                <TouchableOpacity style={styles.selectBtn} onPress={() => setCurrencyPickerOpen(true)} testID="currency-picker">
                  <Text style={styles.selectSymbol}>{(CURRENCY_CHOICES.find(c => c.code === currencyCode)?.symbol) || '₹'}</Text>
                  <Text style={styles.selectLabel} numberOfLines={1}>
                    {currencyCode} — {(CURRENCY_CHOICES.find(c => c.code === currencyCode)?.label) || 'Indian Rupee'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
                </TouchableOpacity>
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>Number & date format</Text>
                <TouchableOpacity style={styles.selectBtn} onPress={() => setFormatPickerOpen(true)} testID="format-picker">
                  <Text style={styles.selectLabel} numberOfLines={1}>{NUMBER_FORMATS.find(f => f.code === numberFormat)?.label || 'Indian — 1,00,000'}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Website</Text>
              <TextInput value={website} onChangeText={setWebsite} style={styles.input} placeholder="https://…" placeholderTextColor={colors.onSurfaceTertiary} autoCapitalize="none" />
            </View>
          </View>

          {/* ============ 2. Address & contact ============ */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Address & contact</Text>
            <Text style={styles.sectionHint}>Shown on your invoices and receipts.</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Address Line 1 *</Text>
              <TextInput value={addr1} onChangeText={setAddr1} style={styles.input} placeholder="Building, street" placeholderTextColor={colors.onSurfaceTertiary} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Address Line 2</Text>
              <TextInput value={addr2} onChangeText={setAddr2} style={styles.input} placeholder="Area, landmark (optional)" placeholderTextColor={colors.onSurfaceTertiary} />
            </View>
            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>City *</Text>
                <TextInput value={city} onChangeText={setCity} style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>State</Text>
                <TextInput value={stateVal} onChangeText={setStateVal} style={styles.input} placeholder="State / Province" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
            </View>
            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>Country</Text>
                <TextInput value={country} onChangeText={setCountry} style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>Postal Code *</Text>
                <TextInput value={postal} onChangeText={setPostal} keyboardType="numeric" style={styles.input} placeholder="ZIP / PIN" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
            </View>
            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>Email ID</Text>
                <TextInput value={companyEmail} onChangeText={setCompanyEmail} style={styles.input} placeholder="you@salon.com" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>Phone Number *</Text>
                <TextInput value={companyPhone} onChangeText={(v) => setCompanyPhone(sanitizePhone(v))} keyboardType="phone-pad" maxLength={PHONE_MAX} style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
            </View>
          </View>

          {/* ============ 3. Branding ============ */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Branding</Text>
            <Text style={styles.label}>Business logo</Text>
            <View style={styles.logoRow}>
              {companyLogo ? (
                <RNImage source={{ uri: companyLogo }} style={styles.logoImg} resizeMode="contain" />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Ionicons name="image-outline" size={26} color={colors.onSurfaceTertiary} />
                </View>
              )}
              <View style={{ flex: 1, gap: 6 }}>
                <TouchableOpacity style={styles.logoBtn} onPress={pickLogo}>
                  <Ionicons name="camera-outline" size={14} color={colors.brandPrimary} />
                  <Text style={styles.logoBtnText}>{companyLogo ? 'Change logo' : 'Upload logo'}</Text>
                </TouchableOpacity>
                {companyLogo && (
                  <TouchableOpacity style={[styles.logoBtn, { backgroundColor: '#FEE' }]} onPress={() => setCompanyLogo(null)}>
                    <Ionicons name="trash-outline" size={14} color={colors.error} />
                    <Text style={[styles.logoBtnText, { color: colors.error }]}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <Text style={styles.help}>Shown on your dashboard, sidebar and invoices. PNG/JPG/SVG · max 3 MB</Text>

            <Text style={[styles.label, { marginTop: spacing.md }]}>Brand color</Text>
            <View style={styles.brandRow}>
              <View style={[styles.brandSwatchLg, { backgroundColor: brandColor }]}>
                <Text style={{ color: contrastText(brandColor), fontWeight: '800', fontSize: 12 }}>Aa</Text>
              </View>
              <TextInput
                value={brandCustomHex}
                onChangeText={setBrandCustomHex}
                placeholder="#RRGGBB"
                style={[styles.input, { flex: 1, textTransform: 'uppercase' }]}
                autoCapitalize="characters" autoCorrect={false} maxLength={7}
                placeholderTextColor={colors.onSurfaceTertiary}
              />
              <TouchableOpacity style={styles.applyHexBtn} onPress={() => {
                const val = brandCustomHex.trim();
                const withHash = val.startsWith('#') ? val : `#${val}`;
                if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) { Alert.alert('Invalid hex', 'Please enter a 6-digit hex like #3B82F6'); return; }
                setBrandColor(withHash.toUpperCase());
              }}>
                <Text style={styles.applyHexText}>Apply</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.swatchGrid}>
              {BRAND_COLOR_PRESETS.map(hex => {
                const sel = hex.toLowerCase() === brandColor.toLowerCase();
                return (
                  <TouchableOpacity
                    key={hex}
                    onPress={() => { setBrandColor(hex); setBrandCustomHex(hex); }}
                    style={[styles.swatch, { backgroundColor: hex }, sel && styles.swatchSelected]}
                  >
                    {sel && <Ionicons name="checkmark" size={14} color={contrastText(hex)} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ============ 4. Tax & invoicing ============ */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Tax & invoicing</Text>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Enable GST / tax on invoices</Text>
              </View>
              <Switch value={taxEnabled} onValueChange={setTaxEnabled} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={taxEnabled ? colors.brandPrimary : '#f4f3f4'} />
            </View>
            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>GST number</Text>
                <TextInput value={taxNumber} onChangeText={setTaxNumber} autoCapitalize="characters" style={styles.input} editable={taxEnabled} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>Tax %</Text>
                <TextInput value={taxPct} onChangeText={(v) => setTaxPct(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={styles.input} placeholder="0" editable={taxEnabled} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>Invoice prefix</Text>
                <TextInput value={invoicePrefix} onChangeText={setInvoicePrefix} autoCapitalize="characters" style={styles.input} placeholder="INV" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
            </View>
          </View>

          {/* ============ 5. Member pricing ============ */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Member pricing</Text>
            <View style={styles.gridRow}>
              <View style={styles.gridField}>
                <Text style={styles.label}>Default member discount %</Text>
                <TextInput value={memberDiscount} onChangeText={(v) => setMemberDiscount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={styles.gridField}>
                <Text style={styles.label}>Member min price (₹)</Text>
                <TextInput value={memberMinPrice} onChangeText={(v) => setMemberMinPrice(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={styles.input} placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
            </View>
          </View>

          {/* ============ 6. Automated report emails ============ */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Automated report emails</Text>
            <Text style={styles.sectionHint}>Get a business summary emailed to the owner automatically. Best-effort while the app is running.</Text>
            <View style={styles.switchRow}>
              <Text style={styles.checkboxLabel}>Daily summary (end of day)</Text>
              <Switch value={dailySummary} onValueChange={setDailySummary} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={dailySummary ? colors.brandPrimary : '#f4f3f4'} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.checkboxLabel}>Weekly summary (Monday morning)</Text>
              <Switch value={weeklySummary} onValueChange={setWeeklySummary} trackColor={{ true: colors.brandSecondary, false: '#ccc' }} thumbColor={weeklySummary ? colors.brandPrimary : '#f4f3f4'} />
            </View>
          </View>

          {/* ============ 7. Membership tiers (mobile-only power feature) ============ */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <Text style={styles.sectionTitle}>Membership tiers</Text>
              <TouchableOpacity
                testID="add-tier-btn"
                onPress={() => setMemberTiers([...memberTiers, { id: `tier_${Date.now()}`, name: 'New Tier', discount_pct: 15, min_price: 100 }])}
                style={styles.addTierBtn}
              >
                <Ionicons name="add" size={14} color={colors.brandPrimary} />
                <Text style={styles.addTierText}>Add tier</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionHint}>Assign a tier to each member for a custom % and min price. Order shown to staff when creating a member.</Text>
            {memberTiers.map((t, idx) => (
              <View key={t.id} style={styles.tierRow}>
                <TextInput value={t.name} onChangeText={(v) => { const c = [...memberTiers]; c[idx] = { ...c[idx], name: v }; setMemberTiers(c); }} placeholder="Name" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.tierInput, { flex: 2 }]} />
                <TextInput value={String(t.discount_pct)} onChangeText={(v) => { const n = parseFloat(v.replace(/[^0-9.]/g, '')) || 0; const c = [...memberTiers]; c[idx] = { ...c[idx], discount_pct: n }; setMemberTiers(c); }} keyboardType="decimal-pad" placeholder="%" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.tierInput, { flex: 1 }]} />
                <TextInput value={String(t.min_price)} onChangeText={(v) => { const n = parseFloat(v.replace(/[^0-9.]/g, '')) || 0; const c = [...memberTiers]; c[idx] = { ...c[idx], min_price: n }; setMemberTiers(c); }} keyboardType="decimal-pad" placeholder="₹" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.tierInput, { flex: 1 }]} />
                <TouchableOpacity onPress={() => setMemberTiers(memberTiers.filter((_, i) => i !== idx))} style={styles.tierDelBtn}>
                  <Ionicons name="trash-outline" size={14} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
            {memberTiers.length === 0 && (
              <Text style={[styles.help, { textAlign: 'center', paddingVertical: spacing.md }]}>No tiers yet — tap Add tier.</Text>
            )}
          </View>

          <TouchableOpacity testID="save-settings-bottom" style={styles.bigSaveBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="save-outline" size={18} color="#fff" />
                <Text style={styles.bigSaveText}>Save settings</Text>
              </>
            )}
          </TouchableOpacity>

          {/* =========================================================
              Danger zone — Delete Business Account (Apple 5.1.1(v)).
              Owner-only. This is a THREE-STEP flow (see performDelete
              state above). Copy deliberately emphasises the multi-tenant
              impact so the owner cannot mistake it for "delete my profile".
              ========================================================= */}
          {isOwner && (
            <View style={styles.dangerCard} testID="delete-account-card">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="warning-outline" size={16} color={colors.error} />
                <Text style={styles.dangerTitle}>Danger zone</Text>
              </View>
              <Text style={styles.dangerSub}>Delete this business account permanently.</Text>
              <View style={styles.dangerImpactBox}>
                <Text style={styles.dangerImpactHead}>What this does</Text>
                <View style={styles.dangerImpactRow}>
                  <Ionicons name="business-outline" size={14} color={colors.error} />
                  <Text style={styles.dangerImpactText}>
                    Disables the entire business account — all branches, services and settings become unusable.
                  </Text>
                </View>
                <View style={styles.dangerImpactRow}>
                  <Ionicons name="people-outline" size={14} color={colors.error} />
                  <Text style={styles.dangerImpactText}>
                    Locks out every staff and owner sign-in belonging to this business.
                  </Text>
                </View>
                <View style={styles.dangerImpactRow}>
                  <Ionicons name="card-outline" size={14} color={colors.error} />
                  <Text style={styles.dangerImpactText}>
                    Cancels the active subscription (no further Razorpay charges).
                  </Text>
                </View>
                <View style={styles.dangerImpactRow}>
                  <Ionicons name="person-remove-outline" size={14} color={colors.error} />
                  <Text style={styles.dangerImpactText}>
                    Erases owner and staff personal contact information (name, email, phone).
                  </Text>
                </View>
                <View style={styles.dangerImpactRow}>
                  <Ionicons name="receipt-outline" size={14} color={colors.error} />
                  <Text style={styles.dangerImpactText}>
                    Keeps only anonymised bill totals for tax/audit compliance — customer names and phone numbers are also erased.
                  </Text>
                </View>
                <View style={styles.dangerImpactRow}>
                  <Ionicons name="refresh-outline" size={14} color={colors.error} />
                  <Text style={styles.dangerImpactText}>
                    This action cannot be undone.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                testID="delete-account-open"
                style={styles.dangerBtn}
                onPress={() => {
                  setDeletePwd('');
                  setDeleteConfirm('');
                  setDeleteErr(null);
                  setDeleteOpen(true);
                }}
              >
                <Ionicons name="trash-outline" size={16} color="#fff" />
                <Text style={styles.dangerBtnText}>Delete Business Account</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ============ Delete Account confirmation modal ============ */}
      <Modal
        visible={deleteOpen}
        transparent
        animationType="slide"
        onRequestClose={() => (deleteBusy ? null : setDeleteOpen(false))}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => (deleteBusy ? null : setDeleteOpen(false))}
        >
          <Pressable style={styles.deleteSheet} onPress={() => {}}>
            <View style={styles.handle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="warning" size={18} color={colors.error} />
              <Text style={styles.deleteSheetTitle}>Confirm business deletion</Text>
            </View>
            <Text style={styles.deleteSheetSub}>
              Type <Text style={{ fontWeight: '800' }}>DELETE MY BUSINESS</Text> and enter your owner password. This permanently disables the business for every user, cancels the subscription and erases all personal contact information.
            </Text>

            <View style={styles.deleteField}>
              <Text style={styles.deleteLabel}>Confirmation phrase</Text>
              <TextInput
                testID="delete-account-confirm-input"
                value={deleteConfirm}
                onChangeText={setDeleteConfirm}
                placeholder="DELETE MY BUSINESS"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.deleteInput}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>

            <View style={styles.deleteField}>
              <Text style={styles.deleteLabel}>Your password</Text>
              <TextInput
                testID="delete-account-password-input"
                value={deletePwd}
                onChangeText={setDeletePwd}
                placeholder="••••••••"
                placeholderTextColor={colors.onSurfaceTertiary}
                secureTextEntry
                style={styles.deleteInput}
              />
            </View>

            {deleteErr && (
              <Text style={styles.deleteErr} testID="delete-account-err">{deleteErr}</Text>
            )}
            {/* If the backend blocked deletion because an Apple subscription
                is still active, surface a dedicated button to open the
                StoreKit management sheet. */}
            {deleteErr && /apple/i.test(deleteErr) && (
              <TouchableOpacity
                testID="delete-account-manage-apple"
                onPress={openAppleManage}
                style={[styles.deleteCancelBtn, { backgroundColor: '#EAF3FF', borderColor: '#B8D4F9' }]}
              >
                <Text style={[styles.deleteCancelText, { color: '#0A66C2' }]}>
                  Manage Apple Subscription
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.deleteActions}>
              <TouchableOpacity
                testID="delete-account-cancel"
                style={styles.deleteCancelBtn}
                onPress={() => setDeleteOpen(false)}
                disabled={deleteBusy}
              >
                <Text style={styles.deleteCancelText}>Keep my account</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="delete-account-submit"
                style={[styles.deleteSubmitBtn, deleteBusy && { opacity: 0.6 }]}
                onPress={performDelete}
                disabled={deleteBusy}
              >
                {deleteBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={16} color="#fff" />
                    <Text style={styles.deleteSubmitText}>Delete permanently</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Currency picker */}
      <Modal visible={currencyPickerOpen} transparent animationType="fade" onRequestClose={() => setCurrencyPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCurrencyPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Choose currency</Text>
            <ScrollView style={{ maxHeight: 480 }}>
              {CURRENCY_CHOICES.map(c => {
                const sel = c.code === currencyCode;
                return (
                  <TouchableOpacity key={c.code} onPress={() => { setCurrencyCode(c.code); setCurrencyPickerOpen(false); Haptics.selectionAsync(); }} style={[styles.pickerItem, sel && styles.pickerItemActive]}>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: sel ? colors.brandPrimary : colors.onSurface, minWidth: 40 }}>{c.symbol}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerItemText, sel && { color: colors.brandPrimary, fontWeight: '800' }]}>{c.code}</Text>
                      <Text style={styles.pickerItemMeta}>{c.label}</Text>
                    </View>
                    {sel && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Number format picker */}
      <Modal visible={formatPickerOpen} transparent animationType="fade" onRequestClose={() => setFormatPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFormatPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Number & date format</Text>
            {NUMBER_FORMATS.map(f => {
              const sel = f.code === numberFormat;
              return (
                <TouchableOpacity key={f.code} onPress={() => { setNumberFormat(f.code); setFormatPickerOpen(false); Haptics.selectionAsync(); }} style={[styles.pickerItem, sel && styles.pickerItemActive]}>
                  <Text style={[styles.pickerItemText, sel && { color: colors.brandPrimary, fontWeight: '800' }]}>{f.label}</Text>
                  {sel && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  headerSaveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
  headerSaveBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  card: { backgroundColor: '#FFFFFF', padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadows.card, gap: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },
  sectionHint: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: -8 },

  gridRow: { flexDirection: 'row', gap: spacing.md },
  gridField: { flex: 1, gap: 6 },
  field: { gap: 6 },
  label: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface, minHeight: 44 },
  selectBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  selectSymbol: { fontSize: 16, fontWeight: '800', color: colors.brandPrimary, minWidth: 20 },
  selectLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.onSurface },

  help: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  checkboxLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.onSurface },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logoImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  logoPlaceholder: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  logoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12 },
  logoBtnText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandSwatchLg: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  applyHexBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  applyHexText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchSelected: { borderColor: colors.onSurface },

  addTierBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },
  addTierText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tierInput: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: 10, paddingVertical: 10, borderRadius: radius.sm, fontSize: 13, color: colors.onSurface },
  tierDelBtn: { padding: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },

  bigSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.md, ...shadows.card },
  bigSaveText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  pickerSheet: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, width: '100%', maxWidth: 420, gap: spacing.md },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  pickerItemActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary },
  pickerItemText: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  pickerItemMeta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  // Danger zone — Delete Business Account
  dangerCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: '#FDEDED',
    gap: spacing.sm,
  },
  dangerTitle: { fontSize: 15, fontWeight: '800', color: colors.error },
  dangerSub: { fontSize: 12, color: colors.onSurfaceSecondary },
  dangerImpactBox: {
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F5C2C2',
    gap: 8,
  },
  dangerImpactHead: { fontSize: 12, fontWeight: '800', color: colors.error, marginBottom: 2 },
  dangerImpactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dangerImpactText: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 17 },
  dangerBtn: {
    marginTop: spacing.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.error, paddingVertical: 12, borderRadius: radius.md,
  },
  dangerBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Delete confirmation sheet
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  deleteSheet: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    width: '100%', maxWidth: 480, alignSelf: 'center',
    gap: spacing.md,
  },
  deleteSheetTitle: { fontSize: 17, fontWeight: '800', color: colors.error },
  deleteSheetSub: { fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 18 },
  deleteField: { gap: 4 },
  deleteLabel: { fontSize: 11, fontWeight: '700', color: colors.onSurfaceSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  deleteInput: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    borderRadius: radius.sm, fontSize: 14, color: colors.onSurface,
  },
  deleteErr: { fontSize: 12, color: colors.error, fontWeight: '600' },
  deleteActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  deleteCancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  deleteCancelText: { fontWeight: '700', color: colors.onSurfaceSecondary, fontSize: 14 },
  deleteSubmitBtn: {
    flex: 1, flexDirection: 'row', gap: 6,
    paddingVertical: 12, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error,
  },
  deleteSubmitText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
