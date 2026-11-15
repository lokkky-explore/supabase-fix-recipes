#!/usr/bin/env bash
# Run every recipe against a real local Supabase (Docker + Supabase CLI), not PGlite.
# Usage, from the repo root: bash tests/real-supabase.sh [recipe-slug]
# Uses the CLI's default local ports and passwords. Leaves the stack running; stop it with
# `supabase stop --no-backup` from .real-supabase/.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK="$ROOT/.real-supabase"
HOST=127.0.0.1 PORT=${SUPABASE_DB_PORT:-54322}
SU="postgresql://supabase_admin:postgres@$HOST:$PORT"  # local Supabase default login, not a secret. pragma: allowlist secret

mkdir -p "$WORK" && cd "$WORK"
[ -d supabase ] || supabase init >/dev/null
supabase status >/dev/null 2>&1 || supabase start -x studio,imgproxy,vector,logflare,edge-runtime,supavisor >/dev/null
supabase --version | sed 's/^/supabase cli /'
psql "$SU/postgres" -qAt -c "select version()" | cut -d, -f1

# A frozen copy of the real database to clone per recipe. Copying needs no other sessions on
# "postgres", and the Supabase services reconnect at once, so block connections for the copy.
if [ -z "$(psql "$SU/template1" -qAt -c "select 1 from pg_database where datname='recipe_tpl'")" ]; then
  psql "$SU/template1" -qAt -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter database postgres with allow_connections false;
select pg_terminate_backend(pid) from pg_stat_activity where datname = 'postgres';
select pg_sleep(0.5);
create database recipe_tpl template postgres;
alter database postgres with allow_connections true;
SQL
fi

cd "$ROOT"
[ -d node_modules/pg ] || npm install --no-save pg >/dev/null
PG_ADMIN_URL="$SU/template1" PG_URL="postgresql://postgres:postgres@$HOST:$PORT/postgres" npm test --silent -- "$@"  # pragma: allowlist secret
