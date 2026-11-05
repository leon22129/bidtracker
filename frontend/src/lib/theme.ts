export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<Theme, 'system'>;

export const THEME_STORAGE_KEY = 'bidtracker_theme';

export function parseTheme(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

// Run in <head> before the page paints, including when React has not loaded yet.
// Storage can be unavailable in private or restricted browsing; system mode still works.
export const THEME_INIT_SCRIPT = `(() => {
  let theme = 'system';
  try { theme = localStorage.getItem('${THEME_STORAGE_KEY}') || 'system'; } catch {}
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();`;
