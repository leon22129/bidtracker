'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { parseTheme, THEME_STORAGE_KEY, type ResolvedTheme, type Theme } from './theme';

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setPreference] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
  const preference = useRef<Theme>('system');

  const applyTheme = useCallback((next: Theme) => {
    const resolved = next === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : next;
    preference.current = next;
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    setPreference(next);
    setResolvedTheme(resolved);
  }, []);

  useEffect(() => {
    let saved: Theme = 'system';
    try { saved = parseTheme(localStorage.getItem(THEME_STORAGE_KEY)); } catch {}
    applyTheme(saved);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (preference.current === 'system') applyTheme('system');
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === THEME_STORAGE_KEY || event.key === null)) {
        applyTheme(parseTheme(event.newValue));
      }
    };
    media.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [applyTheme]);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
  }, [applyTheme]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
