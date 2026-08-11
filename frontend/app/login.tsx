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

  // Forgot password flow
  const [fpOpen, setFpOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState('');
  const [fpBusy, setFpBusy] = useState(false);
  const [fpStep, setFpStep] = useState<'request' | 'reset'>('request');
  const [fpToken, setFpToken] = useState('');
  const [fpNewPwd, setFpNewPwd] = useState('');
  const [fpMsg, setFpMsg] = useState<string | null>(null);
  const [fpErr, setFpErr] = useState<string | null>(null);

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
    if (!fpEmail.trim()) { setFpErr('Enter your email'); return; }
    setFpBusy(true);
    try {
      const res: any = await api('/auth/forgot-password', { method: 'POST', body: { email: fpEmail.trim().toLowerCase() }, auth: false });
      if (res.reset_token) {
        setFpToken(res.reset_token);
        setFpStep('reset');
        setFpMsg('Copy this token and set a new password below. (Email service not configured yet.)');
      } else {
        setFpMsg(res.message || 'If the email exists, a reset was created. Contact admin.');
      }
    } catch (e: any) { setFpErr(e.message || 'Failed'); }
    finally { setFpBusy(false); }
  };

  const submitReset = async () => {
    setFpErr(null); setFpMsg(null);
    if (fpNewPwd.length < 6) { setFpErr('Password must be at least 6 characters'); return; }
    setFpBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token: fpToken.trim(), new_password: fpNewPwd }, auth: false });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFpMsg('Password reset — sign in with your new password.');
      setTimeout(() => {
        setEmail(fpEmail); setPassword('');
        setFpOpen(false); setFpStep('request'); setFpEmail(''); setFpToken(''); setFpNewPwd(''); setFpMsg(null);
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
              <Text style={styles.sheetTitle}>{fpStep === 'request' ? 'Forgot Password' : 'Set New Password'}</Text>

              {fpStep === 'request' && (
                <>
                  <Text style={styles.sheetHint}>Enter your registered email. A reset token will be generated below.</Text>
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
                      style={styles.plainInput}
                    />
                  </View>
                  {fpErr && <Text style={styles.err}>{fpErr}</Text>}
                  <TouchableOpacity testID="fp-request-btn" style={styles.btn} onPress={requestReset} disabled={fpBusy}>
                    {fpBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Get Reset Token</Text>}
                  </TouchableOpacity>
                </>
              )}

              {fpStep === 'reset' && (
                <>
                  {fpMsg && (
                    <View style={styles.infoBox}>
                      <Ionicons name="information-circle" size={18} color={colors.warning} />
                      <Text style={styles.infoText}>{fpMsg}</Text>
                    </View>
                  )}
                  <View style={styles.field}>
                    <Text style={styles.label}>Reset Token</Text>
                    <View style={styles.tokenRow}>
                      <TextInput
                        testID="fp-token"
                        value={fpToken}
                        onChangeText={setFpToken}
                        style={[styles.plainInput, { flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 }]}
                      />
                      <TouchableOpacity
                        testID="fp-copy-token"
                        style={styles.copyBtn}
                        onPress={async () => { await Clipboard.setStringAsync(fpToken); Haptics.selectionAsync(); }}
                      >
                        <Ionicons name="copy-outline" size={16} color={colors.brandPrimary} />
                      </TouchableOpacity>
                    </View>
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
                  {fpErr && <Text style={styles.err}>{fpErr}</Text>}
                  <TouchableOpacity testID="fp-reset-btn" style={styles.btn} onPress={submitReset} disabled={fpBusy}>
                    {fpBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Reset Password</Text>}
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
});
