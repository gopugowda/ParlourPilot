import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const { signup } = useAuth();
  const router = useRouter();

  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!businessName.trim()) return setErr('Enter your salon/business name');
    if (!ownerName.trim()) return setErr('Enter owner name');
    if (!email.trim()) return setErr('Enter your email');
    if (!EMAIL_RE.test(email.trim())) return setErr('Enter a valid email address');
    if (phone.trim()) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 15) return setErr('Phone must be 6-15 digits');
    }
    if (password.length < 6) return setErr('Password must be at least 6 characters');

    setLoading(true);
    try {
      await signup({
        business_name: businessName.trim(),
        owner_name: ownerName.trim(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim(),
        city: city.trim(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigation handled by AuthGate; but push explicitly for safety
      router.replace('/(tabs)');
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <SafeAreaView edges={['top']} style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Salon Account</Text>
        <View style={{ width: 36 }} />
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Image
            source={require('../assets/images/parlourpilot-logo.png')}
            style={styles.logoImg}
            contentFit="contain"
          />
          <Text style={styles.brandName}>ParlourPilot</Text>
          <View style={styles.trialBanner}>
            <Ionicons name="gift-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.trialText}>7-day free trial · No credit card required</Text>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Salon / Business Name *</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="storefront-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="signup-business-input"
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="e.g. Beauty Palace"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Owner Name *</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="person-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="signup-owner-input"
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="Your full name"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email *</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="signup-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@salon.com"
              placeholderTextColor={colors.onSurfaceTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
              returnKeyType="next"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Phone</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="call-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="signup-phone-input"
              value={phone}
              onChangeText={setPhone}
              placeholder="9876543210"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="phone-pad"
              style={styles.input}
              returnKeyType="next"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>City</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="location-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="signup-city-input"
              value={city}
              onChangeText={setCity}
              placeholder="City"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password (≥ 6 characters) *</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="signup-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.onSurfaceTertiary}
              secureTextEntry={!showPwd}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={onSubmit}
            />
            <TouchableOpacity onPress={() => setShowPwd(v => !v)}>
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        {err && <Text style={styles.err} testID="signup-error">{err}</Text>}

        <Pressable
          testID="signup-submit-btn"
          onPress={onSubmit}
          disabled={loading}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Start Free Trial</Text>}
        </Pressable>

        <View style={styles.termsBox}>
          <Text style={styles.termsText}>
            By creating an account you agree to ParlourPilot Terms of Service and Privacy Policy.
          </Text>
        </View>

        <TouchableOpacity onPress={() => router.replace('/login')} style={styles.loginLink}>
          <Text style={styles.loginLinkText}>Already have an account? <Text style={{ color: colors.brandPrimary, fontWeight: '700' }}>Sign in</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface },

  hero: { alignItems: 'center', marginBottom: spacing.xl },
  logoImg: { width: 70, height: 70 },
  brandName: { color: colors.brandPrimary, fontSize: 22, fontWeight: '900', marginTop: spacing.sm },
  trialBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary,
    borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14, marginTop: spacing.md,
  },
  trialText: { color: colors.brandPrimary, fontSize: 12, fontWeight: '700' },

  field: { gap: spacing.sm, marginBottom: spacing.lg },
  label: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, minHeight: 52,
  },
  input: { flex: 1, fontSize: 15, color: colors.onSurface, paddingVertical: 12 },
  err: { color: colors.error, fontSize: 14, marginBottom: spacing.md },
  btn: {
    backgroundColor: colors.brandPrimary, minHeight: 52, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 14, ...shadows.card,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  termsBox: { marginTop: spacing.lg, paddingHorizontal: spacing.sm },
  termsText: { fontSize: 11, color: colors.onSurfaceTertiary, textAlign: 'center', lineHeight: 16 },
  loginLink: { marginTop: spacing.lg, alignItems: 'center' },
  loginLinkText: { fontSize: 14, color: colors.onSurfaceSecondary },
});
