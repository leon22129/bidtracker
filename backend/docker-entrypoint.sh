#!/bin/sh
# ---------------------------------------------------------------------------
# Backend container entrypoint.
#
# Responsibilities, in order:
#   1. make /data writable by the `node` user (host bind mounts arrive as root)
#   2. apply pending migrations with `prisma migrate deploy`
#   3. exec the server as an unprivileged user
#
# `migrate deploy` (not `migrate dev`) is deliberate: it only applies committed
# migration files, never generates new ones and never resets data. It is
# idempotent, so restarting the container is safe.
# ---------------------------------------------------------------------------
set -e

DATA_DIR="$(dirname "${DATABASE_URL#file:}")"
mkdir -p "$DATA_DIR"

# Only chown when needed — on a large database an unconditional recursive chown
# adds seconds to every boot.
if [ "$(stat -c '%U' "$DATA_DIR")" != "node" ]; then
  echo "[entrypoint] taking ownership of $DATA_DIR"
  chown -R node:node "$DATA_DIR"
fi

echo "[entrypoint] applying migrations to $DATABASE_URL"
su-exec node npx prisma migrate deploy

echo "[entrypoint] starting: $*"
exec su-exec node "$@"
