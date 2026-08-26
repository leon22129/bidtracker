# ---------------------------------------------------------------------------
# Backend image — NestJS + Prisma + SQLite
#
# Multi-stage so the runtime image carries no TypeScript compiler, no dev
# dependencies, and no source: ~180 MB instead of ~700 MB.
#
# Alpine is safe here only because every native-ish dependency was chosen to
# avoid node-gyp: bcryptjs is pure JS, and Prisma ships a linux-musl engine.
# ---------------------------------------------------------------------------

# ---- stage 1: install every dependency (incl. dev) and build ----------------
FROM node:20-alpine AS builder

WORKDIR /app

# openssl is required by the Prisma query engine.
RUN apk add --no-cache openssl

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

# The Prisma client must be generated before tsc runs — the build imports its types.
COPY prisma ./prisma
RUN npx prisma generate

# tsconfig.build.json is not optional: without it `nest build` falls back to tsconfig.json, whose
# `include` covers prisma/**, which widens rootDir and emits dist/src/main.js instead of dist/main.js.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Fail the build here rather than at container start: a wrong dist layout is otherwise only discovered
# when the entrypoint tries to run it, after the image has already been pushed.
RUN test -f dist/main.js || (echo "build produced no dist/main.js; layout is:" && find dist -name 'main.js' && exit 1)

# ---- stage 2: production dependencies only ---------------------------------
FROM node:20-alpine AS deps

WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# `prisma generate` must be re-run against the pruned tree, otherwise the
# client copied forward would reference dev-only paths.
COPY prisma ./prisma
RUN npx prisma generate

# ---- stage 3: runtime -------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# openssl for Prisma; su-exec to drop privileges after fixing volume ownership.
RUN apk add --no-cache openssl su-exec

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=file:/data/app.db

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# /data is the SQLite volume mount point. Creating it here (owned by node) means
# a fresh named volume inherits the right ownership.
RUN mkdir -p /data && chown -R node:node /data /app

EXPOSE 3001

# The entrypoint runs `prisma migrate deploy` and then drops to the `node` user.
# It starts as root only long enough to chown a host-bind-mounted /data.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
