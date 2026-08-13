/**
 * WhatsApp deep-link helper — opens WhatsApp with a pre-filled itemized
 * invoice message. Uses `https://wa.me/<E164>?text=<encoded>` which works on
 * mobile (opens native WhatsApp) and web (opens WhatsApp Web).
 *
 * No WhatsApp Business API / credentials needed — pure client-side. Staff
 * only needs to tap "Send" inside WhatsApp after this opens the chat.
 */
import { Alert, Linking, Platform } from 'react-native';

const DEFAULT_COUNTRY_CODE = '91'; // India — adjust if you go global

/**
 * Normalise a phone number into E.164 without the leading `+` (WhatsApp's
 * expected format). Strips spaces, dashes, parens, dots. Prepends
 * DEFAULT_COUNTRY_CODE for 10-digit inputs. Returns null if the number
 * looks obviously invalid so we don't launch a bogus deep-link.
 */
export function normalisePhoneForWhatsApp(raw?: string | null, defaultCC = DEFAULT_COUNTRY_CODE): string | null {
  if (!raw) return null;
  // Strip everything except digits and a leading `+`
  let s = String(raw).trim();
  const hadPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;

  // Numbers starting with `0` are national — drop the leading zero
  s = s.replace(/^0+/, '');

  // If the caller included a `+`, trust the country code
  if (hadPlus) return s.length >= 8 ? s : null;

  // Bare 10-digit → prepend default country code (India = 91)
  if (s.length === 10) return defaultCC + s;

  // Already includes country code (11–15 digits)
  if (s.length >= 11 && s.length <= 15) return s;

  return null;
}

export type WhatsAppInvoiceParams = {
  businessName?: string | null;
  billNo?: string | number | null;
  dateStr?: string | null;                       // e.g. "12 Aug 2026, 04:32 PM"
  customerName?: string | null;
  items: Array<{ name: string; qty?: number; price: number }>;
  subtotal?: number;
  discount?: number;
  tax?: number;
  tip?: number;
  grandTotal: number;
  paymentMode?: string | null;                   // "Cash", "UPI", etc.
  thankYouLine?: string | null;                  // override default
  currency?: string;                             // "₹" (default)
};

/**
 * Build a plain-text WhatsApp message body. Uses only characters that render
 * consistently in the WhatsApp text bubble across iOS + Android.
 */
export function buildWhatsAppInvoiceMessage(p: WhatsAppInvoiceParams): string {
  const sym = p.currency || '₹';
  const money = (n: number) => `${sym}${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines: string[] = [];

  const header = p.businessName ? `*${p.businessName}*` : '*Invoice*';
  lines.push(header);
  if (p.billNo != null) lines.push(`Invoice #${p.billNo}`);
  if (p.dateStr) lines.push(p.dateStr);
  lines.push(''); // blank

  if (p.customerName) lines.push(`Hi ${p.customerName},`);
  else lines.push('Hi,');
  lines.push('Thank you for visiting! Here are your invoice details:');
  lines.push('');

  // Itemised block
  lines.push('*Services*');
  p.items.forEach((it) => {
    const qty = it.qty && it.qty > 1 ? ` × ${it.qty}` : '';
    lines.push(`• ${it.name}${qty} — ${money(it.price)}`);
  });
  lines.push('');

  // Optional lines
  if (p.subtotal != null && p.subtotal !== p.grandTotal) lines.push(`Subtotal: ${money(p.subtotal)}`);
  if (p.discount != null && p.discount > 0) lines.push(`Discount: -${money(p.discount)}`);
  if (p.tax != null && p.tax > 0) lines.push(`Tax: ${money(p.tax)}`);
  if (p.tip != null && p.tip > 0) lines.push(`Tip: ${money(p.tip)}`);

  lines.push(`*Total: ${money(p.grandTotal)}*`);
  if (p.paymentMode) lines.push(`_Paid via ${p.paymentMode}_`);
  lines.push('');
  lines.push(p.thankYouLine || 'We appreciate your business — see you again soon! 🙏');

  return lines.join('\n');
}

/**
 * Opens WhatsApp (native app on iOS/Android, web chat on browser) with the
 * message pre-populated. Shows a friendly alert if the phone number is
 * invalid or WhatsApp isn't installed.
 */
export async function sendWhatsAppInvoice(opts: {
  phone?: string | null;
  message: string;
  countryCode?: string;
}): Promise<boolean> {
  const e164 = normalisePhoneForWhatsApp(opts.phone, opts.countryCode);
  if (!e164) {
    Alert.alert(
      'No valid phone number',
      opts.phone
        ? `The number "${opts.phone}" doesn't look like a valid mobile. Please update the customer's phone and try again.`
        : 'This bill has no customer phone number. Add one to the customer record first.',
    );
    return false;
  }

  const encoded = encodeURIComponent(opts.message);
  // Universal WhatsApp deep-link — https://wa.me/ works on all platforms
  const url = `https://wa.me/${e164}?text=${encoded}`;

  try {
    if (Platform.OS === 'web') {
      // Opening in a new tab avoids the iframe preview blocker; falls back to same-tab
      const w: any = typeof window !== 'undefined' ? window : null;
      if (w) {
        const opened = w.open(url, '_blank');
        if (!opened) w.location.href = url;
        return true;
      }
    }
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('WhatsApp not installed', 'Please install WhatsApp on this device to send invoices.');
      return false;
    }
    await Linking.openURL(url);
    return true;
  } catch (e: any) {
    Alert.alert('Could not open WhatsApp', e?.message || 'Please try again.');
    return false;
  }
}
