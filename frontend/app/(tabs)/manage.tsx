import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, useBrand } from '@/src/context/AuthContext';
import { colors, spacing, radius, shadows, contrastText } from '@/src/theme';

export default function ManageScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { brandColor } = useBrand();
  const onBrand = contrastText(brandColor || colors.brandPrimary);
  const onBrandSoft = onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)';

  // Web sidebar order (single ordered menu, 1:1 with the web app):
  // Dashboard, New Bill, Bill History, Appointments, Members, Services, Staff,
  // Stock, Expenses, Cash Closing, Reports, Staff Performance, Branches, Users,
  // Salon Settings, Subscription.
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const allItems: { icon: string; label: string; hint: string; route: string; adminOnly?: boolean }[] = [
    { icon: 'grid-outline', label: 'Dashboard', hint: 'Business snapshot & KPIs', route: '/(tabs)' },
    { icon: 'add-circle-outline', label: 'New Bill', hint: 'Create a fresh invoice', route: '/(tabs)/new-bill' },
    { icon: 'receipt-outline', label: 'Bill History', hint: 'Browse past invoices', route: '/(tabs)/history' },
    { icon: 'calendar-outline', label: 'Appointments', hint: 'Book & manage customer bookings', route: '/manage/appointments' },
    { icon: 'star-outline', label: 'Members', hint: 'Yearly members & auto discount', route: '/manage/members' },
    { icon: 'pricetags-outline', label: 'Services', hint: 'Salon services & prices', route: '/manage/services' },
    { icon: 'people-outline', label: 'Staff', hint: "Manage your team's roster", route: '/manage/beauticians' },
    { icon: 'finger-print-outline', label: 'Attendance', hint: 'GPS-gated punch clock', route: '/manage/attendance' },
    { icon: 'cube-outline', label: 'Stock', hint: 'Materials inventory & low-stock alerts', route: '/manage/stock' },
    { icon: 'wallet-outline', label: 'Expenses', hint: 'Track daily expenses', route: '/(tabs)/expenses' },
    { icon: 'lock-closed-outline', label: 'Cash Closing', hint: 'End-of-day cash reconciliation', route: '/manage/cash-closing' },
    { icon: 'bar-chart-outline', label: 'Reports', hint: 'Sales analytics & insights', route: '/manage/report' },
    { icon: 'trophy-outline', label: 'Staff Performance', hint: 'Revenue per staff · top performer · payroll export', route: '/manage/staff-performance', adminOnly: true },
    { icon: 'business-outline', label: 'Branches', hint: 'Manage multiple locations', route: '/manage/branches', adminOnly: true },
    { icon: 'person-add-outline', label: 'Users', hint: 'Add admin or staff logins', route: '/manage/users', adminOnly: true },
    { icon: 'construct-outline', label: 'Salon Settings', hint: 'Profile, logo, address, tax, invoice format', route: '/manage/salon-settings', adminOnly: true },
    { icon: 'card-outline', label: 'Subscription', hint: 'Plan & billing info', route: '/subscription', adminOnly: true },
  ];
  const items = allItems.filter(it => isAdmin || !it.adminOnly);
  const groups = [{ title: 'Menu', items }];

  return (
    <View style={styles.root} testID="manage-screen">
      <SafeAreaView edges={['top']} style={[styles.header, { backgroundColor: brandColor || colors.brandPrimary, borderBottomColor: 'transparent' }]}>
        <Text style={[styles.headerTitle, { color: onBrand }]}>Manage</Text>
        <Text style={[styles.headerSub, { color: onBrandSoft }]}>Salon settings & reports</Text>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
        <View style={styles.userCard}>
          <View style={[styles.avatar, { backgroundColor: brandColor ? `${brandColor}22` : colors.brandTertiary }]}>
            <Text style={[styles.avatarText, { color: brandColor || colors.brandPrimary }]}>{user?.name?.split(' ').map(w => w[0]).slice(0, 2).join('')}</Text>
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
                <View style={[styles.rowIcon, { backgroundColor: brandColor ? `${brandColor}22` : colors.brandTertiary }]}>
                  <Ionicons name={it.icon as any} size={20} color={brandColor || colors.brandPrimary} />
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
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
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
