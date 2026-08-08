export const colors = {
  surface: '#FDFCF9',
  onSurface: '#1A1A1A',
  surfaceSecondary: '#FFFFFF',
  onSurfaceSecondary: '#3A3937',
  surfaceTertiary: '#F7F5EE',
  onSurfaceTertiary: '#6B6862',
  surfaceInverse: '#1A1A1A',
  onSurfaceInverse: '#FDFCF9',
  // ParlourPilot red palette
  brand: '#C42032',
  brandPrimary: '#C42032',
  onBrandPrimary: '#FFFFFF',
  brandSecondary: '#F5B7BE',
  onBrandSecondary: '#1A1A1A',
  brandTertiary: '#FDECEE',
  onBrandTertiary: '#8A0E1D',
  brandDark: '#8A0E1D',
  accent: '#1A1A1A',
  onAccent: '#FFFFFF',
  success: '#2F855A',
  onSuccess: '#FFFFFF',
  warning: '#D18E42',
  onWarning: '#FFFFFF',
  error: '#BA5454',
  onError: '#FFFFFF',
  info: '#6B6862',
  onInfo: '#FFFFFF',
  border: '#E8E5DA',
  borderStrong: '#D1CCBE',
  divider: '#F0EDE3',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  strong: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
  },
};

export const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
