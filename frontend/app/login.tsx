import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, TouchableOpacity, Modal, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { colors, spacing, radius, shadows } from '@/src/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 1024;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Forgot password flow (OTP-based)
  const [fpOpen, setFpOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState('');
  const [fpBusy, setFpBusy] = useState(false);
  const [fpStep, setFpStep] = useState<'request' | 'reset'>('request');
  const [fpOtp, setFpOtp] = useState('');
  const [fpNewPwd, setFpNewPwd] = useState('');
  const [fpConfirmPwd, setFpConfirmPwd] = useState('');
  const [fpMsg, setFpMsg] = useState<string | null>(null);
  const [fpErr, setFpErr] = useState<string | null>(null);
  const [fpEmailSent, setFpEmailSent] = useState(false);
  const [fpDevOtp, setFpDevOtp] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!email.trim() || !password) { setErr('Enter email and password'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Enter a valid email address'); return; }
    setLoading(true);
    try {
      await login(email.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message || 'Login failed');
    } finally { setLoading(false); }
  };

  const requestReset = async () => {
    setFpErr(null); setFpMsg(null);
    const email = fpEmail.trim().toLowerCase();
    if (!email) { setFpErr('Enter your email'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFpErr('Enter a valid email address'); return; }
    setFpBusy(true);
    try {
      const res: any = await api('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });
      setFpEmailSent(!!res.email_sent);
      setFpDevOtp(res.dev_otp || null);
      setFpStep('reset');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFpMsg(res.email_sent
        ? `We sent a 6-digit code to ${email}. Check your inbox (and spam).`
        : res.message || 'Enter the code below to reset your password.');
    } catch (e: any) { setFpErr(e.message || 'Failed'); }
    finally { setFpBusy(false); }
  };

  const submitReset = async () => {
    setFpErr(null); setFpMsg(null);
    const otp = fpOtp.trim();
    if (!/^\d{6}$/.test(otp)) { setFpErr('Enter the 6-digit code from your email'); return; }
    if (fpNewPwd.length < 6) { setFpErr('Password must be at least 6 characters'); return; }
    if (fpNewPwd !== fpConfirmPwd) { setFpErr('Passwords do not match'); return; }
    setFpBusy(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { email: fpEmail.trim().toLowerCase(), otp, new_password: fpNewPwd },
        auth: false,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFpMsg('Password reset — sign in with your new password.');
      setTimeout(() => {
        setEmail(fpEmail); setPassword('');
        setFpOpen(false); setFpStep('request');
        setFpEmail(''); setFpOtp(''); setFpNewPwd(''); setFpConfirmPwd('');
        setFpMsg(null); setFpDevOtp(null); setFpEmailSent(false);
      }, 1500);
    } catch (e: any) { setFpErr(e.message || 'Failed'); }
    finally { setFpBusy(false); }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          { flexGrow: 1 },
          isDesktop && { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F2EA' },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={isDesktop ? styles.desktopCard : { flex: 1 }}>
        <SafeAreaView edges={['top']} style={styles.hero}>
          <Image
            source={require('../assets/images/parlourpilot-logo.png')}
            style={styles.logoImg}
            contentFit="contain"
          />
          <Text style={styles.brandName}>ParlourPilot</Text>
          <Text style={styles.brandSub}>SALON MANAGEMENT PLATFORM</Text>
        </SafeAreaView>

        <View style={styles.body}>
          <Text style={styles.title}>Sign in to continue</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color={colors.onSurfaceTertiary} />
              <TextInput
                testID="login-email-input"
                value={email}
                onChangeText={setEmail}
                placeholder="you@salon.com"
                placeholderTextColor={colors.onSurfaceTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.onSurfaceTertiary} />
              <TextInput
                testID="login-password-input"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.onSurfaceTertiary}
                secureTextEntry={!showPwd}
                returnKeyType="done"
                onSubmitEditing={onSubmit}
                style={styles.input}
              />
              <TouchableOpacity onPress={() => setShowPwd(v => !v)}>
                <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.onSurfaceTertiary} />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            testID="forgot-password-btn"
            onPress={() => { setFpEmail(email); setFpOpen(true); setFpErr(null); setFpMsg(null); }}
            style={styles.forgotBtn}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          {err && <Text style={styles.err} testID="login-error">{err}</Text>}

          <Pressable
            testID="login-submit-button"
            onPress={onSubmit}
            disabled={loading}
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign In</Text>}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>New to ParlourPilot?</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            testID="signup-link-btn"
            onPress={() => router.push('/signup')}
            style={styles.signupBtn}
          >
            <Text style={styles.signupText}>Create your salon account · 15-day free trial</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.brandPrimary} />
          </TouchableOpacity>
        </View>
        </View>
      </ScrollView>

      {/* Forgot Password Modal */}
      <Modal visible={fpOpen} transparent animationType="slide" onRequestClose={() => setFpOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFpOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{fpStep === 'request' ? 'Forgot Password' : 'Enter Reset Code'}</Text>

              {fpStep === 'request' && (
                <>
                  <Text style={styles.sheetHint}>Enter your registered email and we'll send you a 6-digit code to reset your password.</Text>
                  <View style={styles.field}>
                    <Text style={styles.label}>Email</Text>
                    <TextInput
                      testID="fp-email"
                      value={fpEmail}
                      onChangeText={setFpEmail}
                      placeholder="you@salon.com"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      autoCorrect={false}
                      style={styles.plainInput}
                    />
                  </View>
                  {fpErr && <Text style={styles.err}>{fpErr}</Text>}
                  <TouchableOpacity testID="fp-request-btn" style={styles.btn} onPress={requestReset} disabled={fpBusy}>
                    {fpBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send Reset Code</Text>}
                  </TouchableOpacity>
                </>
              )}

              {fpStep === 'reset' && (
                <>
                  {fpMsg && (
                    <View style={[styles.infoBox, fpEmailSent && { backgroundColor: '#E8F5E9', borderColor: '#C5E1A5' }]}>
                      <Ionicons name={fpEmailSent ? 'mail-outline' : 'information-circle'} size={18} color={fpEmailSent ? '#2E7D32' : colors.warning} />
                      <Text style={styles.infoText}>{fpMsg}</Text>
                    </View>
                  )}
                  {fpDevOtp && (
                    <View style={styles.devBox}>
                      <Text style={styles.devLabel}>DEV OTP (email disabled)</Text>
                      <TouchableOpacity onPress={async () => { await Clipboard.setStringAsync(fpDevOtp); Haptics.selectionAsync(); }}>
                        <Text style={styles.devOtp}>{fpDevOtp}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={styles.field}>
                    <Text style={styles.label}>6-Digit Code</Text>
                    <TextInput
                      testID="fp-otp"
                      value={fpOtp}
                      onChangeText={(t) => setFpOtp(t.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="number-pad"
                      maxLength={6}
                      style={[styles.plainInput, styles.otpInput]}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>New Password (≥ 6 chars)</Text>
                    <TextInput
                      testID="fp-newpwd"
                      value={fpNewPwd}
                      onChangeText={setFpNewPwd}
                      placeholder="••••••"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      secureTextEntry
                      style={styles.plainInput}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Confirm New Password</Text>
                    <TextInput
                      testID="fp-confirmpwd"
                      value={fpConfirmPwd}
                      onChangeText={setFpConfirmPwd}
                      placeholder="••••••"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      secureTextEntry
                      style={styles.plainInput}
                    />
                  </View>
                  {fpErr && <Text style={styles.err}>{fpErr}</Text>}
                  <TouchableOpacity testID="fp-reset-btn" style={styles.btn} onPress={submitReset} disabled={fpBusy}>
                    {fpBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Reset Password</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setFpStep('request'); setFpOtp(''); setFpNewPwd(''); setFpConfirmPwd(''); setFpErr(null); setFpMsg(null); setFpDevOtp(null); }}>
                    <Text style={styles.backLink}>← Use a different email</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  desktopCard: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginVertical: spacing.xxl,
    ...shadows.strong,
  } as any,
  hero: {
    paddingTop: spacing.xl, paddingBottom: spacing.xl, paddingHorizontal: spacing.xl,
    alignItems: 'center', backgroundColor: '#FFFFFF',
  },
  logoImg: { width: 90, height: 90 },
  brandName: { color: colors.brandPrimary, fontSize: 28, fontWeight: '900', letterSpacing: 0.5, marginTop: spacing.md },
  brandSub: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginTop: 4 },
  body: { flex: 1, backgroundColor: colors.surface, padding: spacing.xl, gap: spacing.lg },
  title: { fontSize: 20, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.sm },
  field: { gap: spacing.sm },
  label: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, minHeight: 52,
  },
  input: { flex: 1, fontSize: 15, color: colors.onSurface, paddingVertical: 12 },
  plainInput: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.sm, fontSize: 14, color: colors.onSurface },
  forgotBtn: { alignSelf: 'flex-end', paddingVertical: 4 },
  forgotText: { color: colors.brandPrimary, fontSize: 13, fontWeight: '700' },
  err: { color: colors.error, fontSize: 14 },
  btn: {
    backgroundColor: colors.brandPrimary, minHeight: 52, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 14, ...shadows.card,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },

  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: '600' },
  signupBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandTertiary,
    borderWidth: 1, borderColor: colors.brandSecondary,
  },
  signupText: { color: colors.brandPrimary, fontSize: 14, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, gap: spacing.md, maxHeight: '90%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  sheetHint: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center' },
  infoBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#FDF3E4', borderWidth: 1, borderColor: '#F0DCA6', padding: spacing.md, borderRadius: radius.sm },
  infoText: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary },
  tokenRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  copyBtn: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  otpInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '800',
    color: colors.brandPrimary,
  } as any,
  devBox: {
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFD180',
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  devLabel: { fontSize: 10, fontWeight: '800', color: '#EF6C00', letterSpacing: 1 },
  devOtp: { fontSize: 24, fontWeight: '900', letterSpacing: 6, color: '#BF360C', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' } as any,
  backLink: { color: colors.brandPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center', paddingVertical: 4 },
});
