import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, contrastText } from '@/src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '@/src/context/AuthContext';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { brandColor } = useBrand();
  const onBrand = contrastText(brandColor || colors.brandPrimary);
  const inactive = onBrand === '#FFFFFF' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)';
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
