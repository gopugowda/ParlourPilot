import React, { useEffect, useRef } from 'react';
import { Tabs, Slot } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Animated, Text, View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, contrastText } from '@/src/theme';
import { useBrand, useAuth } from '@/src/context/AuthContext';
import { useResponsive } from '@/src/hooks/use-responsive';
import { DesktopSidebar } from '@/src/components/DesktopSidebar';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { brandColor } = useBrand();
  const { can, user, permissionsReady } = useAuth();
  const onBrand = contrastText(brandColor || colors.brandPrimary);
  const inactive = onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)';
  const { isDesktop } = useResponsive();

  // ---- Permission-first loading gate ----
  // Owner/owner-role are always ready (see AuthContext.applyLoginResponse).
  // For everyone else, we hold the entire tabs tree behind a spinner until
  // /auth/me confirms permissions — no button ever flashes before its true
  // permission state is known. This is the "Default Restricted" pattern.
  const gateActive = !!user && !permissionsReady;

  // 300ms fade-in the moment permissions land — feels smoother than a hard swap.
  const fade = useRef(new Animated.Value(gateActive ? 0 : 1)).current;
  useEffect(() => {
    if (!gateActive) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, [gateActive, fade]);

  if (gateActive) {
    return (
      <View style={styles.loadingScreen} testID="perms-loading">
        <ActivityIndicator color={brandColor || colors.brandPrimary} size="large" />
        <Text style={styles.loadingText}>Loading your workspace…</Text>
      </View>
    );
  }

  // Staff-role non-owners always see the Dashboard tab (their Staff Dashboard).
  // Owners and Admins ALWAYS see the Dashboard tab — regardless of the `reports`
  // permission, since dashboard exposes operational KPIs (today's revenue,
  // schedule, alerts) that admins need for day-to-day ops. Only unusual roles
  // (like platform_staff without reports) fall through to the perm gate.
  const isStaffRole = user?.role === 'staff' && !user?.is_owner;
  const isAdminOrOwner = user?.role === 'admin' || user?.role === 'owner' || !!user?.is_owner;
  const hideDashboard = isStaffRole || isAdminOrOwner ? false : !can('reports');
  const hideNewBill = !can('new_bill');
  const hideExpenses = !can('expenses');
  const hideHistory = !can('bills');
  // Manage always visible (child screens filter their own tiles).

  // On desktop, replace the bottom tab bar with a persistent left sidebar.
  if (isDesktop) {
    return (
      <Animated.View style={[styles.desktopRow, { opacity: fade }]}>
        <DesktopSidebar mode="tenant" />
        <View style={styles.desktopMain} testID="desktop-main">
          <View style={styles.desktopContent}>
            <Slot />
          </View>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ flex: 1, opacity: fade }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: onBrand,
          tabBarInactiveTintColor: inactive,
          tabBarStyle: {
            backgroundColor: brandColor || colors.brandPrimary,
            borderTopColor: 'transparent',
            paddingBottom: insets.bottom + 4,
            paddingTop: 6,
            height: 56 + insets.bottom,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            href: hideDashboard ? null : undefined,
            tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="new-bill"
          options={{
            title: 'New Bill',
            href: hideNewBill ? null : undefined,
            tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size + 4} color={color} />,
          }}
        />
        <Tabs.Screen
          name="expenses"
          options={{
            title: 'Expenses',
            href: hideExpenses ? null : undefined,
            tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: 'History',
            href: hideHistory ? null : undefined,
            tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="manage"
          options={{
            title: 'Manage',
            tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
          }}
        />
      </Tabs>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    gap: 16,
  },
  loadingText: {
    fontSize: 13,
    color: colors.onSurfaceSecondary,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  desktopRow: {
    flex: 1,
    flexDirection: 'row',
    ...(Platform.OS === 'web' ? { height: '100vh' as any } : {}),
  },
  desktopMain: {
    flex: 1,
    backgroundColor: '#FDFCF9',
    ...(Platform.OS === 'web' ? { overflowY: 'auto' as any, height: '100vh' as any } : {}),
  },
  desktopContent: {
    flex: 1,
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
  } as any,
});
