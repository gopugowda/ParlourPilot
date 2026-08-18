/**
 * useFilterState — generic React hook that persists a screen's filter object
 * to AsyncStorage so it survives app relaunches.
 *
 * Usage:
 *   const { filters, setFilters, resetFilters, activeCount, isHydrated }
 *     = useFilterState('history', { dateFrom: null, paymentMode: null, staffId: null });
 *
 * Persistence key format: `pp:filters:<screen>`
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'pp:filters:';

type Primitive = string | number | boolean | null | undefined;
type FilterValue = Primitive | Primitive[];
export type FilterMap = Record<string, FilterValue>;

export function useFilterState<T extends FilterMap>(
  screen: string,
  defaults: T,
): {
  filters: T;
  setFilters: (patch: Partial<T>) => void;
  replaceFilters: (next: T) => void;
  resetFilters: () => void;
  activeCount: number;
  isHydrated: boolean;
} {
  const [filters, _setFilters] = useState<T>(defaults);
  const [isHydrated, setIsHydrated] = useState(false);
  const defaultsRef = useRef(defaults);
  const key = KEY_PREFIX + screen;

  // Hydrate from AsyncStorage once on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (alive && raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            _setFilters({ ...defaultsRef.current, ...parsed });
          }
        }
      } catch { /* ignore corrupt storage */ }
      if (alive) setIsHydrated(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist on every change (skip until hydration to avoid clobbering).
  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(key, JSON.stringify(filters)).catch(() => {});
  }, [key, filters, isHydrated]);

  const setFilters = useCallback((patch: Partial<T>) => {
    _setFilters(prev => ({ ...prev, ...patch }));
  }, []);

  const replaceFilters = useCallback((next: T) => {
    _setFilters(next);
  }, []);

  const resetFilters = useCallback(() => {
    _setFilters(defaultsRef.current);
  }, []);

  // Count entries that differ from defaults (used for badge).
  const activeCount = Object.keys(filters).reduce((n, k) => {
    const cur = (filters as FilterMap)[k];
    const def = (defaultsRef.current as FilterMap)[k];
    const differs = Array.isArray(cur)
      ? (cur.length > 0 && JSON.stringify(cur) !== JSON.stringify(def))
      : (cur != null && cur !== '' && cur !== def);
    return differs ? n + 1 : n;
  }, 0);

  return { filters, setFilters, replaceFilters, resetFilters, activeCount, isHydrated };
}
