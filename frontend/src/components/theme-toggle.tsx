'use client';

import { useTheme } from '@/lib/theme-context';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const label = `Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`;

  return (
    <button
      type="button"
      className="btn-secondary h-8 w-8 shrink-0 p-0"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label={label}
      title={label}
    >
      <svg className="hidden h-4 w-4 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </svg>
      <svg className="h-4 w-4 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
      </svg>
    </button>
  );
}
