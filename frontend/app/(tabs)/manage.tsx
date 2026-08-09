import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows } from '@/src/theme';

export default function ManageScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const groups = (user?.role === 'admin' || user?.role === 'owner') ? [
    {
      title: 'Salon Management',
      items: [
        { icon: 'business-outline', label: 'Branches', hint: 'Manage multiple locations · switch active branch', route: '/manage/branches' },
        { icon: 'construct-outline', label: 'Salon Settings', hint: 'Profile, logo, address, tax, invoice format', route: '/manage/salon-settings' },
        { icon: 'pricetags-outline', label: 'Services', hint: 'Add, edit, remove services', route: '/manage/services' },
        { icon: 'people-outline', label: 'Beauticians', hint: 'Manage staff & barbers', route: '/manage/beauticians' },
        { icon: 'star-outline', label: 'Members', hint: 'Yearly members & auto discount', route: '/manage/members' },
        { icon: 'cube-outline', label: 'Stock', hint: 'Materials inventory & low-stock alerts', route: '/manage/stock' },
      ],
    },
    {
      title: 'Daily Operations',
      items: [
        { icon: 'calendar-outline', label: 'Appointments', hint: 'Book & manage customer appointments', route: '/manage/appointments' },
        { icon: 'lock-closed-outline', label: 'Cash Closing', hint: 'End-of-day cash reconciliation', route: '/manage/cash-closing' },
        { icon: 'bar-chart-outline', label: 'Daily Report', hint: 'Last 30 days performance', route: '/manage/report' },
      ],
    },
    {
      title: 'Admin',
      items: [
        { icon: 'person-add-outline', label: 'Users', hint: 'Add admin or staff logins', route: '/manage/users' },
        { icon: 'card-outline', label: 'Subscription', hint: 'Plan & billing info', route: '/subscription' },
      ],
    },
  ] : [
    {
      title: 'Daily Operations',
      items: [
        { icon: 'calendar-outline', label: 'Appointments', hint: 'Book & manage customer bookings', route: '/manage/appointments' },
        { icon: 'star-outline', label: 'Members', hint: 'View & search members · WhatsApp reminders', route: '/manage/members' },
        { icon: 'lock-closed-outline', label: 'Cash Closing', hint: 'End-of-day cash reconciliation', route: '/manage/cash-closing' },
        { icon: 'bar-chart-outline', label: 'Daily Report', hint: 'Last 30 days performance', route: '/manage/report' },
        { icon: 'cube-outline', label: 'Stock', hint: 'View inventory · record usage', route: '/manage/stock' },
      ],
    },
  ];

  return (
    <View style={styles.root} testID="manage-screen">
      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.headerTitle}>Manage</Text>
        <Text style={styles.headerSub}>Salon settings & reports</Text>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.split(' ').map(w => w[0]).slice(0, 2).join('')}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user?.name}</Text>
            <Text style={styles.userMeta}>{user?.email} · {user?.role?.toUpperCase()}</Text>
          </View>
        </View>

        {groups.map(g => (
          <View key={g.title} style={{ marginTop: spacing.xl }}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            {g.items.map(it => (
              <TouchableOpacity
                key={it.label}
                testID={`manage-${it.label.toLowerCase().replace(/\s/g, '-')}`}
                style={styles.row}
                onPress={() => router.push(it.route as any)}
                activeOpacity={0.85}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={it.icon as any} size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{it.label}</Text>
                  <Text style={styles.rowHint}>{it.hint}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        ))}

        <TouchableOpacity testID="manage-logout" style={styles.logout} onPress={logout}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brandPrimary, fontWeight: '800', fontSize: 16 },
  userName: { fontSize: 16, fontWeight: '700', color: colors.onSurface },
  userMeta: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  groupTitle: { fontSize: 12, fontWeight: '700', color: colors.onSurfaceTertiary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  rowIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowHint: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  logout: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.xxl, paddingVertical: 14, borderRadius: radius.md,
    backgroundColor: '#FDE7E7', borderWidth: 1, borderColor: '#F2B5B5',
  },
  logoutText: { color: colors.error, fontWeight: '700', fontSize: 14 },
});
