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

// Tenant-configurable currency symbol used for bills/invoices/expenses across the app.
// AuthContext calls setCurrencySymbol() whenever the tenant is loaded / updated.
let _currencySymbol = '₹';
let _localeHint = 'en-IN';
export const setCurrencySymbol = (sym?: string | null, locale?: string | null) => {
  if (sym && typeof sym === 'string' && sym.trim()) _currencySymbol = sym.trim();
  if (locale && typeof locale === 'string') _localeHint = locale;
};
export const getCurrencySymbol = () => _currencySymbol;

// Kept name for backwards compat, but it now honors the tenant's chosen currency symbol.
export const fmtINR = (n: number) => `${_currencySymbol}${(n ?? 0).toLocaleString(_localeHint, { maximumFractionDigits: 2 })}`;
export const fmtMoney = fmtINR;

// Static list of currency symbol choices for the salon (Bills/Invoices/Expenses).
// This is DISPLAY ONLY — no FX conversion is done on bill amounts.
export const CURRENCY_CHOICES: Array<{ code: string; symbol: string; label: string; locale?: string }> = [
  { code: 'INR', symbol: '₹',  label: 'Indian Rupee',    locale: 'en-IN' },
  { code: 'USD', symbol: '$',  label: 'US Dollar',       locale: 'en-US' },
  { code: 'EUR', symbol: '€',  label: 'Euro',            locale: 'en-IE' },
  { code: 'GBP', symbol: '£',  label: 'British Pound',   locale: 'en-GB' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham',      locale: 'en-AE' },
  { code: 'SAR', symbol: '﷼',  label: 'Saudi Riyal',     locale: 'en-SA' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'MYR', symbol: 'RM', label: 'Malaysian Ringgit', locale: 'en-MY' },
  { code: 'JPY', symbol: '¥',  label: 'Japanese Yen',    locale: 'ja-JP' },
  { code: 'CNY', symbol: '¥',  label: 'Chinese Yuan',    locale: 'zh-CN' },
  { code: 'HKD', symbol: 'HK$',label: 'Hong Kong Dollar',locale: 'en-HK' },
  { code: 'NZD', symbol: 'NZ$',label: 'New Zealand Dollar', locale: 'en-NZ' },
  { code: 'ZAR', symbol: 'R',  label: 'South African Rand', locale: 'en-ZA' },
  { code: 'CHF', symbol: 'CHF',label: 'Swiss Franc',     locale: 'de-CH' },
  { code: 'KRW', symbol: '₩',  label: 'Korean Won',      locale: 'ko-KR' },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian Real',  locale: 'pt-BR' },
  { code: 'MXN', symbol: 'Mex$', label: 'Mexican Peso',  locale: 'es-MX' },
  { code: 'THB', symbol: '฿',  label: 'Thai Baht',       locale: 'th-TH' },
];
