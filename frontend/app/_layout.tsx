import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { LogBox, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { useAttendanceAutoLogout } from '@/src/hooks/useAttendanceAutoLogout';

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { user, loading, subscriptionExpired, logout } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // GPS-gated auto-logout: only STAFF role, only when app is active. Silently
  // checks GPS every 2 min; if past work_end AND > 1km from branch → check-out + logout.
  useAttendanceAutoLogout({
    role: user?.role || null,
    onAutoLogout: async () => {
      try { await logout(); } catch {}
      router.replace('/login');
    },
  });

  useEffect(() => {
    if (loading) return;
    const seg0 = segments[0] as string | undefined;
    const publicRoutes = new Set(['login', 'signup']);
    const inTabs = seg0 === '(tabs)';
    const isPublic = seg0 && publicRoutes.has(seg0);

    if (!user) {
      if (inTabs || seg0 === 'subscription' || seg0 === 'platform' || seg0 === 'platform-users' || seg0 === 'tenant-detail') {
        router.replace('/login');
      } else if (!isPublic && (segments.length === 0 || seg0 === undefined)) {
        router.replace('/login');
      }
      return;
    }

    // Platform admin/staff (and super_admin alias) have their own home
    if (user.role === 'platform_admin' || user.role === 'platform_staff' || user.role === 'super_admin') {
      if (seg0 !== 'platform' && seg0 !== 'platform-users' && seg0 !== 'tenant-detail') router.replace('/platform');
      return;
    }

    // Subscription check for tenant users
    if (subscriptionExpired && seg0 !== 'subscription') {
      router.replace('/subscription');
      return;
    }

    if (isPublic || segments.length === 0 || seg0 === undefined) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments, subscriptionExpired]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FDFCF9' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="subscription" />
      <Stack.Screen name="platform" />
      <Stack.Screen name="platform-users" />
      <Stack.Screen name="tenant-detail" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="bill/[id]" options={{ presentation: 'card' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 1024;

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );

  if (Platform.OS === 'web') {
    // Web layout is responsive:
    //  - Desktop (≥ 1024px): full width, no phone frame
    //  - Phone / tablet: constrained to a 480px column with soft borders
    return (
      <View style={[webStyles.pageWrap, isDesktop && webStyles.pageWrapDesktop]}>
        <View style={[webStyles.phoneCol, isDesktop && webStyles.desktopCol]}>{content}</View>
      </View>
    );
  }

  return content;
}

const webStyles = StyleSheet.create({
  pageWrap: {
    flex: 1,
    backgroundColor: '#EFEBE2',
    alignItems: 'center',
    justifyContent: 'center',
  } as any,
  pageWrapDesktop: {
    backgroundColor: '#F5F2EA',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  } as any,
  phoneCol: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FDFCF9',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#E8E5DA',
    ...(Platform.OS === 'web' ? ({ height: '100vh' as any }) : {}),
  } as any,
  desktopCol: {
    // On desktop we use the full browser width, no phone frame
    maxWidth: 100000 as any,
    width: '100%',
    alignSelf: 'stretch',
    borderLeftWidth: 0,
    borderRightWidth: 0,
    backgroundColor: '#F5F2EA',
  } as any,
});
