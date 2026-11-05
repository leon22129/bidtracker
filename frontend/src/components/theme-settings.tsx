'use client';

import { useTheme } from '@/lib/theme-context';
import type { Theme } from '@/lib/theme';

const options: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <section className="card mt-5 p-4" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading" className="text-sm font-semibold">Appearance</h2>
      <p id="appearance-help" className="mt-1 text-2xs text-gray-500 dark:text-gray-400">
        Choose a theme for this browser. System follows your device’s appearance.
      </p>
      <fieldset className="mt-3 flex gap-2" aria-describedby="appearance-help">
        <legend className="sr-only">Color theme</legend>
        {options.map((option) => (
          <label key={option.value} className="relative flex-1 cursor-pointer">
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={theme === option.value}
              onChange={() => setTheme(option.value)}
              className="peer sr-only"
            />
            <span className="flex justify-center rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 peer-checked:border-gray-900 peer-checked:bg-gray-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 dark:border-gray-600 dark:text-gray-300 dark:peer-checked:border-gray-100 dark:peer-checked:bg-gray-100 dark:peer-checked:text-gray-900 dark:peer-focus-visible:ring-offset-gray-900">
              {option.label}
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
