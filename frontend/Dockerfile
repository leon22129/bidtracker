# ---------------------------------------------------------------------------
# Frontend image — Next.js standalone
#
# `output: 'standalone'` (see next.config.mjs) makes Next emit a self-contained
# server bundle with only the node_modules it actually imports. The runtime image
# is ~140 MB rather than ~500 MB, which matters on a small VPS.
# ---------------------------------------------------------------------------

# ---- stage 1: dependencies --------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- stage 2: build ---------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* variables are inlined at build time, not read at runtime. The
# default (empty) makes the browser call /api/* on its own origin, which the
# rewrite in next.config.mjs forwards to the backend container. Only override
# this for a split-origin deployment.
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- stage 3: runtime -------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `standalone` bundles its own minimal server.js; `static` and `public` are not
# included in it and must be copied alongside.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER node
EXPOSE 3000

CMD ["node", "server.js"]
