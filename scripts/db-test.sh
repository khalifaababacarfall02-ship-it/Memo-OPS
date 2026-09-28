#!/usr/bin/env bash
# Tests the database layer (supabase/migrations, supabase/seed.sql, supabase/tests) on a
# plain Postgres: no Docker, no Supabase CLI. scripts/sql/auth-stub.sql stands in for
# what Supabase provides (API roles, auth.users, auth.uid(), default privileges).
#
# Usage:
#   bash scripts/db-test.sh --local
#       Starts a throwaway cluster with the local Postgres binaries on port 55432
#       (as the postgres user when run as root), runs everything, removes the cluster.
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bash scripts/db-test.sh
#       Uses an existing server: creates two fresh databases on it and drops them at the
#       end. The role must be a superuser (roles and databases are created).
#
# Options:
#   --port N      port for --local (default: $PG_PORT or 55432)
#   --keep        keep the test database (and the --local cluster) for inspection
#   --quiet       per-file summary only, instead of every TAP line
#   --no-repeat   skip the second, fresh migration run (determinism check)
#
# Steps: auth stub -> migrations -> seed -> pgTAP tests. Then the stub, migrations and
# seed are applied to a second fresh database: both schemas must dump identically.
# Exit status is non-zero on any failure.
#
# Needs psql (+ initdb/pg_ctl for --local, pg_dump for the repeat check) from Postgres
# >= 15, the pg_trgm and unaccent extensions, and pgTAP: either installed on the server
# (Debian/Ubuntu package postgresql-16-pgtap) or its SQL files on this machine, which
# are then loaded directly (e.g. into a stock postgres service container). pg_prove
# (package libtap-parser-sourcehandler-pgtap-perl) is used when present; otherwise a
# built-in TAP check runs the files with psql.
# Environment: PG_BIN (directory of initdb/pg_ctl/psql), PGTAP_SQL (path to pgtap--X.sql),
# BXH_PG_TMPDIR (where --local puts its cluster).
#
# GitHub Actions (ubuntu-latest), either:
#   - run: sudo apt-get update && sudo apt-get install -y postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl
#   - run: bash scripts/db-test.sh --local
# or, with a `postgres:16` service on port 5432 and the same packages on the runner:
#   - run: bash scripts/db-test.sh
#     env: { DATABASE_URL: "postgres://postgres:postgres@localhost:5432/postgres" }
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUB="$ROOT/scripts/sql/auth-stub.sql"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seed.sql"
TESTS_DIR="$ROOT/supabase/tests"

MODE="url"
PORT="${PG_PORT:-55432}"
KEEP=0
VERBOSE=1
REPEAT=1

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \{0,1\}//'; }
die() { printf 'db-test: %s\n' "$*" >&2; exit 1; }
step() { printf '\n# == %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="local" ;;
    --port) PORT="${2:?--port needs a value}"; shift ;;
    --keep) KEEP=1 ;;
    --quiet) VERBOSE=0 ;;
    --no-repeat) REPEAT=0 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

# ---------- tools ----------

find_pg_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then
    printf '%s' "$PG_BIN"
    return
  fi
  local dir
  if command -v pg_config >/dev/null 2>&1; then
    dir="$(pg_config --bindir 2>/dev/null || true)"
    if [[ -x "$dir/initdb" ]]; then
      printf '%s' "$dir"
      return
    fi
  fi
  # Debian/Ubuntu keep the server binaries out of PATH: take the newest version.
  dir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "$dir" && -x "$dir/initdb" ]]; then
    printf '%s' "$dir"
    return
  fi
  dir="$(command -v initdb 2>/dev/null || true)"
  [[ -n "$dir" ]] && printf '%s' "$(dirname "$dir")"
}

PG_BIN="$(find_pg_bin)"
tool() {
  if [[ -n "$PG_BIN" && -x "$PG_BIN/$1" ]]; then
    printf '%s' "$PG_BIN/$1"
  elif command -v "$1" >/dev/null 2>&1; then
    command -v "$1"
  else
    die "$1 not found (set PG_BIN to the directory that contains it)"
  fi
}
PSQL="$(tool psql)"

# pgTAP's SQL, for servers that do not have the extension installed.
find_pgtap_sql() {
  if [[ -n "${PGTAP_SQL:-}" ]]; then
    printf '%s' "$PGTAP_SQL"
    return
  fi
  local dirs=() d f
  if command -v pg_config >/dev/null 2>&1; then
    dirs+=("$(pg_config --sharedir 2>/dev/null || true)/extension")
  fi
  dirs+=(/usr/share/postgresql/*/extension /usr/local/share/postgresql/extension /opt/homebrew/share/postgresql*/extension)
  # Install scripts are pgtap--<version>.sql; upgrade scripts name two versions.
  for d in "${dirs[@]}"; do
    for f in "$d"/pgtap--*.sql; do
      [[ -e "$f" ]] && printf '%s\n' "$f"
    done
  done | grep -E '/pgtap--[0-9.]+\.sql$' | sort -V | tail -n 1 || true
}

# ---------- connections ----------

