/**
 * Same-origin API proxy.
 *
 * The browser always calls `/api/*` on its own origin and this handler forwards to the backend
 * container. That gives us: no CORS in production, no CSP exception for a second host, and a
 * Cloudflare Tunnel that only needs to expose ONE hostname — the deployment target in the spec.
 *
 * Why a route handler instead of the obvious `rewrites()` entry in next.config:
 * `next.config` rewrites are evaluated at BUILD time and serialised into `.next/routes-manifest.json`.
 * `BACKEND_INTERNAL_URL` is not known while the image is being built, so the manifest baked in the
 * `http://localhost:3001` fallback and every `/api/*` request in the container failed with
 * ECONNREFUSED even though the variable was correctly set at runtime. Pinning `runtime = 'nodejs'`
 * and reading `process.env` per request is what makes the same image redeployable against a different
 * backend host without a rebuild.
 */
import { NextRequest } from 'next/server';

// Explicit: the edge runtime would reintroduce the build-time environment-inlining problem above.
export const runtime = 'nodejs';
// The import feature uploads spreadsheets, so responses and request bodies must never be buffered
// into a static optimisation.
export const dynamic = 'force-dynamic';

const backendUrl = () => process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:3001';

/**
 * Headers that describe a single hop rather than the payload. Forwarding them corrupts the proxied
 * exchange: `host` misroutes vhosts, and the length/encoding trio no longer matches the body once
 * fetch has re-framed or decompressed it.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'content-encoding',
]);

async function proxy(req: NextRequest) {
  const incoming = new URL(req.url);
  const target = new URL(incoming.pathname + incoming.search, backendUrl());

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  // Ask for an identity response: fetch would transparently decompress it, after which a forwarded
  // `content-encoding` header would describe a body that is no longer encoded.
  headers.set('accept-encoding', 'identity');

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // Required by undici when the body is a stream: we finish sending before reading the response.
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      cache: 'no-store',
    } as RequestInit);
  } catch {
    // The API being down is an infrastructure fault, not a client error, and 502 is what a reverse
    // proxy is expected to say. A 500 here would look like an application bug.
    return new Response(JSON.stringify({ statusCode: 502, message: 'The API is unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) responseHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
