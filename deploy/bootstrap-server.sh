#!/usr/bin/env bash
# One-time server preparation for the Visbot portal.
# Copy to the server and run as root:
#   scp deploy/bootstrap-server.sh root@212.227.237.46:/root/
#   ssh root@212.227.237.46 'bash /root/bootstrap-server.sh'
#
# Installs Node.js and PostgreSQL if missing, creates the database and role,
# installs the three systemd services and the nginx site. It only adds the
# visbot.in nginx file — other sites on this server are left alone.
set -euo pipefail

say() { printf "\n\033[1;31m==>\033[0m %s\n" "$1"; }

if [ "$(id -u)" -ne 0 ]; then echo "Run as root."; exit 1; fi

say "Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Installing Node.js 22 from NodeSource (the app needs 20 or newer)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

say "PostgreSQL"
if ! command -v psql >/dev/null 2>&1; then
  apt-get update
  apt-get install -y postgresql postgresql-contrib
fi
systemctl enable --now postgresql
sudo -u postgres psql -c "SELECT version();" | head -1

say "Database and role"
DB_PASS="${VISBOT_DB_PASSWORD:-$(openssl rand -base64 24)}"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='visbot'" | grep -q 1; then
  echo "role 'visbot' already exists — leaving its password unchanged"
else
  sudo -u postgres psql -c "CREATE ROLE visbot LOGIN PASSWORD '${DB_PASS}';"
  echo
  echo "  *** Database password (put this in server/.env DATABASE_URL) ***"
  echo "  ${DB_PASS}"
  echo
fi
if sudo -u postgres psql -lqt | cut -d'|' -f1 | grep -qw visbot; then
  echo "database 'visbot' already exists"
else
  sudo -u postgres createdb -O visbot visbot
  echo "database 'visbot' created"
fi

say "Directories"
mkdir -p /var/www/visbot /var/backups/visbot
chown -R www-data:www-data /var/www/visbot

say "Next steps (not automated, they need your files and secrets)"
cat <<'STEPS'
  1. On your Mac:  ./deploy/deploy.sh      (uploads the project)
     It will stop and tell you if server/.env is missing.

  2. Create the env file on the server:
       cp /var/www/visbot/deploy/env.production.example /var/www/visbot/server/.env
       nano /var/www/visbot/server/.env
     Fill in DATABASE_URL (with the password above), ADMIN_PASSWORD and
     SESSION_SECRET, then: chmod 600 /var/www/visbot/server/.env
     Re-run ./deploy/deploy.sh from your Mac so the services start.

  3. Install the services and the nginx site:
       cd /var/www/visbot
       cp deploy/systemd/visbot-*.service /etc/systemd/system/
       mkdir -p /etc/nginx/snippets
       cp deploy/nginx/visbot-proxy.conf /etc/nginx/snippets/
       cp deploy/nginx/visbot.in.conf /etc/nginx/sites-available/
       ln -sf /etc/nginx/sites-available/visbot.in.conf /etc/nginx/sites-enabled/
       systemctl daemon-reload
       systemctl enable --now visbot-website visbot-backend visbot-admin
       nginx -t && systemctl reload nginx

  4. Seed the catalogue once (22 products, 13 spares, contacts):
       cd /var/www/visbot/server && node seed.js

  5. Certificates — only after backend.visbot.in has an A record:
       certbot --nginx -d visbot.in -d www.visbot.in -d admin.visbot.in -d backend.visbot.in
STEPS
