import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@glowup.com');
  const [password, setPassword] = useState('admin123');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (role: 'admin' | 'staff') => {
    if (role === 'admin') { setEmail('admin@glowup.com'); setPassword('admin123'); }
    else { setEmail('staff@glowup.com'); setPassword('staff123'); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={[colors.brandPrimary, colors.brandSecondary]} style={styles.hero}>
        <View style={styles.brandRow}>
          <View style={styles.logoCircle}>
            <Ionicons name="cut" size={26} color={colors.brandPrimary} />
          </View>
          <View>
            <Text style={styles.brandName}>GLOW UP</Text>
            <Text style={styles.brandSub}>Unisex Salon · Sullia</Text>
          </View>
        </View>
        <Text style={styles.heroTitle}>Sign in to continue</Text>
      </LinearGradient>

      <ScrollView style={styles.body} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="login-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="admin@glowup.com"
              placeholderTextColor={colors.onSurfaceTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
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
              style={styles.input}
            />
            <TouchableOpacity onPress={() => setShowPwd(v => !v)}>
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        {err && <Text style={styles.err} testID="login-error">{err}</Text>}

        <Pressable
          testID="login-submit-button"
          onPress={onSubmit}
          disabled={loading}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign In</Text>}
        </Pressable>

        <View style={styles.demoBox}>
          <Text style={styles.demoTitle}>Demo Credentials</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity testID="demo-admin-btn" style={styles.demoChip} onPress={() => fillDemo('admin')}>
              <Text style={styles.demoChipText}>Admin</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="demo-staff-btn" style={styles.demoChip} onPress={() => fillDemo('staff')}>
              <Text style={styles.demoChipText}>Staff</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.demoHint}>admin@glowup.com / admin123</Text>
          <Text style={styles.demoHint}>staff@glowup.com / staff123</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: spacing.xxxl + spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.xl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logoCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadows.card },
  brandName: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  brandSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  heroTitle: { color: '#fff', fontSize: 24, fontWeight: '700' },
  body: { flex: 1, backgroundColor: colors.surface },
  field: { gap: spacing.sm },
  label: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    height: 52,
  },
  input: { flex: 1, fontSize: 15, color: colors.onSurface },
  err: { color: colors.error, fontSize: 14 },
  btn: {
    backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', ...shadows.card,
  },
  btnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: '700' },
  demoBox: {
    backgroundColor: colors.brandTertiary, padding: spacing.lg, borderRadius: radius.md, gap: spacing.sm,
  },
  demoTitle: { fontWeight: '700', color: colors.onBrandTertiary, marginBottom: spacing.xs },
  demoChip: { backgroundColor: '#fff', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  demoChipText: { color: colors.brandPrimary, fontWeight: '700' },
  demoHint: { fontSize: 12, color: colors.onSurfaceTertiary },
});
