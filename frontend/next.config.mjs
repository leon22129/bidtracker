const isDevelopment = process.env.NODE_ENV !== 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `standalone` produces a self-contained server bundle, which keeps the runtime Docker image small
  // (no node_modules copy) — meaningful on a free VPS.
  output: 'standalone',
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },

  // The `/api/*` proxy deliberately lives in src/app/api/[...path]/route.ts and NOT in a `rewrites()`
  // entry here: rewrites are serialised into the build manifest, so BACKEND_INTERNAL_URL would be
  // frozen to whatever it was at image-build time. See that file for the full explanation.

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The JWT lives in localStorage, so XSS is the threat that matters most. This CSP is the
          // main mitigation: no inline scripts beyond Next's own hydration needs, no foreign origins.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "connect-src 'self'",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
