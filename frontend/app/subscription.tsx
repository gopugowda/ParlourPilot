import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

export default function SubscriptionScreen() {
  const { subscription, tenant, logout } = useAuth();

  const statusColor = (s: string) =>
    s === 'expired' ? colors.error :
    s === 'trialing' ? colors.warning :
    s === 'active' ? colors.success : colors.info;

  const status = subscription?.status || 'expired';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Image
          source={require('../assets/images/parlourpilot-logo.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Text style={styles.brand}>ParlourPilot</Text>

        <View style={[styles.statusPill, { backgroundColor: `${statusColor(status)}20`, borderColor: statusColor(status) }]}>
          <Ionicons name="alert-circle" size={16} color={statusColor(status)} />
          <Text style={[styles.statusText, { color: statusColor(status) }]}>{status.toUpperCase()}</Text>
        </View>

        <Text style={styles.title}>
          {status === 'expired' ? 'Your subscription has expired' :
           status === 'suspended' ? 'Your account is suspended' :
           status === 'cancelled' ? 'Your subscription is cancelled' :
           'Subscription needed'}
        </Text>

        {tenant && (
          <Text style={styles.subtitle}>{tenant.business_name}</Text>
        )}

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Current Plan</Text>
            <Text style={styles.value}>{subscription?.subscription_plan || '—'}</Text>
          </View>
          {subscription?.trial_end_date && (
            <View style={styles.row}>
              <Text style={styles.label}>Trial Ended</Text>
              <Text style={styles.value}>{new Date(subscription.trial_end_date).toLocaleDateString()}</Text>
            </View>
          )}
          {subscription?.subscription_end_date && (
            <View style={styles.row}>
              <Text style={styles.label}>Access Ended</Text>
              <Text style={styles.value}>{new Date(subscription.subscription_end_date).toLocaleDateString()}</Text>
            </View>
          )}
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark" size={20} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Your data is safe</Text>
            <Text style={styles.infoText}>All salon data, bills, customers and reports remain preserved. Renew your subscription to resume access.</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.btnPrimary} onPress={() => {
          // For MVP: no payment gateway yet; contact support
          // In future this opens billing/subscription selection flow
        }}>
          <Ionicons name="card-outline" size={18} color="#fff" />
          <Text style={styles.btnPrimaryText}>Renew Subscription</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btnSecondary} onPress={() => {}}>
          <Ionicons name="mail-outline" size={18} color={colors.brandPrimary} />
          <Text style={styles.btnSecondaryText}>Contact Support</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={logout} style={styles.logoutLink}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, alignItems: 'center' },
  logo: { width: 80, height: 80, marginTop: spacing.lg },
  brand: { fontSize: 22, fontWeight: '900', color: colors.brandPrimary, marginTop: spacing.sm },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6,
    marginTop: spacing.lg,
  },
  statusText: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: '800', color: colors.onSurface, marginTop: spacing.lg, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.onSurfaceTertiary, marginTop: 4 },
  card: {
    width: '100%', backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, gap: spacing.md, marginTop: spacing.xl, ...shadows.card,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, color: colors.onSurfaceTertiary, fontWeight: '600' },
  value: { fontSize: 14, color: colors.onSurface, fontWeight: '700' },
  infoBox: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: '#E8F5EE',
    borderColor: '#B9E1CC', borderWidth: 1, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.lg, width: '100%',
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  infoText: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 16 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14,
    width: '100%', marginTop: spacing.xl, ...shadows.card,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: 14,
    width: '100%', marginTop: spacing.md,
  },
  btnSecondaryText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 15 },
  logoutLink: { marginTop: spacing.xl },
  logoutText: { color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: '600' },
});