# URL of database $2 on the server of URL $1 (URI or keyword/value form).
url_for_db() {
  local url="$1" name="$2"
  if [[ "$url" != *"://"* ]]; then
    printf '%s dbname=%s' "$url" "$name"
    return
  fi
  local query="" scheme rest authority
  if [[ "$url" == *\?* ]]; then
    query="?${url#*\?}"
    url="${url%%\?*}"
  fi
  scheme="${url%%://*}"
  rest="${url#*://}"
  authority="${rest%%/*}"
  printf '%s://%s/%s%s' "$scheme" "$authority" "$name" "$query"
}

psql_run() {
  local url="$1"
  shift
  PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning" \
    "$PSQL" -X -q -v ON_ERROR_STOP=1 -d "$url" "$@"
}

# ---------- server ----------

CLUSTER_DIR=""
DATABASES=""
ADMIN_URL=""

# Postgres refuses to run as root: then the cluster belongs to the postgres user.
as_pg() {
  if [[ $EUID -eq 0 ]]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

cleanup() {
  local rc=$? db
  if [[ $KEEP -eq 1 ]]; then
    printf '\n# kept databases:%s\n' "$DATABASES" >&2
    if [[ -n "$CLUSTER_DIR" ]]; then
      printf '# cluster %s on port %s; stop it with:\n#   %s%s -D %s stop\n' "$CLUSTER_DIR" "$PORT" \
        "$([[ $EUID -eq 0 ]] && printf 'runuser -u postgres -- ')" "$PG_BIN/pg_ctl" "$CLUSTER_DIR/data" >&2
    fi
    exit $rc
  fi
  if [[ -n "$CLUSTER_DIR" ]]; then
    as_pg "$PG_BIN/pg_ctl" -D "$CLUSTER_DIR/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$CLUSTER_DIR"
  elif [[ -n "$ADMIN_URL" ]]; then
    for db in $DATABASES; do
      psql_run "$ADMIN_URL" -c "drop database if exists \"$db\"" >/dev/null 2>&1 || true
    done
  fi
  exit $rc
}
trap cleanup EXIT

start_local_cluster() {
  local initdb pg_ctl base locale
  initdb="$(tool initdb)"
  PG_BIN="$(dirname "$initdb")"
  pg_ctl="$PG_BIN/pg_ctl"

  base="${BXH_PG_TMPDIR:-}"
  if [[ $EUID -eq 0 ]]; then
    id postgres >/dev/null 2>&1 || die "running as root needs a 'postgres' system user"
    command -v runuser >/dev/null 2>&1 || die "running as root needs runuser"
    # A directory the postgres user can reach (a root-only temp dir would not do).
    [[ -z "$base" && -d /var/lib/postgresql ]] && base=/var/lib/postgresql
  fi
  base="${base:-${TMPDIR:-/tmp}}"
  mkdir -p "$base"
  CLUSTER_DIR="$(mktemp -d "$base/bxh-db-test.XXXXXX")"
  if [[ $EUID -eq 0 ]]; then
    chown postgres: "$CLUSTER_DIR"
  fi

  # UTF-8 like Supabase; C.UTF-8 where the OS has it.
  locale="C"
  if locale -a 2>/dev/null | grep -qiE '^c\.utf-?8$'; then
    locale="C.UTF-8"
  fi

  step "starting a temporary Postgres $("$PG_BIN/postgres" --version | awk '{print $3}') on port $PORT"
  as_pg "$initdb" -D "$CLUSTER_DIR/data" -U postgres -A trust -E UTF8 --locale="$locale" \
    --no-sync >"$CLUSTER_DIR/initdb.log" 2>&1 || { cat "$CLUSTER_DIR/initdb.log" >&2; die "initdb failed"; }
  if ! as_pg "$pg_ctl" -D "$CLUSTER_DIR/data" -l "$CLUSTER_DIR/data/server.log" -w -t 60 \
    -o "-p $PORT -k $CLUSTER_DIR -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
    start >/dev/null; then
    cat "$CLUSTER_DIR/data/server.log" >&2 || true
    die "could not start Postgres on port $PORT (is it in use? try --port)"
  fi
  ADMIN_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
}

create_database() {
  local name="$1"
  psql_run "$ADMIN_URL" \
    -c "drop database if exists \"$name\"" \
    -c "create database \"$name\" template template0 encoding 'UTF8'"
  DATABASES="$DATABASES $name"
}

# Stub, then every migration in order (each in one transaction, like `supabase db push`),
# then the seed.
apply_schema() {
  local url="$1" f
  psql_run "$url" -f "$STUB"
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [[ -e "$f" ]] || die "no migrations in $MIGRATIONS_DIR"
    printf '# migration %s\n' "$(basename "$f")"
    psql_run "$url" --single-transaction -f "$f"
  done
  printf '# seed %s\n' "$(basename "$SEED")"
  psql_run "$url" -f "$SEED"
}

install_pgtap() {
  local url="$1" sql
  if psql_run "$url" -c "create extension if not exists pgtap with schema extensions" 2>/dev/null; then
    return
  fi
  sql="$(find_pgtap_sql)"
  [[ -n "$sql" && -f "$sql" ]] ||
    die "pgTAP is neither installed on the server nor found locally (install postgresql-16-pgtap or set PGTAP_SQL)"
  printf '# pgTAP not installed on the server: loading %s\n' "$sql"
  PGOPTIONS="-c search_path=extensions" psql_run "$url" -f "$sql" >/dev/null
}

# Schema dump without the per-run lines pg_dump >= 16.10 adds (\restrict <random key>).
dump_schema() {
  local url="$1"
  "$PG_DUMP" --schema-only -d "$url" | grep -vE '^\\(un)?restrict '
  # Seeded rows too (the timestamps differ between runs by design).
  "$PSQL" -X -q -At -d "$url" \
    -c "select 'domain ' || domain from private.allowed_email_domains order by 1" \
    -c "select 'bootstrap admin ' || email from private.bootstrap_admins order by 1"
}

# ---------- tests ----------

# pg_prove when available; otherwise psql + a strict TAP check per file.
run_tests() {
  local url="$1" files=("$TESTS_DIR"/*.sql)
  [[ -e "${files[0]}" ]] || die "no tests in $TESTS_DIR"
  if command -v pg_prove >/dev/null 2>&1; then
    # pg_prove splits its --dbname on "=", which breaks URLs with a query string: give it
    # a psql that already knows where to connect instead.
    local wrapper rc=0
    wrapper="$(mktemp "${TMPDIR:-/tmp}/bxh-psql.XXXXXX")"
    printf '#!/bin/sh\nexec "%s" --dbname "$BXH_TEST_DB_URL" "$@"\n' "$PSQL" >"$wrapper"
    chmod +x "$wrapper"
    local args=(--psql-bin "$wrapper" --failures)
    [[ $VERBOSE -eq 1 ]] && args+=(--verbose)
    BXH_TEST_DB_URL="$url" PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning" \
      pg_prove "${args[@]}" "${files[@]}" || rc=$?
    rm -f "$wrapper"
    return $rc
  fi
  printf '# pg_prove not found: checking TAP output with psql\n'
  local f out rc failed=0 total=0
  for f in "${files[@]}"; do
    rc=0
    out="$(PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning" \
      "$PSQL" -X --no-align --tuples-only --quiet --pset pager=off -v ON_ERROR_STOP=1 -d "$url" -f "$f" 2>&1)" || rc=$?
    [[ $VERBOSE -eq 1 ]] && printf '%s\n' "$out"
    local summary
    summary="$(printf '%s\n' "$out" | awk -v rc="$rc" '
      /^1\.\.[0-9]+$/ { plan = substr($0, 4) + 0 }
      /^ok [0-9]+/ { ok++ }
      /^not ok [0-9]+/ { notok++ }
      END {
        ran = ok + notok
        if (rc != 0 || plan == "" || notok > 0 || ran != plan) {
          printf "FAIL (psql exit %d, plan %s, ran %d, failed %d)", rc, (plan == "" ? "none" : plan), ran, notok
        } else {
          printf "ok (%d tests)", ran
        }
      }')"
    printf '%s .. %s\n' "$(basename "$f")" "$summary"
    if [[ "$summary" != ok* ]]; then
      failed=1
      [[ $VERBOSE -eq 0 ]] && printf '%s\n' "$out" | grep -E '^(not ok|#)|ERROR' >&2 || true
    else
      total=$((total + $(printf '%s' "$summary" | tr -dc '0-9')))
    fi
  done
  if [[ $failed -ne 0 ]]; then
    printf 'Result: FAIL\n'
    return 1
  fi
  printf 'All tests successful (%d).\nResult: PASS\n' "$total"
}

# ---------- main ----------

if [[ "$MODE" == "local" ]]; then
  start_local_cluster
else
  [[ -n "${DATABASE_URL:-}" ]] || die "set DATABASE_URL, or use --local (see --help)"
  ADMIN_URL="$DATABASE_URL"
fi
PG_DUMP=""
[[ $REPEAT -eq 1 ]] && PG_DUMP="$(tool pg_dump)"

RUN_ID="$$"
DB_A="bxh_memo_test_${RUN_ID}"
DB_B="bxh_memo_repeat_${RUN_ID}"
URL_A="$(url_for_db "$ADMIN_URL" "$DB_A")"
URL_B="$(url_for_db "$ADMIN_URL" "$DB_B")"
status=0

step "database $DB_A: auth stub, migrations, seed"
create_database "$DB_A"
apply_schema "$URL_A"

if [[ $REPEAT -eq 1 ]]; then
  step "database $DB_B: same again on a fresh database (determinism)"
  create_database "$DB_B"
  apply_schema "$URL_B"
  if diff -u <(dump_schema "$URL_A") <(dump_schema "$URL_B") >&2; then
    printf '# both databases dump identically\n'
  else
    printf '# FAIL: the two runs produced different schemas (diff above)\n'
    status=1
  fi
fi

step "pgTAP tests ($(basename "$TESTS_DIR"))"
install_pgtap "$URL_A"
run_tests "$URL_A" || status=1

exit $status
