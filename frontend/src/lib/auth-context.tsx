'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionGeneration = useRef(0);
  const router = useRouter();

  const refresh = useCallback(async () => {
    const generation = ++sessionGeneration.current;
    const token = tokenStore.get();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const currentUser = await api.me();
      if (generation === sessionGeneration.current && tokenStore.get() === token) setUser(currentUser);
    } catch {
      // api.ts already cleared the token and redirected on a 401.
      if (generation === sessionGeneration.current && (!tokenStore.get() || tokenStore.get() === token)) setUser(null);
    } finally {
      if (generation === sessionGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const generation = ++sessionGeneration.current;
    try {
      const { access_token, user: loggedIn } = await api.login(email, password);
      if (generation !== sessionGeneration.current) return;
      tokenStore.set(access_token);
      setUser(loggedIn);
    } finally {
      if (generation === sessionGeneration.current) setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    sessionGeneration.current++;
    tokenStore.clear();
    setUser(null);
    setLoading(false);
    router.push('/login');
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
