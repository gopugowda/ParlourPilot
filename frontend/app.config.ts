/**
 * Dynamic Expo config — resolves `extra.appEnv` and `extra.backendUrl` at
 * build/serve time so the runtime resolver in `src/lib/appEnv.ts` has a
 * deterministic value even when `process.env.EXPO_PUBLIC_*` is not accessible
 * (e.g. Expo Go published bundles).
 *
 * Contract (must remain in sync with `src/lib/appEnv.ts`):
 *   APP_ENV ∈ { development, staging, production }
 *   production → https://parlourpilot.com
 *   staging    → https://staff-portal-331.preview.emergentagent.com
 *   development → EXPO_PUBLIC_BACKEND_URL, else staging fallback
 *
 * Any mismatch at runtime causes `src/lib/appEnv.ts` to throw — the config
 * here is intentionally permissive (it just seeds `extra`); the runtime
 * validator is the fail-loud enforcement point.
 */
import type { ExpoConfig, ConfigContext } from '@expo/config';

const PRODUCTION_URL = 'https://parlourpilot.com';
const STAGING_URL = 'https://staff-portal-331.preview.emergentagent.com';

type AppEnv = 'development' | 'staging' | 'production';

function resolveAppEnv(): AppEnv {
  const raw = (process.env.EXPO_PUBLIC_APP_ENV || '').trim().toLowerCase();
  if (raw === 'production' || raw === 'staging' || raw === 'development') return raw;
  // Default for local Metro dev when nothing is set.
  return 'development';
}

function resolveBackendUrl(appEnv: AppEnv): string {
  if (appEnv === 'production') return PRODUCTION_URL;
  if (appEnv === 'staging') return STAGING_URL;

  // Dev: prefer explicit env, else staging fallback (never production).
  const envUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && envUrl !== PRODUCTION_URL) return envUrl;
  return STAGING_URL;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = resolveAppEnv();
  const backendUrl = resolveBackendUrl(appEnv);
  return {
    ...config,
    name: config.name || 'ParlourPilot',
    slug: config.slug || 'parlourpilot',
    extra: {
      ...(config.extra || {}),
      appEnv,
      backendUrl,
      apiUrl: backendUrl, // alias for readability at the call site
    },
  };
};
