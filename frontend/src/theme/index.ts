export const colors = {
  surface: '#FDFCF9',
  onSurface: '#2C2A29',
  surfaceSecondary: '#FFFFFF',
  onSurfaceSecondary: '#4A4744',
  surfaceTertiary: '#F5F4F0',
  onSurfaceTertiary: '#66625E',
  surfaceInverse: '#2C2A29',
  onSurfaceInverse: '#FDFCF9',
  brand: '#B46A55',
  brandPrimary: '#B46A55',
  onBrandPrimary: '#FFFFFF',
  brandSecondary: '#D69888',
  onBrandSecondary: '#2C2A29',
  brandTertiary: '#F9EBE8',
  onBrandTertiary: '#B46A55',
  success: '#5E7A5A',
  onSuccess: '#FFFFFF',
  warning: '#D18E42',
  onWarning: '#FFFFFF',
  error: '#BA5454',
  onError: '#FFFFFF',
  info: '#66625E',
  onInfo: '#FFFFFF',
  border: '#E8E6E1',
  borderStrong: '#D1CEC7',
  divider: '#F0EFEB',
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
