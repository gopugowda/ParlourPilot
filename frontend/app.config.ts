/**
 * Dynamic Expo config — extends `app.json` so we can vary the backend URL
 * between dev / preview / production builds.
 *
 * Resolution order (highest wins):
 *   1. `EXPO_PUBLIC_BACKEND_URL_OVERRIDE`  — one-off dev override
 *   2. `NODE_ENV === 'development'`        — set automatically by `expo start`
 *      → whatever `EXPO_PUBLIC_BACKEND_URL` says in .env (staff-portal preview)
 *      → falls back to PREVIEW_URL if that's empty
 *   3. Anything else (Emergent Publish / EAS production build)
 *      → PRODUCTION_URL (`https://parlourpilot.com`)
 *
 * Rationale: Emergent Publish doesn't guarantee `APP_ENV=production` gets set,
 * so we can't rely on it. Instead we default to PRODUCTION and only opt into
 * PREVIEW during local dev, when Metro sets `NODE_ENV=development` for us.
 *
 * The resolved URL is exposed at runtime as `Constants.expoConfig.extra.backendUrl`
 * and read by `src/api/client.ts`.
 */
import type { ExpoConfig, ConfigContext } from '@expo/config';

const PRODUCTION_URL = 'https://parlourpilot.com';
const PREVIEW_URL = 'https://staff-portal-331.preview.emergentagent.com';

function resolveBackendUrl(): string {
  const override = process.env.EXPO_PUBLIC_BACKEND_URL_OVERRIDE;
  if (override && override.trim()) return override.trim();

  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const appEnv = (process.env.APP_ENV || '').toLowerCase();

  // Explicit dev signals → use preview URL (respecting .env if provided).
  if (nodeEnv === 'development' || appEnv === 'development') {
    const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL;
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
    return PREVIEW_URL;
  }

  // Any other case (Emergent Publish, EAS prod, no env at all) → PRODUCTION.
  // This is the safe default for the deployed app.
  return PRODUCTION_URL;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const backendUrl = resolveBackendUrl();
  return {
    ...config,
    name: config.name || 'ParlourPilot',
    slug: config.slug || 'parlourpilot',
    extra: {
      ...(config.extra || {}),
      backendUrl,
      apiUrl: backendUrl, // alias for readability at the call site
    },
  };
};
