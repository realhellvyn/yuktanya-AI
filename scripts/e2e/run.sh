#!/usr/bin/env bash
# E2E browser lokal tanpa Docker. Pakai: bash scripts/e2e/run.sh   (SHOTS_DIR=... untuk tangkapan layar)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
exec bash scripts/db/with-test-db.sh node tests/e2e/run.mjs
