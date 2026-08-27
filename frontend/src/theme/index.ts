export const colors = {
  surface: '#FDFCF9',
  onSurface: '#1A1A1A',
  surfaceSecondary: '#FFFFFF',
  onSurfaceSecondary: '#3A3937',
  surfaceTertiary: '#F7F5EE',
  onSurfaceTertiary: '#6B6862',
  surfaceInverse: '#1A1A1A',
  onSurfaceInverse: '#FDFCF9',
  // ParlourPilot red palette (default — replaced per-tenant at runtime via applyBrandColor)
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

// -------- Brand color helpers (dynamic per tenant) --------
// hex "#RRGGBB" → { r, g, b }
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim();
  const norm = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  const n = parseInt(norm.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number): string {
  const t = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`.toUpperCase();
}
// WCAG relative luminance (0..1). Higher = brighter.
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
/** Return '#FFFFFF' or '#1A1A1A' depending on which has better contrast on the given bg. */
export function contrastText(hex: string): string {
  try { return relativeLuminance(hex) > 0.5 ? '#1A1A1A' : '#FFFFFF'; } catch { return '#FFFFFF'; }
}
/** Lighten or darken a hex color by factor (-1..1). Positive = lighter. */
function shade(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  if (factor >= 0) {
    return rgbToHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor);
  }
  const f = 1 + factor; // e.g. -0.2 → *0.8
  return rgbToHex(r * f, g * f, b * f);
}
/** Return the tinted surface color (very light shade) used for chips/backgrounds. */
export function brandTintFor(hex: string): string { return shade(hex, 0.86); }
/** Return a darker shade of the brand for pressed / emphasis states. */
export function brandDarkFor(hex: string): string { return shade(hex, -0.30); }
/** Return a lighter partner shade used for secondary highlights. */
export function brandSoftFor(hex: string): string { return shade(hex, 0.55); }

/** Curated palette of recommended brand colors (still allows custom hex). */
export const BRAND_COLOR_PRESETS: string[] = [
  '#C42032', // ParlourPilot red (default)
  '#E43F5A', // rose
  '#F97316', // orange
  '#F59E0B', // amber
  '#84CC16', // lime
  '#22C55E', // green
  '#14B8A6', // teal
  '#0EA5E9', // sky
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#D946EF', // fuchsia
  '#EC4899', // pink
  '#111827', // near-black
  '#374151', // slate
  '#A16207', // gold
];

/** Update the shared `colors` object in-place so all future StyleSheet reads pick up the new brand. */
export function applyBrandColor(hex?: string | null) {
  if (!hex || typeof hex !== 'string' || !/^#?[0-9a-fA-F]{3,8}$/.test(hex.trim())) return;
  const primary = hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
  colors.brand = primary;
  colors.brandPrimary = primary;
  colors.brandDark = brandDarkFor(primary);
  colors.brandSecondary = brandSoftFor(primary);
  colors.brandTertiary = brandTintFor(primary);
  colors.onBrandPrimary = contrastText(primary);
  colors.onBrandTertiary = brandDarkFor(primary);
}

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
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
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

// Static list of currency choices — DISPLAY ONLY (no FX conversion).
// This list mirrors the web app's expanded currency set (~51 items) so a
// tenant's saved `currency` code from web is rendered correctly on mobile.
export const CURRENCY_CHOICES: Array<{ code: string; symbol: string; label: string; locale?: string }> = [
  // South Asia
  { code: 'INR', symbol: '₹',   label: 'Indian Rupee',        locale: 'en-IN' },
  { code: 'PKR', symbol: '₨',   label: 'Pakistani Rupee',     locale: 'en-PK' },
  { code: 'BDT', symbol: '৳',   label: 'Bangladeshi Taka',    locale: 'bn-BD' },
  { code: 'LKR', symbol: 'Rs',  label: 'Sri Lankan Rupee',    locale: 'en-LK' },
  { code: 'NPR', symbol: '₨',   label: 'Nepalese Rupee',      locale: 'en-NP' },
  { code: 'BTN', symbol: 'Nu.', label: 'Bhutanese Ngultrum',  locale: 'en-IN' },
  { code: 'MVR', symbol: 'Rf',  label: 'Maldivian Rufiyaa',   locale: 'en-IN' },
  // Middle East
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham',          locale: 'en-AE' },
  { code: 'SAR', symbol: '﷼',   label: 'Saudi Riyal',         locale: 'en-SA' },
  { code: 'QAR', symbol: 'ر.ق', label: 'Qatari Riyal',        locale: 'en' },
  { code: 'OMR', symbol: 'ر.ع.',label: 'Omani Rial',          locale: 'en' },
  { code: 'KWD', symbol: 'د.ك', label: 'Kuwaiti Dinar',       locale: 'en' },
  { code: 'BHD', symbol: '.د.ب',label: 'Bahraini Dinar',      locale: 'en' },
  { code: 'JOD', symbol: 'د.ا', label: 'Jordanian Dinar',     locale: 'en' },
  { code: 'ILS', symbol: '₪',   label: 'Israeli Shekel',      locale: 'he-IL' },
  { code: 'TRY', symbol: '₺',   label: 'Turkish Lira',        locale: 'tr-TR' },
  { code: 'EGP', symbol: 'ج.م',  label: 'Egyptian Pound',      locale: 'en' },
  // Americas
  { code: 'USD', symbol: '$',   label: 'US Dollar',           locale: 'en-US' },
  { code: 'CAD', symbol: 'C$',  label: 'Canadian Dollar',     locale: 'en-CA' },
  { code: 'MXN', symbol: 'Mex$',label: 'Mexican Peso',        locale: 'es-MX' },
  { code: 'BRL', symbol: 'R$',  label: 'Brazilian Real',      locale: 'pt-BR' },
  { code: 'ARS', symbol: '$',   label: 'Argentine Peso',      locale: 'es-AR' },
  { code: 'CLP', symbol: '$',   label: 'Chilean Peso',        locale: 'es-CL' },
  { code: 'COP', symbol: '$',   label: 'Colombian Peso',      locale: 'es-CO' },
  // Europe
  { code: 'EUR', symbol: '€',   label: 'Euro',                locale: 'en-IE' },
  { code: 'GBP', symbol: '£',   label: 'British Pound',       locale: 'en-GB' },
  { code: 'CHF', symbol: 'CHF', label: 'Swiss Franc',         locale: 'de-CH' },
  { code: 'NOK', symbol: 'kr',  label: 'Norwegian Krone',     locale: 'nb-NO' },
  { code: 'SEK', symbol: 'kr',  label: 'Swedish Krona',       locale: 'sv-SE' },
  { code: 'DKK', symbol: 'kr',  label: 'Danish Krone',        locale: 'da-DK' },
  { code: 'PLN', symbol: 'zł',  label: 'Polish Zloty',        locale: 'pl-PL' },
  { code: 'CZK', symbol: 'Kč',  label: 'Czech Koruna',        locale: 'cs-CZ' },
  { code: 'HUF', symbol: 'Ft',  label: 'Hungarian Forint',    locale: 'hu-HU' },
  { code: 'RON', symbol: 'lei', label: 'Romanian Leu',        locale: 'ro-RO' },
  { code: 'RUB', symbol: '₽',   label: 'Russian Ruble',       locale: 'ru-RU' },
  { code: 'UAH', symbol: '₴',   label: 'Ukrainian Hryvnia',   locale: 'uk-UA' },
  // Asia Pacific
  { code: 'JPY', symbol: '¥',   label: 'Japanese Yen',        locale: 'ja-JP' },
  { code: 'CNY', symbol: '¥',   label: 'Chinese Yuan',        locale: 'zh-CN' },
  { code: 'KRW', symbol: '₩',   label: 'Korean Won',          locale: 'ko-KR' },
  { code: 'HKD', symbol: 'HK$', label: 'Hong Kong Dollar',    locale: 'en-HK' },
  { code: 'TWD', symbol: 'NT$', label: 'Taiwan Dollar',       locale: 'zh-TW' },
  { code: 'SGD', symbol: 'S$',  label: 'Singapore Dollar',    locale: 'en-SG' },
  { code: 'MYR', symbol: 'RM',  label: 'Malaysian Ringgit',   locale: 'en-MY' },
  { code: 'THB', symbol: '฿',   label: 'Thai Baht',           locale: 'th-TH' },
  { code: 'IDR', symbol: 'Rp',  label: 'Indonesian Rupiah',   locale: 'id-ID' },
  { code: 'PHP', symbol: '₱',   label: 'Philippine Peso',     locale: 'en-PH' },
  { code: 'VND', symbol: '₫',   label: 'Vietnamese Dong',     locale: 'vi-VN' },
  { code: 'AUD', symbol: 'A$',  label: 'Australian Dollar',   locale: 'en-AU' },
  { code: 'NZD', symbol: 'NZ$', label: 'New Zealand Dollar',  locale: 'en-NZ' },
  // Africa
  { code: 'ZAR', symbol: 'R',   label: 'South African Rand',  locale: 'en-ZA' },
  { code: 'NGN', symbol: '₦',   label: 'Nigerian Naira',      locale: 'en-NG' },
  { code: 'KES', symbol: 'KSh', label: 'Kenyan Shilling',     locale: 'en-KE' },
  { code: 'MAD', symbol: 'DH',  label: 'Moroccan Dirham',     locale: 'ar-MA' },
];
