/**
 * On-device OCR helper — extracts printable text from a captured
 * still image using Google MLKit via `@react-native-ml-kit/text-recognition`.
 *
 * IMPORTANT (build):
 *   MLKit + react-native-image-crop-picker + @shopify/react-native-skia
 *   are native modules. In Expo Go the native sides are absent and the
 *   caller receives an `'unavailable'` outcome. A dev / production build
 *   ships every native module and OCR works end-to-end.
 *
 * Capture pipeline (fixes the OS-cropper layout / OCR accuracy issues):
 *   1. Camera + crop UI comes from `react-native-image-crop-picker`
 *      (uCrop on Android, TOCropViewController on iOS). Its Crop /
 *      Rotate / Cancel buttons are pinned to the top+bottom bars so
 *      they never overlap the image, and the crop handles have safe
 *      padding around the edges by design.
 *   2. `preprocessForOcr()` upscales the crop ~1.5× and applies a
 *      contrast + unsharp-mask filter via Skia. This is a real
 *      accuracy boost on shiny salon-bottle labels.
 *   3. MLKit recognises text on the processed image (falls back to the
 *      raw crop if preprocessing failed for any reason).
 *
 * PRIVACY:
 *   The image is processed locally on device. Nothing is uploaded.
 *   The temporary image URIs are left in the OS cache and cleaned by
 *   the system.
 *
 * Design of the return type (discriminated union): every failure path
 * is distinguishable so the caller (`app/manage/stock.tsx`) can show a
 * meaningful alert per outcome.
 */
import * as ImagePicker from 'expo-image-picker';
// react-native-image-crop-picker is the primary capture pipeline; we
// keep expo-image-picker imported ONLY to reuse its permission helpers
// (a stable API that already handled the "canAskAgain" flow).
//
// IMPORTANT: DO NOT static-import `react-native-image-crop-picker` — it
// calls `TurboModuleRegistry.getEnforcing` at import time which crashes
// the JS bundle on web / Expo Go before the caller can even see an
// "unavailable" outcome. We require() it lazily inside the capture
// function and gracefully return `'unavailable'` when the native side
// is absent.
import { preprocessForOcr } from '@/src/utils/imagePreprocess';
// Static import so Metro resolves the module at bundle time. The
// native side is loaded lazily when we actually invoke `.recognize()`;
// if the native module is missing (Expo Go), the call throws and we
// surface an "unavailable" outcome to the caller.
import TextRecognition from '@react-native-ml-kit/text-recognition';

export type OcrResult = {
  /** Full text from MLKit (joined blocks if MLKit didn't provide a top-level string). */
  fullText: string;
  /** Individual text blocks (trimmed, empties removed). */
  blocks: string[];
  /** Best-guess product name derived from the top of the label. */
  suggestedName: string;
};

export type OcrOutcome =
  | { kind: 'success'; data: OcrResult }
  | { kind: 'canceled' }                 // user aborted the camera / crop
  | { kind: 'permission_denied' }        // camera permission denied
  | { kind: 'empty' }                    // OCR ran but returned no readable text
  | { kind: 'unavailable' }              // MLKit native module not linked (Expo Go)
  | { kind: 'error'; message: string };  // MLKit threw for another reason

/** True IF the JS side of the MLKit module is loaded. The final answer
 *  (whether the NATIVE side is also linked) only comes when we call
 *  `.recognize()`. Use it as a hint only. */
export function isOcrAvailable(): boolean {
  return !!TextRecognition && typeof (TextRecognition as any).recognize === 'function';
}

async function ensureCameraPermission(): Promise<boolean> {
  const cur = await ImagePicker.getCameraPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  const req = await ImagePicker.requestCameraPermissionsAsync();
  return req.granted;
}

