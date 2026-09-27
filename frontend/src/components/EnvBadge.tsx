import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_ENV, ENV_LABEL, IS_PRODUCTION } from '@/src/lib/appEnv';

/**
 * Small, non-interactive "STAGING" chip anchored to the top-right of the safe
 * area. Rendered ONLY when APP_ENV ≠ production, so testers cannot mistake a
 * TestFlight/staging build for a live production install. Hidden entirely in
 * production builds — this file is a no-op if IS_PRODUCTION is true.
 */
export default function EnvBadge() {
  const insets = useSafeAreaInsets();
  if (IS_PRODUCTION || !ENV_LABEL) return null;

  const backgroundColor = APP_ENV === 'staging' ? '#F59E0B' : '#3B82F6';

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          top: insets.top + 4,
          right: 8,
          backgroundColor,
        },
      ]}
    >
      <Text style={styles.text} numberOfLines={1}>
        {ENV_LABEL}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 9999,
    elevation: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
      },
      default: {},
    }),
  },
  text: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});
