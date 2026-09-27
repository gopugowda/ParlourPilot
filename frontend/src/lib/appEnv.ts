/**
 * =============================================================================
 * SINGLE SOURCE OF TRUTH FOR MOBILE BUILD IDENTITY & BACKEND URL BINDING
 * =============================================================================
 * This module is imported (transitively) at app cold-start. It performs a
 * FAIL-LOUD validation of the build's environment identity so a misconfigured
 * TestFlight/staging build can NEVER silently connect to production, and a
 * misconfigured production build can NEVER silently connect to staging.
 *
 * Contract:
 *   - Exactly one of `development | staging | production` must be the active
 *     APP_ENV. It is set via the `EXPO_PUBLIC_APP_ENV` env var (baked into the
 *     bundle at build time by Expo / EAS).
 *   - Each APP_ENV pins the backend URL:
 *          production → https://parlourpilot.com
 *          staging    → https://staff-portal-331.preview.emergentagent.com
 *          development → whatever EXPO_PUBLIC_BACKEND_URL says (LAN dev override)
 *   - A native release build (no LAN Metro `hostUri`) with a missing/invalid
 *     APP_ENV or a mismatched EXPO_PUBLIC_BACKEND_URL throws at import time.
 *     This is intentional. We prefer a crash-on-launch over silently talking
 *     to the wrong backend/database.
 * =============================================================================
 */
import Constants from 'expo-constants';

export type AppEnv = 'development' | 'staging' | 'production';

/** Canonical production API — the one the App Store production build must hit. */
export const PRODUCTION_URL = 'https://parlourpilot.com';

/** Canonical staging API — the one TestFlight / staging must hit. */
export const STAGING_URL = 'https://staff-portal-331.preview.emergentagent.com';

/** Host patterns that must never resolve as a canonical backend. */
const FORBIDDEN_HOST_PATTERNS: RegExp[] = [
  /salon-invoice-app\.emergent\.host/i,
  /salon-invoice-app\.[^/]*emergentagent\.com/i,
];

function isForbidden(u: string): boolean {
  return FORBIDDEN_HOST_PATTERNS.some((re) => re.test(u));
}

function detectLocalMetro(): boolean {
  const hostUri = String(Constants.expoConfig?.hostUri || '');
  return /^(192\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)/.test(hostUri);
}

function normaliseUrl(u: string | undefined): string | null {
  if (!u) return null;
  const trimmed = u.trim().replace(/\/+$/, '');
  return trimmed || null;
}

interface ResolvedEnv {
  appEnv: AppEnv;
  backendUrl: string;
  /** True when we accepted a fallback for local Metro / developer convenience. */
  isDevFallback: boolean;
}

function readRawAppEnv(): string | undefined {
  return (
    (process.env.EXPO_PUBLIC_APP_ENV as string | undefined) ||
    (Constants.expoConfig?.extra as any)?.appEnv
  );
}

/**
 * Resolve APP_ENV + backend URL, fail loud on misconfiguration.
 * Called once at module load — the result is cached in `RESOLVED`.
 */
function resolve(): ResolvedEnv {
  const raw = (readRawAppEnv() || '').trim().toLowerCase();
  const isLocalMetro = detectLocalMetro();
  const envBackend = normaliseUrl(process.env.EXPO_PUBLIC_BACKEND_URL);
  const override = normaliseUrl(process.env.EXPO_PUBLIC_BACKEND_URL_OVERRIDE);

  // ----- 1. Determine APP_ENV -----
  let appEnv: AppEnv;
  if (raw === 'production' || raw === 'staging' || raw === 'development') {
    appEnv = raw;
  } else if (isLocalMetro) {
    // Local Metro dev with no APP_ENV set → default to development.
    appEnv = 'development';
  } else {
    // Native / release build without APP_ENV baked in — refuse to boot.
    throw new Error(
      '[ParlourPilot] EXPO_PUBLIC_APP_ENV is missing or invalid for a non-LAN ' +
        'build. Expected one of: development, staging, production. ' +
        'This is a build-configuration bug — set the env in eas.json for the ' +
        'matching build profile.',
    );
  }

  // ----- 2. Resolve backend URL per APP_ENV -----
  let backendUrl: string;
  let isDevFallback = false;

  if (appEnv === 'production') {
    // Production MUST hit PRODUCTION_URL. Any mismatch is treated as fatal.
    if (envBackend && envBackend !== PRODUCTION_URL) {
      throw new Error(
        `[ParlourPilot] Production build is misconfigured. EXPO_PUBLIC_BACKEND_URL='${envBackend}' ` +
          `but production must be '${PRODUCTION_URL}'. Refusing to boot to prevent ` +
          `production traffic from being routed to a wrong backend.`,
      );
    }
    if (override && override !== PRODUCTION_URL) {
      throw new Error(
        `[ParlourPilot] Production build cannot use EXPO_PUBLIC_BACKEND_URL_OVERRIDE='${override}'. ` +
          `Refusing to boot.`,
      );
    }
    backendUrl = PRODUCTION_URL;
  } else if (appEnv === 'staging') {
    // Staging MUST hit STAGING_URL. Any mismatch is treated as fatal.
    if (envBackend && envBackend !== STAGING_URL) {
      throw new Error(
        `[ParlourPilot] Staging/TestFlight build is misconfigured. ` +
          `EXPO_PUBLIC_BACKEND_URL='${envBackend}' but staging must be '${STAGING_URL}'. ` +
          `Refusing to boot to prevent TestFlight traffic from being routed to production.`,
      );
    }
    if (override && override !== STAGING_URL) {
      throw new Error(
        `[ParlourPilot] Staging build cannot use EXPO_PUBLIC_BACKEND_URL_OVERRIDE='${override}'. ` +
          `Refusing to boot.`,
      );
    }
    backendUrl = STAGING_URL;
  } else {
    // Development — allow LAN Metro flexibility, but never let the developer
    // accidentally reach production or the forbidden mobile pod.
    const candidates = [override, envBackend].filter(Boolean) as string[];
    const firstValid = candidates.find((c) => !isForbidden(c) && c !== PRODUCTION_URL);
    if (firstValid) {
      backendUrl = firstValid;
    } else {
      backendUrl = STAGING_URL;
      isDevFallback = true;
    }
    // A developer explicitly setting an override to production is allowed
    // only via an unambiguous marker — refuse the silent override.
    if (override === PRODUCTION_URL) {
      throw new Error(
        `[ParlourPilot] Development build refuses EXPO_PUBLIC_BACKEND_URL_OVERRIDE='${PRODUCTION_URL}'. ` +
          `If you truly need to hit production from a dev build, use the ` +
          `production EAS profile instead of an env override.`,
      );
    }
  }

  return { appEnv, backendUrl, isDevFallback };
}

// Resolve once at module load. Any misconfiguration will throw here and stop
// the app from booting — this is the fail-loud behaviour we want.
export const RESOLVED: ResolvedEnv = resolve();

export const APP_ENV: AppEnv = RESOLVED.appEnv;
export const BACKEND_URL: string = RESOLVED.backendUrl;
export const IS_PRODUCTION = APP_ENV === 'production';
export const IS_STAGING = APP_ENV === 'staging';
export const IS_DEVELOPMENT = APP_ENV === 'development';

// Human-readable label. Never rendered in the production build.
export const ENV_LABEL: string =
  APP_ENV === 'staging'
    ? 'STAGING'
    : APP_ENV === 'development'
      ? RESOLVED.isDevFallback
        ? 'DEV (staging fallback)'
        : 'DEV'
      : '';
