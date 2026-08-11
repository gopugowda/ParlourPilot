import React from 'react';
import { Tabs, Slot } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, contrastText } from '@/src/theme';
import { useBrand } from '@/src/context/AuthContext';
import { useResponsive } from '@/src/hooks/use-responsive';
import { DesktopSidebar } from '@/src/components/DesktopSidebar';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { brandColor } = useBrand();
  const onBrand = contrastText(brandColor || colors.brandPrimary);
  const inactive = onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)';
  const { isDesktop } = useResponsive();

  // On desktop, replace the bottom tab bar with a persistent left sidebar.
  if (isDesktop) {
    return (
      <View style={styles.desktopRow}>
        <DesktopSidebar mode="tenant" />
        <View style={styles.desktopMain} testID="desktop-main">
          <View style={styles.desktopContent}>
            <Slot />
          </View>
        </View>
      </View>
    );
  }

  return (
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
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="new-bill"
        options={{
          title: 'New Bill',
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size + 4} color={color} />,
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: 'Expenses',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
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
  );
}

const styles = StyleSheet.create({
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
