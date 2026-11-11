import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';

const isDevelopment = process.env.NODE_ENV !== 'production';
const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the dev compiler isolated from `next build`. Sharing `.next` lets a
  // production build replace chunks underneath a running dev server.
  distDir: isDevelopment ? '.next-dev' : process.env.BIDTRACKER_RUNTIME_DIST_DIR || '.next',
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
          // main mitigation. Cloudflare injects its analytics beacon at the edge; allow only
          // that script host. Its automatically injected beacon reports to our own /cdn-cgi/rum.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // @react-pdf uses Yoga's WebAssembly build for document layout. The narrow
              // wasm-unsafe-eval source permits WASM compilation without enabling JavaScript eval.
              `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com${isDevelopment ? " 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' blob: data: https:",
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

export default function config(phase) {
  let deploymentId;
  if (phase === PHASE_PRODUCTION_BUILD) {
    // Next passes this ID to build workers. Use it for both the build and asset
    // query strings, so an unchanged chunk gets a fresh cache key on deployment.
    deploymentId = process.env.NEXT_DEPLOYMENT_ID || randomUUID();
  } else if (!isDevelopment) {
    deploymentId = readFileSync(path.join(frontendRoot, nextConfig.distDir, 'BUILD_ID'), 'utf8').trim();
  }
  return {
    ...nextConfig,
    deploymentId,
    generateBuildId: () => deploymentId || randomUUID(),
  };
}
