/**
 * Shared input validators — kept in one place so backend-strict rules stay
 * consistent across every form (signup, member, user, salon settings, new-bill).
 *
 * The regex + phone-cap here mirror the backend's Pydantic constraints
 * (strict validation enabled in this iteration).
 */

// RFC-5322 pragmatic subset — good enough for a mobile UI.
const EMAIL_RE = /^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i;

export function isValidEmail(v: string | null | undefined): boolean {
  if (!v) return false;
  const t = String(v).trim();
  return EMAIL_RE.test(t);
}

/** Backend rule: phone must be digits only, max 20 chars. A leading "+"
 *  is preserved because Indian dialing convention often includes it. */
export function sanitizePhone(v: string | null | undefined, maxLen = 20): string {
  if (!v) return '';
  const s = String(v);
  const plus = s.trimStart().startsWith('+') ? '+' : '';
  const digits = s.replace(/[^\d]/g, '');
  const out = (plus + digits).slice(0, maxLen);
  return out;
}

/** Empty phone is allowed unless caller marks it required. When present it must
 *  be at least 6 digits (India-min-mobile) and at most 20 chars total. */
export function isValidPhone(v: string | null | undefined, opts?: { required?: boolean }): boolean {
  const t = (v ?? '').trim();
  if (!t) return !opts?.required;
  const digits = t.replace(/^\+/, '').replace(/[^\d]/g, '');
  return digits.length >= 6 && t.length <= 20;
}

export const PHONE_MAX = 20;
