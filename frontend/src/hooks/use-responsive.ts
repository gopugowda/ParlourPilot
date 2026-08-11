/**
 * Responsive breakpoints for React Native Web.
 * - phone: < 768   (default mobile)
 * - tablet: 768-1023
 * - desktop: >= 1024 (permanent sidebar, wide tables)
 */
import { useWindowDimensions, Platform } from 'react-native';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export function useResponsive() {
  const { width } = useWindowDimensions();
  // Only apply desktop layouts on the web platform.
  const isWeb = Platform.OS === 'web';
  const isDesktop = isWeb && width >= 1024;
  const isTablet = isWeb && !isDesktop && width >= 768;
  const isPhone = !isDesktop && !isTablet;
  const bp: Breakpoint = isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone';
  return { width, bp, isDesktop, isTablet, isPhone, isWeb };
}
