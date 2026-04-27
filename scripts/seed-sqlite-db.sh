#!/usr/bin/env bash
# Ensure a SQLite database has the Flowlib schema by running
# the flattened Drizzle migration. Safe to re-run (CREATE TABLE
# uses IF NOT EXISTS... wait, Drizzle migrations don't. So we
# check if tables exist first.)
set -e

DB_PATH="$1"
MIGRATION_SQL="$(dirname "$0")/../pkg/core/drizzle/sqlite/0000_goofy_marrow.sql"

if [ -z "$DB_PATH" ]; then
  echo "Usage: $0 <path-to-sqlite-db>"
  exit 1
fi

if [ ! -f "$MIGRATION_SQL" ]; then
  echo "Migration SQL not found at $MIGRATION_SQL"
  exit 1
fi

# Check if tables already exist (flows is a core table)
TABLE_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='flows';" 2>/dev/null || echo "0")

if [ "$TABLE_COUNT" = "0" ]; then
  echo "Creating Flowlib schema in $DB_PATH..."
  # Filter out Drizzle's --> statement-breakpoint markers and run SQL
  grep -v '^\-\->' "$MIGRATION_SQL" | sqlite3 "$DB_PATH"
  echo "Done."
else
  echo "Schema already exists in $DB_PATH, skipping."
fi
