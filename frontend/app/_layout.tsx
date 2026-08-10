import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { LogBox, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { user, loading, subscriptionExpired } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const seg0 = segments[0] as string | undefined;
    const publicRoutes = new Set(['login', 'signup']);
    const inTabs = seg0 === '(tabs)';
    const isPublic = seg0 && publicRoutes.has(seg0);

    if (!user) {
      if (inTabs || seg0 === 'subscription' || seg0 === 'platform') {
        router.replace('/login');
      } else if (!isPublic && (segments.length === 0 || seg0 === undefined)) {
        router.replace('/login');
      }
      return;
    }

    // Logged in
    // Platform admin has its own home
    if (user.role === 'platform_admin') {
      if (seg0 !== 'platform') router.replace('/platform');
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
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="bill/[id]" options={{ presentation: 'card' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );

  if (Platform.OS === 'web') {
    // On web, constrain the app to a phone-sized column and center it.
    return (
      <View style={webStyles.pageWrap}>
        <View style={webStyles.phoneCol}>{content}</View>
      </View>
    );
  }

  return content;
}

const webStyles = StyleSheet.create({
  pageWrap: {
    flex: 1,
    backgroundColor: '#EFEBE2', // neutral surrounding
    alignItems: 'center',
    justifyContent: 'center',
  } as any,
  phoneCol: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FDFCF9',
    // subtle side borders on wide screens for a phone-frame feel
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#E8E5DA',
    // Use viewport height on web so the layout does not overflow the browser
    ...(Platform.OS === 'web' ? ({ height: '100vh' as any }) : {}),
  } as any,
});
