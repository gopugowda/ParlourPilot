/**
 * Dynamic Expo config — extends `app.json` so we can vary the backend URL
 * between preview and production builds.
 *
 * Resolution order for the API base URL (highest wins):
 *   1. `EXPO_PUBLIC_BACKEND_URL_OVERRIDE`  — one-off dev override
 *   2. `APP_ENV === 'production'`          — Emergent Publish / any EAS prod build
 *      → `https://parlourpilot.com`
 *   3. `EAS_BUILD_PROFILE === 'production'` (auto-set by EAS on prod builds)
 *      → `https://parlourpilot.com`
 *   4. `EXPO_PUBLIC_BACKEND_URL`           — from .env (preview default)
 *   5. Hardcoded preview fallback
 *
 * The resolved URL is exposed to the app at runtime as
 *   `Constants.expoConfig.extra.backendUrl`
 * and is read by `src/api/client.ts` (`process.env.EXPO_PUBLIC_BACKEND_URL`
 * remains the primary path so dev-time `expo start` still works exactly as before).
 */
import type { ExpoConfig, ConfigContext } from '@expo/config';

const PRODUCTION_URL = 'https://parlourpilot.com';
const PREVIEW_URL = 'https://staff-portal-331.preview.emergentagent.com';

function resolveBackendUrl(): string {
  const override = process.env.EXPO_PUBLIC_BACKEND_URL_OVERRIDE;
  if (override && override.trim()) return override.trim();

  const appEnv = (process.env.APP_ENV || '').toLowerCase();
  const easProfile = (process.env.EAS_BUILD_PROFILE || '').toLowerCase();
  if (appEnv === 'production' || easProfile === 'production') return PRODUCTION_URL;

  const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  return PREVIEW_URL;
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
