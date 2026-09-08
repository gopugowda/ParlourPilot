/**
 * On-device OCR helper — extracts printable text from a captured
 * still image using Google MLKit via `@react-native-ml-kit/text-recognition`.
 *
 * IMPORTANT (build):
 *   MLKit is a native module and IS NOT AVAILABLE INSIDE EXPO GO.
 *   Tapping "Scan Product Name" inside Expo Go falls back to a
 *   friendly "OCR unavailable in Expo Go" message instead of
 *   crashing. In an EAS Development Build / production build the
 *   feature works end-to-end.
 *
 * PRIVACY:
 *   The image is processed locally on the device. Nothing is
 *   uploaded to a server. The image is discarded once OCR returns.
 */
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

export type OcrResult = {
  /** Everything MLKit returned, joined by newlines. */
  fullText: string;
  /** Individual text blocks (trimmed, empties removed). */
  blocks: string[];
  /** Our best-guess product name derived from the blocks. */
  suggestedName: string;
};

/** True when the underlying native OCR module is available at runtime. */
export function isOcrAvailable(): boolean {
  try {
    // require() will throw in Expo Go because the native module isn't linked.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-ml-kit/text-recognition');
    return !!mod && (typeof mod.recognize === 'function' || (mod.default && typeof mod.default.recognize === 'function'));
  } catch {
    return false;
  }
}

async function ensureCameraPermission(): Promise<boolean> {
  const cur = await ImagePicker.getCameraPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) {
    // The user permanently denied — nothing we can do inline.
    return false;
  }
  const req = await ImagePicker.requestCameraPermissionsAsync();
  return req.granted;
}

/**
 * Ask the user to capture a photo of the packaging (front label
 * ideally), run MLKit locally, and return the extracted text.
 * Returns `null` when OCR is unavailable, the user cancels, or the
 * scan yields no readable text.
 */
export async function scanProductNameFromCamera(): Promise<OcrResult | null> {
  if (!isOcrAvailable()) {
    // Signal to callers so they can surface the "dev build required" hint.
    return null;
  }
  const granted = await ensureCameraPermission();
  if (!granted) {
    // Nudge the user to Settings if they denied twice.
    try { await Linking.openSettings(); } catch {}
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.8,
    exif: false,
    base64: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  const uri = result.assets[0].uri;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-ml-kit/text-recognition');
    const TR = mod.default ?? mod;
    const recognized = await TR.recognize(uri);
    const blocks: string[] = Array.isArray(recognized?.blocks)
      ? recognized.blocks.map((b: any) => String(b?.text || '').trim()).filter(Boolean)
      : String(recognized?.text || '').split('\n').map((s: string) => s.trim()).filter(Boolean);

    const fullText = blocks.join('\n');
    return { fullText, blocks, suggestedName: buildSuggestedName(blocks) };
  } catch {
    return null;
  }
}

/**
 * Derive a plausible product name from raw OCR blocks. Heuristics:
 *   • Keep lines with letters (drop pure-numeric lines like "500 ML"
 *     unless we have nothing else).
 *   • Prefer the 2-3 longest lines from the top half of the label.
 *   • Title-case and stitch with single spaces.
 *   • Trim obvious weight/volume suffixes ("500 ML", "250 G") to
 *     avoid duplicating them if the user re-enters unit info.
 *
 * NEVER invents information not present in the OCR output.
 */
export function buildSuggestedName(blocks: string[]): string {
  if (!blocks || blocks.length === 0) return '';
  const letters = /[A-Za-z]/;
  const numericOnly = /^[\d\s./ml gkgL%]+$/i;

  // Preserve the packaging order — top of the label first.
  const candidates = blocks
    .map(b => b.replace(/\s+/g, ' ').trim())
    .filter(b => b.length >= 2)
    .filter(b => letters.test(b) && !numericOnly.test(b));

  // Take the top 4 lines by document order (name usually sits high).
  const primary = (candidates.length ? candidates : blocks.slice()).slice(0, 4);

  // Drop trailing size/volume-only tokens if a longer name exists.
  const cleaned = primary.filter(l => !/^\s*\d+\s*(ml|g|kg|l|oz)?\s*$/i.test(l));
  const chosen = cleaned.length ? cleaned : primary;

  const joined = chosen.join(' ').replace(/\s+/g, ' ').trim();
  return titleCase(joined);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase());
}
