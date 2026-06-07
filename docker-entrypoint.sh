#!/bin/sh
set -e

# Ensure the SQLite schema exists on the mounted volume (idempotent).
prisma db push --schema=./prisma/schema.prisma --skip-generate

# Any run that was in progress when the machine last stopped is orphaned —
# mark it failed so the UI/guard doesn't think a run is still going.
echo "UPDATE RunLog SET status='failed', message='中斷（伺服器重啟）', finishedAt=CURRENT_TIMESTAMP WHERE status='running';" \
  | prisma db execute --schema=./prisma/schema.prisma --stdin || true

# Start the Next.js standalone server.
exec node server.js
