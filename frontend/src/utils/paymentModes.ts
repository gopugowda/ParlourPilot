/**
 * Standardised 6-option payment system, matching the backend contract.
 *
 * Tokens (persisted on server):
 *   cash | card | qr | bank_transfer | split | other
 *
 * User-facing labels (displayed in every UI):
 *   Cash · Card · UPI / QR · Bank Transfer · Split · Other
 *
 * Split logic:
 *   Only the three primary tender types participate in a split bill
 *   (Cash + Card + UPI/QR). `bank_transfer` and `other` are single-tender only.
 */

export type PaymentToken = 'cash' | 'card' | 'qr' | 'bank_transfer' | 'split' | 'other';

/**
 * Tokens accepted by the /expenses endpoint (backend uses a strict Pydantic
 * Literal of the legacy names — 'upi' / 'bank' — not the newer canonical
 * 'qr' / 'bank_transfer' used by Bills).
 */
export type ExpensePaymentToken = 'cash' | 'upi' | 'card' | 'bank' | 'other';

/** All 6 tokens in the canonical display order. */
export const PAYMENT_TOKENS: PaymentToken[] = ['cash', 'card', 'qr', 'bank_transfer', 'split', 'other'];

/** Selectable options for the "New Bill" screen (includes Split). */
export const BILL_PAYMENT_OPTIONS: PaymentToken[] = ['cash', 'card', 'qr', 'bank_transfer', 'split', 'other'];

/**
 * Selectable options for the "Add Expense" screen — expense-native tokens.
 * Backend Literal accepts EXACTLY these values.
 */
export const EXPENSE_PAYMENT_OPTIONS: ExpensePaymentToken[] = ['cash', 'card', 'upi', 'bank', 'other'];

/** Tender types that may participate inside a Split. */
export const SPLIT_TENDERS: PaymentToken[] = ['cash', 'card', 'qr'];

const LABELS: Record<PaymentToken, string> = {
  cash:           'Cash',
  card:           'Card',
  qr:             'UPI / QR',
  bank_transfer:  'Bank Transfer',
  split:          'Split',
  other:          'Other',
};

/**
 * Legacy tokens the mobile app or older bills may still have persisted.
 * These map to their canonical counterparts for display.
 */
const LEGACY_ALIASES: Record<string, PaymentToken> = {
  upi:  'qr',              // old mobile expenses stored "upi"
  bank: 'bank_transfer',   // old mobile expenses stored "bank"
  qr_online: 'qr',
  online: 'qr',
};

/** Return the friendly label for any known token; unknown → titlecased raw. */
export function paymentLabel(token: string | null | undefined): string {
  if (!token) return '—';
  const t = String(token).toLowerCase();
  const canonical = (LEGACY_ALIASES as any)[t] || t;
  if ((LABELS as any)[canonical]) return LABELS[canonical as PaymentToken];
  // Fall back gracefully for any legacy / free-form value on old bills.
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Short icon-only label (used in tight rows like a bill card). */
export function paymentShortLabel(token: string | null | undefined): string {
  if (!token) return '—';
  const t = String(token).toLowerCase();
  const canonical = (LEGACY_ALIASES as any)[t] || t;
  if (canonical === 'qr') return 'UPI';
  if (canonical === 'bank_transfer') return 'Bank';
  return paymentLabel(token);
}

/** Normalise any legacy token to its canonical form (used when re-saving). */
export function canonicalPayment(token: string | null | undefined): PaymentToken {
  const t = String(token || 'cash').toLowerCase();
  const canonical = (LEGACY_ALIASES as any)[t] || t;
  if ((LABELS as any)[canonical]) return canonical as PaymentToken;
  return 'other';
}

/** Is this token a legal choice for expenses? */
export function isExpensePayment(token: string): boolean {
  return (EXPENSE_PAYMENT_OPTIONS as string[]).includes(String(token).toLowerCase());
}

/**
 * Normalise any legacy or canonical token to the exact 5 values the /expenses
 * endpoint accepts. Handles both directions so we're safe against future changes:
 *   qr | q_r_online | online → 'upi'
 *   bank_transfer → 'bank'
 * Falls back to 'other' if unknown.
 */
export function toExpenseToken(token: string | null | undefined): ExpensePaymentToken {
  const t = String(token || 'cash').toLowerCase();
  if (t === 'qr' || t === 'qr_online' || t === 'online' || t === 'upi') return 'upi';
  if (t === 'bank_transfer' || t === 'bank') return 'bank';
  if (t === 'cash' || t === 'card') return t;
  if (t === 'other') return 'other';
  return 'other';
}
