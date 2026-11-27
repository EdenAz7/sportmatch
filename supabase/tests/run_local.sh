#!/bin/bash
# Recreate the local test DB, apply all migrations, run the scenario.
set -e
cd "$(dirname "$0")/.."
P="psql -h /tmp/pg -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists smtest" -c "create database smtest"
$P -d smtest -f tests/bootstrap_local.sql
for f in migrations/*.sql; do
  case "$f" in *cron*) continue;; esac
  $P -d smtest -f "$f"
done
psql -h /tmp/pg -p 5433 -U postgres -v ON_ERROR_STOP=1 -d smtest -f tests/scenario.sql