/**
 * Open the camera → let the user crop → run MLKit on the (possibly
 * cropped) URI → return a fully-typed outcome.
 *
 * The camera + crop UI is provided by `react-native-image-crop-picker`
 * so we get pinned Crop/Rotate/Cancel controls, safe padding around the
 * handles, and free-form crop by default — the OS cropper on the older
 * flow had none of that.
 */
export async function scanProductNameFromCamera(): Promise<OcrOutcome> {
  if (!isOcrAvailable()) return { kind: 'unavailable' };

  const granted = await ensureCameraPermission();
  if (!granted) return { kind: 'permission_denied' };

  // ------------------------------------------------------------------
  // 1. Capture + crop via uCrop / TOCropViewController.
  //    freeStyleCropEnabled → user isn't locked to a fixed aspect ratio.
  //    showCropGuidelines   → 3×3 rule-of-thirds grid for framing labels.
  //    compressImageQuality → 0.95: retain detail for the sharpen pass.
  //    hideBottomControls   → false so Reset / Rotate / Aspect are pinned.
  //
  //    Loaded lazily — see the top-of-file note: static-importing this
  //    module crashes web / Expo Go at bundle-eval time.
  // ------------------------------------------------------------------
  let ImageCropPicker: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    ImageCropPicker = require('react-native-image-crop-picker').default;
  } catch {
    return { kind: 'unavailable' };
  }
  if (!ImageCropPicker || typeof ImageCropPicker.openCamera !== 'function') {
    return { kind: 'unavailable' };
  }
  let cropped: { path: string; width: number; height: number };
  try {
    const result = await ImageCropPicker.openCamera({
      mediaType: 'photo',
      cropping: true,
      freeStyleCropEnabled: true,
      showCropGuidelines: true,
      hideBottomControls: false,
      cropperToolbarTitle: 'Crop product label',
      compressImageQuality: 0.95,
      includeBase64: false,
      useFrontCamera: false,
      writeTempFile: true,
    });
    cropped = result as any;
  } catch (e: any) {
    // The picker rejects with a stringy code we translate to our outcome.
    const msg = String(e?.message || e?.code || e || '').toLowerCase();
    if (msg.includes('cancel')) return { kind: 'canceled' };
    if (msg.includes('permission')) return { kind: 'permission_denied' };
    if (__DEV__) console.warn('[ocr] crop-picker threw', msg);
    return { kind: 'error', message: e?.message || 'Could not open camera' };
  }
  const rawUri = cropped?.path;
  if (!rawUri) return { kind: 'canceled' };

  // ------------------------------------------------------------------
  // 2. Preprocess (upscale + contrast + sharpen) via Skia. If any step
  //    fails we silently fall back to the raw cropped image so OCR
  //    always has SOMETHING to work with.
  // ------------------------------------------------------------------
  const processed = await preprocessForOcr(rawUri).catch(() => null);
  const ocrUri = processed || rawUri;

  try {
    // MLKit accepts a file:// URI on both platforms.
    if (__DEV__) console.log('[ocr] recognizing', ocrUri, 'processed=', !!processed);
    const raw: any = await TextRecognition.recognize(ocrUri);
    if (__DEV__) console.log('[ocr] raw', typeof raw?.text, 'blocks=', raw?.blocks?.length);

    // Normalize MLKit output into a flat list of "lines with geometry".
    // MLKit v2 shape (per @react-native-ml-kit/text-recognition):
    //   { text: string, blocks: { text, lines: { text, frame }[], frame }[] }
    //   frame: { top, left, right, bottom, width, height } — units are pixels.
    const geoLines: GeoLine[] = [];
    if (Array.isArray(raw?.blocks)) {
      for (const b of raw.blocks) {
        if (Array.isArray(b?.lines) && b.lines.length) {
          for (const l of b.lines) {
            const t = String(l?.text || '').trim();
            if (!t) continue;
            geoLines.push({ text: t, frame: normalizeFrame(l?.frame) });
          }
        } else {
          // Fallback: block without lines[] — split its .text on newlines,
          // use the block frame for every synthetic "line".
          const parts = String(b?.text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const f = normalizeFrame(b?.frame);
          for (const p of parts) geoLines.push({ text: p, frame: f });
        }
      }
    }

    const blocks = geoLines.map(g => g.text);
    const fullText = String(raw?.text || blocks.join('\n')).trim();

    if (!blocks.length && !fullText) return { kind: 'empty' };

    // Prefer geometry-aware selection when we have frame data; otherwise
    // fall back to the previous top-down text-only heuristic.
    const hasGeo = geoLines.some(g => g.frame && g.frame.height > 0);
    const suggestedName = hasGeo
      ? buildSuggestedNameFromGeo(geoLines)
      : buildSuggestedName(blocks);

    if (!suggestedName) return { kind: 'empty' };

    return { kind: 'success', data: { fullText, blocks, suggestedName } };
  } catch (e: any) {
    if (__DEV__) console.warn('[ocr] recognize threw', e?.message || e);
    // The most common cause in the field is Expo Go / missing native module.
    const msg = String(e?.message || e || '').toLowerCase();
    if (msg.includes('null') || msg.includes('native') || msg.includes('undefined is not a function')) {
      return { kind: 'unavailable' };
    }
    return { kind: 'error', message: e?.message || 'OCR failed' };
  }
}

