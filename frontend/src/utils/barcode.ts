/**
 * Barcode compatibility layer.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The mobile app talks to the shared ParlourPilot backend. The
 * canonical field for a scanned product barcode is `stock_item.barcode`
 * (added on 2026-09-08). Until that backend change lands in
 * production, the deployed FastAPI service silently drops the field
 * and the `/api/stock/by-barcode/{barcode}` route returns 404.
 *
 * To make barcode scanning genuinely useful TODAY (Web ↔ Mobile
 * parity, no local-only storage), we round-trip the barcode through
 * the existing `notes` string field using a machine-readable marker:
 *
 *     [bc:0891234567890] Optional handwritten notes.
 *
 * Both apps can read this marker; the human-visible portion of notes
 * still renders normally on the web.
 *
 * Once the backend actually persists `stock_item.barcode`, this
 * helper transparently prefers the canonical field and only falls
 * back to the marker for legacy rows.
 *
 * The barcode is ALWAYS a string — leading zeros preserved.
 */

const MARKER_RE = /^\s*\[bc:([^\]]+)\]\s*/i;

export type BarcodeCarrier = {
  barcode?: string | null;
  notes?: string | null;
};

/** Return the effective barcode of an item — canonical field wins. */
export function getBarcode(item: BarcodeCarrier | null | undefined): string {
  if (!item) return '';
  const canonical = (item.barcode || '').toString().trim();
  if (canonical) return canonical;
  const m = (item.notes || '').match(MARKER_RE);
  return m ? m[1].trim() : '';
}

/** Return the human-visible notes with any barcode marker stripped. */
export function getVisibleNotes(item: BarcodeCarrier | null | undefined): string {
  if (!item) return '';
  return (item.notes || '').replace(MARKER_RE, '').trim();
}

/**
 * Build the string we send to the backend as `notes` when saving.
 * If the backend later starts persisting `barcode` natively we still
 * include the marker — it's cheap, forward-compatible, and lets a
 * legacy mobile client keep reading the barcode from notes.
 */
export function withBarcodeMarker(barcode: string | null | undefined, visibleNotes: string): string {
  const bc = (barcode || '').toString().trim();
  const rest = (visibleNotes || '').replace(MARKER_RE, '').trim();
  if (!bc) return rest;
  return rest ? `[bc:${bc}] ${rest}` : `[bc:${bc}]`;
}
