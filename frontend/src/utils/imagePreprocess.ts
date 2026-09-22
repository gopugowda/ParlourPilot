/**
 * OCR image pre-processing pipeline (Skia offscreen).
 *
 * Called after the user crops a product-label photo and BEFORE we hand
 * the file off to MLKit text-recognition. Goal: give MLKit a clean,
 * high-contrast, sharpened image so brand + product name are readable
 * even off a shiny salon-bottle surface.
 *
 * Steps:
 *   1. Load the cropped file as an SkImage (fully off the JS thread).
 *   2. Compute target dimensions — upscale small images ~1.5×, cap the
 *      long side at 3000 px so encoding stays cheap.
 *   3. Draw the image into an offscreen surface with:
 *        • ColorMatrix   → contrast × 1.25, subtle brightness lift.
 *        • Convolution   → 3×3 unsharp-mask kernel [0 −1 0 / −1 5 −1 / 0 −1 0].
 *   4. Snapshot → encodeToBase64(JPEG, 92).
 *   5. Write to `cacheDirectory` with a unique filename and return the
 *      new `file://…` URI. MLKit accepts either the raw crop or this
 *      processed version — see `useProcessedIfAvailable()` below.
 *
 * Robustness:
 *   • Every failure path returns `null` so `ocr.ts` can quietly fall
 *     back to the original crop and keep working.
 *   • Native modules (Skia) may be absent in Expo Go → we detect and
 *     bail early.
 */
import { Skia, ImageFormat, TileMode } from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';

/** Contrast strength (>1 boosts). Keep < 1.5 to avoid burning highlights. */
const CONTRAST = 1.25;
/** Small brightness lift to keep faces & lit labels natural after contrast. */
const BRIGHTNESS = 0.04;
/** Upscale factor when the image is < 2000 px on its long side. */
const UPSCALE = 1.5;
/** Never grow beyond this — anything larger just slows MLKit down. */
const MAX_LONG_SIDE = 3000;

/**
 * Build a 4×5 color matrix that applies contrast + brightness.
 * Formula: out = clamp( in * c + (0.5 * (1 - c)) + brightness )
 */
function contrastMatrix(c: number, brightness: number): number[] {
  const t = 0.5 * (1 - c) + brightness;
  return [
    c, 0, 0, 0, t,
    0, c, 0, 0, t,
    0, 0, c, 0, t,
    0, 0, 0, 1, 0,
  ];
}

/** Standard 3×3 unsharp-mask kernel; boosts local edges without haloing. */
const SHARPEN_KERNEL = [
  0, -1, 0,
  -1, 5, -1,
  0, -1, 0,
];

/** Basic runtime check — Skia must be linked (dev / prod build only). */
export function isPreprocessingAvailable(): boolean {
  try {
    return typeof Skia?.Data?.fromURI === 'function';
  } catch {
    return false;
  }
}

/**
 * Preprocess `srcUri` (a `file://…` path from the crop picker) and
 * return the URI of the processed JPEG. Returns `null` on any error
 * so callers can gracefully fall back to the original image.
 */
export async function preprocessForOcr(srcUri: string): Promise<string | null> {
  if (!srcUri) return null;
  if (!isPreprocessingAvailable()) return null;
  try {
    // 1. Decode source.
    const data = await Skia.Data.fromURI(srcUri);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) return null;

    const srcW = image.width();
    const srcH = image.height();
    const longSide = Math.max(srcW, srcH);

    // 2. Target dims — upscale small images, cap the long side.
    let scale = 1;
    if (longSide < 2000) scale = UPSCALE;
    if (longSide * scale > MAX_LONG_SIDE) scale = MAX_LONG_SIDE / longSide;
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    // 3. Offscreen surface + paint (contrast + sharpen).
    const surface = Skia.Surface.MakeOffscreen(dstW, dstH);
    if (!surface) return null;
    const canvas = surface.getCanvas();

    const paint = Skia.Paint();
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(contrastMatrix(CONTRAST, BRIGHTNESS)));
    // Convolution filter kernel offset centres on (1,1) for a 3×3.
    paint.setImageFilter(
      Skia.ImageFilter.MakeMatrixConvolution(
        3, 3, SHARPEN_KERNEL,
        /* gain  */ 1,
        /* bias  */ 0,
        /* offsX */ 1,
        /* offsY */ 1,
        TileMode.Clamp,
        /* convolveAlpha */ false,
      ),
    );

    // Draw scaled source into the offscreen. `SkImage.drawImageRect` isn't
    // exposed, so we use canvas.drawImageRect for the crop/scale-in-place.
    const srcRect = { x: 0, y: 0, width: srcW, height: srcH };
    const dstRect = { x: 0, y: 0, width: dstW, height: dstH };
    (canvas as any).drawImageRect(image, srcRect, dstRect, paint);
    surface.flush();

    const snapshot = surface.makeImageSnapshot();
    if (!snapshot) return null;

    // 4. Encode → base64 JPEG (quality 92, negligible artefacts).
    const b64 = snapshot.encodeToBase64(ImageFormat.JPEG, 92);
    if (!b64) return null;

    // 5. Write out to cache dir.
    const base = FileSystem.cacheDirectory || '';
    const outUri = `${base}pp-ocr-${Date.now()}.jpg`;
    await FileSystem.writeAsStringAsync(outUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return outUri;
  } catch (e) {
    if (__DEV__) console.warn('[ocr:preprocess] failed, using original:', (e as any)?.message || e);
    return null;
  }
}

/** Small helper — pick the processed URI when it's ready, else fall back. */
export function useProcessedIfAvailable(orig: string, processed: string | null): string {
  return processed || orig;
}
