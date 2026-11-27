#!/usr/bin/env bash
# Deploy the Visbot portal to the IONOS server.
# Run from the project root:  ./deploy/deploy.sh
#
# Safe to run repeatedly. It never touches the server's .env, the uploaded
# photos it does not know about, or any other site's nginx configuration.
set -euo pipefail

SERVER="${VISBOT_SERVER:-root@212.227.237.46}"
REMOTE_DIR="/var/www/visbot"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf "\n\033[1;31m==>\033[0m %s\n" "$1"; }

cd "$LOCAL_DIR"

say "Checking the server is reachable"
ssh -o ConnectTimeout=10 "$SERVER" "echo connected as \$(whoami) on \$(hostname)"

say "Backing up the current deployment and the database"
ssh "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /var/backups/visbot
if [ -d /var/www/visbot ]; then
  tar czf "/var/backups/visbot/files-$STAMP.tar.gz" -C /var/www visbot 2>/dev/null || true
  echo "files backed up to /var/backups/visbot/files-$STAMP.tar.gz"
fi
if sudo -u postgres psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw visbot; then
  sudo -u postgres pg_dump visbot | gzip > "/var/backups/visbot/db-$STAMP.sql.gz"
  echo "database backed up to /var/backups/visbot/db-$STAMP.sql.gz"
fi
# Keep the ten most recent of each kind.
ls -1t /var/backups/visbot/files-*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm --
ls -1t /var/backups/visbot/db-*.sql.gz   2>/dev/null | tail -n +11 | xargs -r rm --
REMOTE

# Nothing on the server is removed by default. Photos uploaded through the admin
# panel live under /var/www/visbot/assets/ and are not in this tree, so a
# --delete would prune them. Pass VISBOT_PRUNE=1 to mirror exactly instead, and
# check what it would remove first:
#   VISBOT_PRUNE=1 ./deploy/deploy.sh --dry-run
RSYNC_OPTS="-avz"
DRY_RUN=no
if [ "${VISBOT_PRUNE:-0}" = "1" ]; then
  RSYNC_OPTS="$RSYNC_OPTS --delete"
  say "VISBOT_PRUNE=1: files on the server that are not in this folder WILL be removed"
fi
if [ "${1:-}" = "--dry-run" ]; then
  RSYNC_OPTS="$RSYNC_OPTS --dry-run --itemize-changes"
  DRY_RUN=yes
  say "Dry run: nothing will be written"
fi

say "Uploading the project"
ssh "$SERVER" "mkdir -p $REMOTE_DIR"
# Unquoted on purpose: these are separate options, none of which contains a space.
rsync $RSYNC_OPTS \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'server/.env' \
  --exclude '.DS_Store' \
  --exclude 'v2/' \
  ./ "$SERVER:$REMOTE_DIR/"

if [ "$DRY_RUN" = "yes" ]; then
  say "Dry run finished — the server was not changed"
  exit 0
fi

say "Installing dependencies and applying migrations"
ssh "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
cd /var/www/visbot/server

if [ ! -f .env ]; then
  echo "ERROR: /var/www/visbot/server/.env is missing."
  echo "Copy deploy/env.production.example there and fill in the secrets first."
  exit 1
fi

npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# A value out of a .env file. dotenv strips surrounding quotes, so this has to
# as well: a password containing a '#' has to be quoted in the file, and without
# this the quotes would arrive as part of the value.
envval() { grep -E "^$2=" "$1" | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"; }

# Schemas use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so this is
# safe on an existing database and never drops data.
DB_URL=$(envval .env DATABASE_URL)
# Order matters at the end: schema-users.sql adds the columns that point leads,
# notes and reviews at a user, and schema-states.sql points users and leads at a
# state, so both come after the tables they reach into.
# schema-referrals.sql comes last of all: it adds a column to leads that points
# at the referrers table it creates.
for f in schema.sql schema-leads.sql schema-meta.sql schema-service.sql schema-users.sql schema-states.sql schema-referrals.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  echo "applied $f"
done

chown -R www-data:www-data /var/www/visbot
chmod 600 .env
REMOTE

say "Restarting the three services"
ssh "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
systemctl restart visbot-website visbot-backend visbot-admin
sleep 2
for s in visbot-website visbot-backend visbot-admin; do
  printf "%-18s %s\n" "$s" "$(systemctl is-active $s)"
done
REMOTE

say "Health checks"
ssh "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$1"; }
echo "website  127.0.0.1:9000/index.html -> $(code http://127.0.0.1:9000/index.html)"
echo "backend  127.0.0.1:9001/api/health -> $(code http://127.0.0.1:9001/api/health)"
echo "admin    127.0.0.1:9002/admin/login -> $(code http://127.0.0.1:9002/admin/login)"
nginx -t
REMOTE

say "Done"
echo "  https://visbot.in"
echo "  https://admin.visbot.in"
echo "  https://backend.visbot.in/api/health"
