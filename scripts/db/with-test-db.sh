#!/usr/bin/env bash
# Menyalakan klaster Postgres sementara, memuat stub auth + migrasi, menjalankan perintah
# dengan TEST_DATABASE_URL, lalu mematikan klaster. Gagal keras bila Postgres tidak ada.
set -euo pipefail

PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
if [ -z "${PGBIN:-}" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "with-test-db: binari server Postgres tidak ditemukan (butuh /usr/lib/postgresql/*/bin/initdb)." >&2
  exit 1
fi

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DIR=$(mktemp -d)
PORT=$((20000 + RANDOM % 20000))
RUN=""
if [ "$(id -u)" = "0" ]; then
  # initdb menolak berjalan sebagai root; jalankan sebagai user postgres.
  RUN="runuser -u postgres --"
  chown postgres:postgres "$DIR"
fi

cleanup() {
  $RUN "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

$RUN "$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DIR" \
  -l "$DIR/pg.log" -w start >/dev/null

PSQL="psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U postgres"
$PSQL -d postgres -c "create database yuktanya_test" >/dev/null
$PSQL -d yuktanya_test -f "$ROOT/tests/db/bootstrap.sql" >/dev/null
for f in "${MIGRATIONS_DIR:-$ROOT/supabase/migrations}"/*.sql; do
  [ -e "$f" ] || continue
  $PSQL -d yuktanya_test -f "$f" >/dev/null
done

export TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/yuktanya_test"
cd "$ROOT"
set +e
"$@"
rc=$?
set -e
exit $rc