// -------------------- geometry-aware heuristic -----------------------

type Frame = { top: number; left: number; right: number; bottom: number; width: number; height: number };
type GeoLine = { text: string; frame: Frame };

function normalizeFrame(f: any): Frame {
  const top = num(f?.top);
  const left = num(f?.left);
  const right = num(f?.right);
  const bottom = num(f?.bottom);
  const width = num(f?.width, right - left);
  const height = num(f?.height, bottom - top);
  return { top, left, right, bottom, width, height };
}
function num(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Junk-line filter: reject weights, prices, batch/expiry/MRP, URLs,
 *  regulatory boilerplate, single stylized glyphs, etc. */
function isJunkLine(raw: string): boolean {
  const line = raw.trim();
  if (!line) return true;
  // Anything without at least one letter (numbers, symbols, single glyphs).
  if (!/[A-Za-z]/.test(line)) return true;
  // Extremely short (single letter/glyph left from stylised logos).
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return true;
  // Pure quantity / price lines.
  if (/^\s*(net\s*(wt|weight|content)|mrp|rs\.?|₹|inr|price|volume)\b/i.test(line)) return true;
  if (/^\d+(\.\d+)?\s*(ml|g|kg|l|oz|gm|gms|kgs|ltr|litre|litres|liter|liters|fl\s*oz)\b/i.test(line)) return true;
  // Batch / mfg / exp / caution / manufactured / marketed / for professional use.
  if (/^(batch|b\.no|mfg|mfd|manufacture|exp|expiry|use\s*before|best\s*before|caution|warning|for\s+professional|marketed|manufactured|imported|packed|licence|licensed|lic\s*no)\b/i.test(line)) return true;
  // Regulatory / claim bullets.
  if (/^(dermatologically|clinically|paraben|sulphate|sulfate|silicone|peroxide|hydroquinone|cruelty[\s-]?free|alcohol[\s-]?free|natural|organic|vegan)\b/i.test(line)) return true;
  // URLs / socials.
  if (/(https?:|www\.|@|\.com|\.in|\.co)/i.test(line)) return true;
  // Barcode digits.
  if (/^\d{6,}$/.test(line)) return true;
  return false;
}

/**
 * Geometry-aware suggested-name builder.
 *
 * Idea: on any packaged product the BRAND + PRODUCT NAME is printed
 * in the tallest font on the panel. Every other artefact — taglines,
 * ingredients, MRP, net-wt — is set noticeably smaller. So instead of
 * naively taking the first N lines top-down, we:
 *
 *   1. Discard obvious junk lines (weights, MRP, batch, URLs, ...).
 *   2. Find the tallest surviving line (that's the "hero" font size).
 *   3. Keep every line whose height is ≥ 65% of the hero — this
 *      captures 1–3 line brand+name lock-ups printed at similar size.
 *   4. Sort them in reading order (top → bottom, then left → right).
 *   5. Title-case + trim trailing "…Cream 500g" tails.
 *
 * This directly addresses the two field complaints:
 *   • "only half the name" — we no longer stop after the first big
 *     line; we keep every line printed at the hero size.
 *   • "unwanted extras"    — smaller lines (taglines, ingredients,
 *     regulatory copy) are excluded by height, not by keyword.
 */
export function buildSuggestedNameFromGeo(lines: GeoLine[]): string {
  const usable = lines.filter(l => !isJunkLine(l.text));
  if (!usable.length) return '';

  // Hero font-height = tallest non-junk line.
  const maxH = usable.reduce((m, l) => Math.max(m, l.frame.height || 0), 0);
  if (maxH <= 0) {
    // No usable geometry — fall back to plain heuristic.
    return buildSuggestedName(usable.map(u => u.text));
  }
  const threshold = maxH * 0.65;

  const hero = usable.filter(l => (l.frame.height || 0) >= threshold);

  // Reading order: top-first, then left-first on the same visual row.
  const rowTol = maxH * 0.5;                       // lines within 0.5·hero of each other → same row
  hero.sort((a, b) => {
    const dy = a.frame.top - b.frame.top;
    if (Math.abs(dy) > rowTol) return dy;
    return a.frame.left - b.frame.left;
  });

  // Cap at 4 lines — anything more is almost certainly not the name.
  const chosen = hero.slice(0, 4).map(l => l.text.replace(/\s+/g, ' ').trim());
  const joined = chosen.join(' ').replace(/\s+/g, ' ').trim();
  const trimmed = joined
    // Strip trailing net-content chunks like "…Cream 500g" or "500 ml".
    .replace(/\s+\d+(\.\d+)?\s*(ml|g|kg|l|oz|gm|gms|kgs|ltr|litre)\b.*$/i, '')
    // Strip trailing ® / ™ noise.
    .replace(/[®™©]+/g, '')
    .trim();
  return titleCase(trimmed);
}

/**
 * Text-only fallback (used when MLKit gave us blocks without geometry).
 *
 *  1. Preserve packaging order — the name sits near the top.
 *  2. Drop junk lines (numeric-only, single glyphs, regulatory copy).
 *  3. Cap at the first 4 letter-bearing lines.
 *  4. Stop early on regulatory bullets ("DERMATOLOGICALLY TESTED", ...).
 *  5. Title-case + collapse whitespace.
 */
export function buildSuggestedName(blocks: string[]): string {
  if (!blocks || blocks.length === 0) return '';

  const cleaned: string[] = [];
  for (const raw of blocks) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (isJunkLine(line)) {
      // A junk line encountered mid-list terminates the name region
      // when it's clearly regulatory / bullet copy — but only after we
      // already have at least one usable name line.
      if (cleaned.length) break;
      continue;
    }
    cleaned.push(line);
    if (cleaned.length >= 4) break;
  }

  const chosen = cleaned.length ? cleaned : blocks.slice(0, 3);
  const joined = chosen.join(' ').replace(/\s+/g, ' ').trim();
  const trimmed = joined
    .replace(/\s+\d+(\.\d+)?\s*(ml|g|kg|l|oz|gm|gms)\b.*$/i, '')
    .replace(/[®™©]+/g, '')
    .trim();
  return titleCase(trimmed);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, m => m.toUpperCase())
    // Keep short connectors lowercase mid-string.
    .replace(/\b(And|With|For|The)\b/g, m => m.toLowerCase())
    .replace(/^([a-z])/, m => m.toUpperCase());
}
