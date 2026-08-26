import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Application-status palette from the spec. Kept as semantic names so the mapping lives in
        // one place and the JSX reads as intent rather than as a colour.
        status: {
          pending: '#6b7280',    // gray
          applied: '#16a34a',    // green
          rejected: '#111827',   // black
          duplicated: '#dc2626', // red
        },
      },
      fontSize: {
        // Dense grid needs a tighter scale than Tailwind's default.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        'sticky-col': '2px 0 4px -2px rgb(0 0 0 / 0.12)',
        'sticky-row': '0 2px 4px -2px rgb(0 0 0 / 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
