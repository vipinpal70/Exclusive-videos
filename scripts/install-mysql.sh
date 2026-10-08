#!/usr/bin/env bash
# Installs MySQL Server on a Linux host, runs it as a systemd service that starts on boot,
# and creates the app database + user.
#
# Usage (as root or via sudo):
#   sudo DB_PASS='a-strong-password' bash scripts/install-mysql.sh
#
# Optional env: DB_NAME (exclusive-vids), DB_USER (exclusive-vids), DB_HOST_ALLOWED (localhost),
#               BIND_ADDRESS (127.0.0.1; use 0.0.0.0 to accept remote connections)
set -euo pipefail

DB_NAME="${DB_NAME:-exclusive-vids}"
DB_USER="${DB_USER:-exclusive-vids}"
DB_PASS="${DB_PASS:-}"
DB_HOST_ALLOWED="${DB_HOST_ALLOWED:-localhost}"
BIND_ADDRESS="${BIND_ADDRESS:-127.0.0.1}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo DB_PASS=... bash $0" >&2
  exit 1
fi
if [[ -z "$DB_PASS" ]]; then
  echo "DB_PASS is required." >&2
  exit 1
fi
if [[ "$DB_PASS" == *"'"* || "$DB_PASS" == *"\\"* ]]; then
  echo "DB_PASS must not contain ' or \\ characters." >&2
  exit 1
fi

# 1. Install
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y mysql-server
  SERVICE=mysql
  CONF_DIR=/etc/mysql/mysql.conf.d
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y mysql-server
  SERVICE=mysqld
  CONF_DIR=/etc/my.cnf.d
elif command -v yum >/dev/null 2>&1; then
  yum install -y mysql-server
  SERVICE=mysqld
  CONF_DIR=/etc/my.cnf.d
else
  echo "Unsupported distro: need apt-get, dnf or yum." >&2
  exit 1
fi

# 2. Bind address
mkdir -p "$CONF_DIR"
cat > "$CONF_DIR/99-exclusive-vids.cnf" <<EOF
[mysqld]
bind-address = $BIND_ADDRESS
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
EOF

# 3. Enable on boot + (re)start, restarting automatically if it crashes
mkdir -p "/etc/systemd/system/$SERVICE.service.d"
cat > "/etc/systemd/system/$SERVICE.service.d/restart.conf" <<EOF
[Service]
Restart=always
RestartSec=5
EOF
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

# 4. Wait until it accepts connections
for _ in $(seq 1 30); do
  mysqladmin ping --silent 2>/dev/null && break
  sleep 1
done
mysqladmin ping --silent

# 5. Database + user (root uses socket auth, so no password is needed from root)
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'$DB_HOST_ALLOWED' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'$DB_HOST_ALLOWED' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'$DB_HOST_ALLOWED';
FLUSH PRIVILEGES;
SQL

echo
echo "MySQL is running (systemctl status $SERVICE) and enabled on boot."
echo "Put this in your app's .env.local:"
echo "  DB_HOST=127.0.0.1"
echo "  DB_PORT=3306"
echo "  DB_NAME=$DB_NAME"
echo "  DB_USER=$DB_USER"
echo "  DB_PASS=<the password you passed>"
echo "The app creates its schema automatically on first connection."
