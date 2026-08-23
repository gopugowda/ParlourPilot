import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { colors } from '@/src/theme';

export default function Index() {
  const { user, loading, firstAccessibleRoute } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) {
      const route = firstAccessibleRoute();
      router.replace((route || '/(tabs)') as any);
    } else {
      router.replace('/login');
    }
  }, [user, loading]);

  return (
    <View style={styles.container} testID="splash-screen">
      <ActivityIndicator size="large" color={colors.brandPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
