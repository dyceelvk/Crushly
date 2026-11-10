#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# A throwaway PostgreSQL for validating the relationship cutover.
#
# Production runs PostgreSQL 17; the cutover candidate is only worth shipping if
# it applies to the same schema production has. This script builds that schema
# from supabase/migrations + seed.sql, applies the candidate, and runs the
# redesign suites against it.
#
#   scripts/validate-cutover.sh            # full report
#   scripts/validate-cutover.sh minimal    # just apply + the three suites
#
# Nothing here touches a real project: the database lives in /var/lib and is
# dropped at the start of every run.
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN=/usr/lib/postgresql/17/bin
DATA=${HOLUP_PGDATA:-/tmp/holup-pgdata}
PSQL="$PGBIN/psql"
DB=cutover_check
MODE="${1:-full}"

say() { printf '\n== %s\n' "$*"; }

if [ ! -x "$PGBIN/initdb" ]; then
  say "installing PostgreSQL 17"
  sudo apt-get install -y -q postgresql postgresql-contrib >/tmp/pg-install.log 2>&1
fi

say "starting a scratch server"
mkdir -p "$DATA"
if [ ! -f "$DATA/PG_VERSION" ]; then
  "$PGBIN/initdb" -D "$DATA" -A trust -U postgres >/tmp/initdb.log 2>&1
fi
"$PGBIN/pg_ctl" -D "$DATA" -l /tmp/pg.log \
  -o "-p 5432 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" start >/dev/null 2>&1 || true
sleep 1
"$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -c 'select 1' >/dev/null

say "building the deployed schema (migrations + seed)"
"$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -c "drop database if exists $DB with (force);" -c "create database $DB;"
"$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  # Corrections that presuppose the relationship cutover are skipped on a fresh
  # build: the candidate below already contains the corrected rules.
  if head -1 "$f" | grep -q 'REQUIRES: relationship_cutover'; then continue; fi
  "$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 \
    || { echo "migration failed: $(basename "$f")"; exit 1; }
done
"$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed.sql" >/dev/null
"$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$DB" -c "update public.holup_features set enabled=true where key='calls'" >/dev/null

say "applying the cutover candidate (one transaction)"
"$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/follow-redesign-work/04a_homies_migration_fixture.sql" >/dev/null
"$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/follow-redesign-work/10_cutover_candidate.sql" 2>&1 | grep -E "ERROR" && exit 1
echo "applied"

say "relationship suites"
for f in 02_follow_test.sql 05_homies_test.sql 08_whisper_test.sql 12_whisper_request_thread.sql; do
  printf '%-34s ' "$f"
  out=$("$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/follow-redesign-work/$f" 2>&1)
  if echo "$out" | grep -q ERROR; then echo "FAIL: $(echo "$out" | grep ERROR | head -1 | cut -c1-100)"; else echo ok; fi
done

if [ "$MODE" = minimal ]; then exit 0; fi

if [ "$MODE" = each ]; then
  say "every legacy suite on its own fresh database"
  pass=0; fail=0; failed=""
  build() {
    # `local f` matters: without it the loop variable leaks and the caller runs
    # the last migration instead of the test file, which reports every suite as
    # passing. That bug cost an hour once; it is not coming back.
    local db="$1" f
    "$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -c "drop database if exists $db with (force);" -c "create database $db;" >/dev/null
    "$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$db" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/stubs.sql" >/dev/null 2>&1
    for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
      # A migration marked REQUIRES: relationship_cutover corrects a database that
      # already has the relationship objects. A fresh build gets those rules from
      # the cutover candidate below, so replaying the correction first would fail
      # on a table that does not exist yet.
      if head -1 "$f" | grep -q 'REQUIRES: relationship_cutover'; then continue; fi
      "$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$db" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || return 1
    done
    "$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$db" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed.sql" >/dev/null 2>&1
    "$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$db" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/follow-redesign-work/04a_homies_migration_fixture.sql" >/dev/null 2>&1
    "$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$db" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/follow-redesign-work/10_cutover_candidate.sql" >/tmp/cutover-apply.log 2>&1 || return 1
  }
  for f in $(ls "$ROOT"/supabase/tests/*.sql | sort); do
    name=$(basename "$f")
    case "$name" in stubs.sql) continue;; esac
    if ! build eachdb; then echo "$name BUILD-FAIL: $(grep -m1 ERROR /tmp/cutover-apply.log 2>/dev/null | cut -c1-90)"; continue; fi
    out=$("$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d eachdb -v ON_ERROR_STOP=1 -f "$f" 2>&1) || true
    if printf '%s' "$out" | grep -q 'ERROR'; then
      fail=$((fail + 1)); failed="$failed $name"
      printf '%-28s FAIL  %s\n' "$name" "$(printf '%s' "$out" | grep -m1 ERROR | cut -c1-90)"
    else
      pass=$((pass + 1)); printf '%-28s ok\n' "$name"
    fi
  done
  "$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -c "drop database if exists eachdb with (force);" >/dev/null 2>&1
  echo
  echo "pass=$pass fail=$fail"
  echo "failing:$failed"
  exit 0
fi

say "legacy suites that should NOT depend on the old relationship contract"
pass=0; fail=0; failed=""
for f in $(ls "$ROOT"/supabase/tests/*.sql | sort); do
  case "$(basename "$f")" in stubs.sql) continue;; esac
  out=$("$PSQL" -h 127.0.0.1 -U postgres -q -p 5432 -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1)
  if printf '%s' "$out" | grep -q 'ERROR'; then
    fail=$((fail + 1)); failed="$failed $(basename "$f")"
  else
    pass=$((pass + 1))
  fi
done
echo "pass=$pass fail=$fail"
echo "failing:$failed"
