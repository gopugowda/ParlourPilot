/**
 * On-device OCR helper — extracts printable text from a captured
 * still image using Google MLKit via `@react-native-ml-kit/text-recognition`.
 *
 * IMPORTANT (build):
 *   MLKit is a native module. In Expo Go the native side is absent
 *   and calling `recognize()` throws at runtime; the caller receives
 *   the `'unavailable'` outcome and shows a friendly alert. A dev /
 *   production build ships the native module and OCR works end-to-end.
 *
 * PRIVACY:
 *   The image is processed locally on device. Nothing is uploaded.
 *   The temporary image URI is discarded once OCR returns.
 *
 * Design of the return type (discriminated union): earlier revisions
 * returned `null` for every failure path — success with empty text,
 * user cancel, MLKit throw, or missing native module — which made it
 * impossible for the caller to give useful feedback. Now every
 * outcome is distinguishable.
 */
import * as ImagePicker from 'expo-image-picker';
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
 * `allowsEditing: true` means the URI in `result.assets[0].uri` is
 * the CROPPED image on both iOS and Android. That's exactly the URI
 * we hand to MLKit.
 */
export async function scanProductNameFromCamera(): Promise<OcrOutcome> {
  if (!isOcrAvailable()) return { kind: 'unavailable' };

  const granted = await ensureCameraPermission();
  if (!granted) return { kind: 'permission_denied' };

  const picked = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.85,
    exif: false,
    base64: false,
  });
  if (picked.canceled) return { kind: 'canceled' };
  const uri = picked.assets?.[0]?.uri;
  if (!uri) return { kind: 'canceled' };

  try {
    // MLKit accepts a file:// URI on both platforms.
    if (__DEV__) console.log('[ocr] recognizing', uri);
    const raw: any = await TextRecognition.recognize(uri);
    if (__DEV__) console.log('[ocr] raw', typeof raw?.text, 'blocks=', raw?.blocks?.length);

    // MLKit v2 shape: { text: string, blocks: { text, lines, frame }[] }
    // Fall back to lines/split when a specific field is missing.
    const rawBlocks: string[] = Array.isArray(raw?.blocks)
      ? raw.blocks.flatMap((b: any) => {
          if (Array.isArray(b?.lines) && b.lines.length) {
            return b.lines.map((l: any) => String(l?.text || '').trim());
          }
          return [String(b?.text || '').trim()];
        })
      : String(raw?.text || '').split(/\r?\n/);

    const blocks = rawBlocks.map(s => s.trim()).filter(Boolean);
    const fullText = String(raw?.text || blocks.join('\n')).trim();

    if (!blocks.length && !fullText) return { kind: 'empty' };

    const suggestedName = buildSuggestedName(blocks);
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

/**
 * Turn raw OCR blocks into a plausible product name.
 *
 *  1. Preserve packaging order — the name sits near the top of the
 *     label, so we work from the top down.
 *  2. Drop lines that are essentially numeric ("500 g", "1 L").
 *  3. Drop tiny 1-char lines (®, ™, single letters left over from
 *     stylised logos).
 *  4. Cap at the first 5 letter-bearing lines so we don't glue the
 *     product name to the marketing bullets underneath.
 *  5. Stop early if a line clearly ends the "name" region — a bullet
 *     like "DERMATOLOGICALLY TESTED" or "PEROXIDE FREE".
 *  6. Title-case + collapse whitespace.
 *
 * Nothing is INVENTED — we only rearrange what MLKit already saw.
 */
export function buildSuggestedName(blocks: string[]): string {
  if (!blocks || blocks.length === 0) return '';
  const letters = /[A-Za-z]/;
  const numericOnly = /^[\d\s./%,-]+(ml|g|kg|l|oz|gm|gms|kgs|ltr|litre)?\s*$/i;
  const bulletKeywords = /^(dermatologically|peroxide|sulphate|paraben|hydroqui|silicone|cruelty|alcohol|for professional|caution|manufactured|marketed|batch|mfg|exp|use before|net|mrp)/i;

  const cleaned: string[] = [];
  for (const raw of blocks) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line.length < 2) continue;
    if (!letters.test(line)) continue;
    if (numericOnly.test(line)) continue;
    if (bulletKeywords.test(line)) break;              // stop the name region
    cleaned.push(line);
    if (cleaned.length >= 5) break;
  }

  const chosen = cleaned.length ? cleaned : blocks.slice(0, 3);
  const joined = chosen.join(' ').replace(/\s+/g, ' ').trim();
  // Strip trailing net-content chunks like "…Cream 500g".
  const trimmed = joined.replace(/\s+\d+\s*(ml|g|kg|l|oz|gm|gms)\b.*$/i, '').trim();
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
