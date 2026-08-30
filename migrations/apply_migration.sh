#!/bin/bash
# Apply database migration to PostgreSQL
# Usage: ./apply_migration.sh <migration_file> [environment]

set -e

MIGRATION_FILE="${1:-004_bidding_system_tables.sql}"
ENVIRONMENT="${2:-staging}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Get DATABASE_URL based on environment
get_database_url() {
  local env="$1"

  case "$env" in
    local)
      echo "${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/bitbrat}"
      ;;
    staging)
      # For staging, check if DATABASE_URL is set
      if [ -z "$DATABASE_URL" ]; then
        log_error "DATABASE_URL not set for staging environment"
        log_info "Please export DATABASE_URL or run via SSH:"
        log_info "  ssh root@bitbrat.lan 'psql \$DATABASE_URL -f -' < $MIGRATION_FILE"
        exit 1
      fi
      echo "$DATABASE_URL"
      ;;
    *)
      log_error "Unknown environment: $env"
      log_info "Supported: local, staging"
      exit 1
      ;;
  esac
}

# Verify migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
  log_error "Migration file not found: $MIGRATION_FILE"
  exit 1
fi

log_info "Applying migration: $MIGRATION_FILE"
log_info "Environment: $ENVIRONMENT"

# Get database URL
DB_URL=$(get_database_url "$ENVIRONMENT")

# Confirm before applying
log_warn "This will modify the database schema."
read -p "Continue? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
  log_info "Migration cancelled"
  exit 0
fi

# Apply migration
log_info "Applying migration..."
if psql "$DB_URL" -f "$MIGRATION_FILE"; then
  log_info "✓ Migration applied successfully"

  # Verify tables
  log_info "Verifying tables..."
  psql "$DB_URL" -c "\dt bid_*"

  log_info "✓ Migration complete"
else
  log_error "✗ Migration failed"
  exit 1
fi
