import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi, tokenStore, userStore } from '../api/client';

type User = { id: string; name: string; email: string; role: 'admin' | 'staff' };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({} as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Ensure seed exists on first launch
        try { await authApi.seed(); } catch {}
        const token = await tokenStore.get();
        if (token) {
          try {
            const u = await authApi.me();
            setUser(u);
          } catch {
            await tokenStore.clear();
            await userStore.clear();
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res: any = await authApi.login(email, password);
    await tokenStore.set(res.token);
    await userStore.set(res.user);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await tokenStore.clear();
    await userStore.clear();
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
