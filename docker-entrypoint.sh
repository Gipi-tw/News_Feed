#!/bin/sh
set -e

# Ensure the SQLite schema exists on the mounted volume (idempotent).
prisma db push --schema=./prisma/schema.prisma --skip-generate

# Start the Next.js standalone server.
exec node server.js
