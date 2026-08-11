/**
 * DesktopSidebar — a permanent left navigation for wide screens.
 * Rendered by (tabs)/_layout.tsx when the viewport is ≥ 1024px.
 * Reuses the same routes as the mobile TabBar.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, contrastText } from '@/src/theme';
import { useAuth, useBrand } from '@/src/context/AuthContext';

type NavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  match?: (path: string) => boolean;
};

const TENANT_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard',  icon: 'grid-outline',    route: '/(tabs)',           match: (p) => p === '/' || p === '/(tabs)' || p === '' },
  { key: 'new-bill',  label: 'New Bill',   icon: 'add-circle',      route: '/(tabs)/new-bill',  match: (p) => p.includes('/new-bill') },
  { key: 'expenses',  label: 'Expenses',   icon: 'wallet-outline',  route: '/(tabs)/expenses',  match: (p) => p.includes('/expenses') },
  { key: 'history',   label: 'History',    icon: 'receipt-outline', route: '/(tabs)/history',   match: (p) => p.includes('/history') },
  { key: 'manage',    label: 'Manage',     icon: 'settings-outline',route: '/(tabs)/manage',    match: (p) => p.includes('/manage') },
];

const PLATFORM_ITEMS: NavItem[] = [
  { key: 'platform',     label: 'Tenants',       icon: 'business-outline', route: '/platform',       match: (p) => p === '/platform' },
  { key: 'platform-users', label: 'Platform Users', icon: 'people-outline', route: '/platform-users', match: (p) => p.includes('/platform-users') },
];

export function DesktopSidebar({ mode }: { mode?: 'tenant' | 'platform' }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user, tenant, logout } = useAuth();
  const { brandColor } = useBrand();
  const onBrand = contrastText(brandColor || colors.brandPrimary);
  const inactive = onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)';

  const items = mode === 'platform' ? PLATFORM_ITEMS : TENANT_ITEMS;

  const displayName = mode === 'platform' ? 'ParlourPilot' : (tenant?.business_name || 'ParlourPilot');
  const subLabel = mode === 'platform'
    ? (user?.role === 'platform_admin' ? 'Super Admin' : 'Platform Staff')
    : (user?.role === 'admin' || user?.role === 'owner' ? 'Owner' : 'Staff');

  return (
    <View style={[styles.sidebar, { backgroundColor: brandColor || colors.brandPrimary, paddingTop: insets.top + spacing.lg }]} testID="desktop-sidebar">
      <View style={styles.brandBlock}>
        {(tenant as any)?.logo && mode !== 'platform' ? (
          <Image source={{ uri: (tenant as any).logo }} style={styles.brandLogo} />
        ) : (
          <View style={styles.brandLogoFallback}>
            <Ionicons name={mode === 'platform' ? 'shield-checkmark' : 'sparkles'} size={22} color={onBrand} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.brandName, { color: onBrand }]} numberOfLines={1}>{displayName}</Text>
          <Text style={[styles.brandSub, { color: inactive }]}>{subLabel}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: spacing.md }}>
        {items.map(it => {
          const active = it.match ? it.match(pathname || '') : pathname?.startsWith(it.route);
          return (
            <TouchableOpacity
              key={it.key}
              testID={`sidebar-${it.key}`}
              style={[styles.navItem, active && { backgroundColor: onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)' }]}
              onPress={() => router.push(it.route as any)}
            >
              <Ionicons name={it.icon} size={20} color={active ? onBrand : inactive} />
              <Text style={[styles.navLabel, { color: active ? onBrand : inactive, fontWeight: active ? '800' : '600' }]}>
                {it.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.userRow}>
          <View style={[styles.avatar, { backgroundColor: onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)' }]}>
            <Ionicons name="person" size={16} color={onBrand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.userName, { color: onBrand }]} numberOfLines={1}>{user?.name}</Text>
            <Text style={[styles.userEmail, { color: inactive }]} numberOfLines={1}>{user?.email}</Text>
          </View>
        </View>
        <TouchableOpacity testID="sidebar-logout" style={styles.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={16} color={onBrand} />
          <Text style={[styles.logoutText, { color: onBrand }]}>Log out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 240,
    ...(Platform.OS === 'web' ? { height: '100vh' as any } : { flex: 1 }),
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  brandBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.15)' },
  brandLogo: { width: 40, height: 40, borderRadius: 8 },
  brandLogoFallback: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  brandName: { fontSize: 15, fontWeight: '800' },
  brandSub: { fontSize: 11, marginTop: 2, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },

  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.md, paddingVertical: 11, borderRadius: radius.sm, marginBottom: 4 },
  navLabel: { fontSize: 14 },

  footer: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  userName: { fontSize: 13, fontWeight: '700' },
  userEmail: { fontSize: 11 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  logoutText: { fontSize: 13, fontWeight: '700' },
});
