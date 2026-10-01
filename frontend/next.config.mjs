import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isDevelopment = process.env.NODE_ENV !== 'production';
const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the dev compiler isolated from `next build`. Sharing `.next` lets a
  // production build replace chunks underneath a running dev server.
  distDir: isDevelopment ? '.next-dev' : '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias['@react-pdf/renderer'] = path.join(
      frontendRoot,
      'node_modules/@react-pdf/renderer',
    );
    return config;
  },

  // The `/api/*` proxy deliberately lives in src/app/api/[...path]/route.ts and NOT in a `rewrites()`
  // entry here so BACKEND_URL can be changed when the server starts without rebuilding the frontend.

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
