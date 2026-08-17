/**
 * Shared input validators — single source of truth for every mobile form.
 *
 * Rules mirror the FastAPI backend's Pydantic constraints EXACTLY so the client
 * can preempt any 422 and give the user instant, friendly feedback:
 *
 *   Email  → ^[^\s@]+@[^\s@]+\.[^\s@]+$   (same as Pydantic EmailStr shape); trim ws.
 *   Phone  → strip ALL non-digits before validating / sending; required needs ≥1 digit;
 *            max 20 digits.
 *
 * Friendly copy (used verbatim by the UI):
 *   Email empty     → "Please enter your email"
 *   Email invalid   → "Please enter a valid email address"
 *   Mobile empty    → "Please enter a mobile number"
 *   Mobile no digs  → "Please enter a valid mobile number"
 *   Mobile too long → "Mobile number can't be more than 20 digits"
 */

// ---------- constants ----------
export const PHONE_MAX = 20;               // max digits allowed
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MSG = {
  emailEmpty: 'Please enter your email',
  emailInvalid: 'Please enter a valid email address',
  mobileEmpty: 'Please enter a mobile number',
  mobileInvalid: 'Please enter a valid mobile number',
  mobileTooLong: `Mobile number can't be more than ${PHONE_MAX} digits`,
} as const;

// ---------- email ----------
/** Trims and normalises for sending to backend. */
export function normalizeEmail(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

export function isValidEmail(v: string | null | undefined): boolean {
  const t = (v ?? '').trim();
  if (!t) return false;
  return EMAIL_RE.test(t);
}

/** Return the friendly message for an email value, or null if it passes. */
export function emailError(
  v: string | null | undefined,
  opts?: { required?: boolean },
): string | null {
  const t = (v ?? '').trim();
  if (!t) return opts?.required ? MSG.emailEmpty : null;
  return EMAIL_RE.test(t) ? null : MSG.emailInvalid;
}

// ---------- phone / mobile ----------
/** Strip everything that isn't 0-9, then cap at PHONE_MAX. Never keeps a `+`. */
export function sanitizePhone(v: string | null | undefined, maxLen: number = PHONE_MAX): string {
  if (v == null) return '';
  return String(v).replace(/\D+/g, '').slice(0, maxLen);
}

/**
 * Backend contract:
 *  - empty → OK if optional, error if required
 *  - non-empty → must have ≥1 digit and ≤ PHONE_MAX digits
 */
export function isValidPhone(v: string | null | undefined, opts?: { required?: boolean }): boolean {
  const digits = (v ?? '').replace(/\D+/g, '');
  if (!digits) return !opts?.required;
  if (digits.length > PHONE_MAX) return false;
  return digits.length >= 1;
}

/** Friendly message for a phone value, or null if it passes. */
export function phoneError(
  v: string | null | undefined,
  opts?: { required?: boolean },
): string | null {
  const digits = (v ?? '').replace(/\D+/g, '');
  if (!digits) return opts?.required ? MSG.mobileEmpty : null;
  if (digits.length > PHONE_MAX) return MSG.mobileTooLong;
  // ≥1 digit satisfies the rule, but a single "1" is almost never a real
  // number — we leave stricter checks (like ≥10 for IN) to server-side/BI.
  return null;
}

// ---------- backend 422 fallback ----------
/**
 * If the backend still rejects with a 422 (e.g. a field we haven't wired
 * client-side yet), turn its raw Pydantic detail into one of our friendly
 * strings. Falls back to the raw message otherwise.
 */
export function parse422(err: any): string | null {
  if (!err) return null;
  const raw = (err.message || err.detail || '').toString().toLowerCase();
  if (!raw) return null;
  if (raw.includes('email')) {
    if (raw.includes('required') || raw.includes('missing')) return MSG.emailEmpty;
    return MSG.emailInvalid;
  }
  if (raw.includes('phone') || raw.includes('mobile')) {
    if (raw.includes('required') || raw.includes('missing')) return MSG.mobileEmpty;
    if (raw.includes('20') || raw.includes('too long') || raw.includes('max_length')) return MSG.mobileTooLong;
    return MSG.mobileInvalid;
  }
  return null;
}
