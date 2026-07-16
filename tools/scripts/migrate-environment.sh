#!/bin/bash
# =============================================================================
# Cross-Environment Data Migration Script
# =============================================================================
#
# Migrates data between environments (local → staging, staging → prod, etc.)
# Supports both Firestore and PostgreSQL backends.
#
# Usage:
#   ./migrate-environment.sh <source-env> <target-env> [options]
#
# Examples:
#   ./migrate-environment.sh local staging --firestore     # Firestore config migration
#   ./migrate-environment.sh local staging --postgres      # PostgreSQL data migration
#   ./migrate-environment.sh staging prod --dry-run        # Dry-run migration
#   ./migrate-environment.sh local staging --full          # Full migration (Firestore + PostgreSQL)
#
# Prerequisites:
#   - Source environment must be accessible (running locally or via gcloud auth)
#   - Target environment credentials must be configured
#   - Sufficient disk space for backup files
#
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Parse arguments
SOURCE_ENV="${1:-}"
TARGET_ENV="${2:-}"
shift 2 || true

# Options
DRY_RUN=false
FIRESTORE=false
POSTGRES=false
FULL=false
INCLUDE_SECRETS=false
COMPRESS=true
CLEANUP=true

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --firestore)
      FIRESTORE=true
      shift
      ;;
    --postgres)
      POSTGRES=true
      shift
      ;;
    --full)
      FULL=true
      FIRESTORE=true
      POSTGRES=true
      shift
      ;;
    --include-secrets)
      INCLUDE_SECRETS=true
      shift
      ;;
    --no-compress)
      COMPRESS=false
      shift
      ;;
    --no-cleanup)
      CLEANUP=false
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Validation
if [[ -z "$SOURCE_ENV" || -z "$TARGET_ENV" ]]; then
  echo -e "${RED}Error: Source and target environments are required${NC}"
  echo ""
  echo "Usage: $0 <source-env> <target-env> [options]"
  echo ""
  echo "Environments:"
  echo "  local    - Local Docker environment"
  echo "  staging  - Staging GCP environment"
  echo "  prod     - Production GCP environment"
  echo ""
  echo "Options:"
  echo "  --firestore         Migrate Firestore config collections"
  echo "  --postgres          Migrate PostgreSQL data"
  echo "  --full              Migrate both Firestore and PostgreSQL"
  echo "  --dry-run           Preview migration without applying changes"
  echo "  --include-secrets   Include sensitive collections in backup"
  echo "  --no-compress       Disable gzip compression"
  echo "  --no-cleanup        Keep backup files after migration"
  exit 1
fi

if [[ "$FIRESTORE" == "false" && "$POSTGRES" == "false" ]]; then
  echo -e "${RED}Error: Must specify --firestore, --postgres, or --full${NC}"
  exit 1
fi

# Helper functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

confirm_migration() {
  local source=$1
  local target=$2
  local type=$3

  echo ""
  echo "========================================="
  echo "MIGRATION SUMMARY"
  echo "========================================="
  echo "Source:      $source"
  echo "Target:      $target"
  echo "Type:        $type"
  echo "Dry Run:     $DRY_RUN"
  echo "Secrets:     $INCLUDE_SECRETS"
  echo "Compress:    $COMPRESS"
  echo "========================================="
  echo ""

  if [[ "$DRY_RUN" == "false" ]]; then
    read -p "Proceed with migration? (yes/no): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
      log_warn "Migration cancelled"
      exit 0
    fi
  fi
}

# Create backup directory
mkdir -p "$BACKUP_DIR"

# =============================================================================
# FIRESTORE MIGRATION
# =============================================================================
if [[ "$FIRESTORE" == "true" ]]; then
  log_info "Starting Firestore migration: $SOURCE_ENV → $TARGET_ENV"

  FIRESTORE_BACKUP="$BACKUP_DIR/firestore-$SOURCE_ENV-$TIMESTAMP.json"

  # Export from source
  log_info "Exporting Firestore config from $SOURCE_ENV..."

  EXPORT_CMD="npm run brat -- backup export --target $SOURCE_ENV --out $FIRESTORE_BACKUP"

  if [[ "$INCLUDE_SECRETS" == "true" ]]; then
    EXPORT_CMD="$EXPORT_CMD --include-secrets"
  fi

  if [[ "$COMPRESS" == "true" ]]; then
    EXPORT_CMD="$EXPORT_CMD --pretty"
  fi

  cd "$PROJECT_ROOT"
  eval "$EXPORT_CMD"

  if [[ ! -f "$FIRESTORE_BACKUP" ]]; then
    log_error "Export failed: backup file not found"
    exit 1
  fi

  log_success "Exported Firestore config to $FIRESTORE_BACKUP"

  # Import to target
  log_info "Importing Firestore config to $TARGET_ENV..."

  IMPORT_CMD="npm run brat -- backup import --in $FIRESTORE_BACKUP --target $TARGET_ENV --mode merge"

  if [[ "$INCLUDE_SECRETS" == "true" ]]; then
    IMPORT_CMD="$IMPORT_CMD --include-secrets"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    IMPORT_CMD="$IMPORT_CMD --dry-run"
  else
    IMPORT_CMD="$IMPORT_CMD --confirm"
  fi

  eval "$IMPORT_CMD"

  log_success "Firestore migration complete"

  # Cleanup
  if [[ "$CLEANUP" == "true" && "$DRY_RUN" == "false" ]]; then
    log_info "Cleaning up Firestore backup..."
    rm -f "$FIRESTORE_BACKUP"
  fi
fi

# =============================================================================
# POSTGRESQL MIGRATION
# =============================================================================
if [[ "$POSTGRES" == "true" ]]; then
  log_info "Starting PostgreSQL migration: $SOURCE_ENV → $TARGET_ENV"

  # Get source database URL
  case $SOURCE_ENV in
    local)
      SOURCE_DB_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
      ;;
    staging)
      SOURCE_DB_URL="${STAGING_DATABASE_URL:-}"
      if [[ -z "$SOURCE_DB_URL" ]]; then
        log_error "STAGING_DATABASE_URL environment variable not set"
        exit 1
      fi
      ;;
    prod)
      SOURCE_DB_URL="${PROD_DATABASE_URL:-}"
      if [[ -z "$SOURCE_DB_URL" ]]; then
        log_error "PROD_DATABASE_URL environment variable not set"
        exit 1
      fi
      ;;
    *)
      log_error "Unknown source environment: $SOURCE_ENV"
      exit 1
      ;;
  esac

  # Get target database URL
  case $TARGET_ENV in
    local)
      TARGET_DB_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
      ;;
    staging)
      TARGET_DB_URL="${STAGING_DATABASE_URL:-}"
      if [[ -z "$TARGET_DB_URL" ]]; then
        log_error "STAGING_DATABASE_URL environment variable not set"
        exit 1
      fi
      ;;
    prod)
      TARGET_DB_URL="${PROD_DATABASE_URL:-}"
      if [[ -z "$TARGET_DB_URL" ]]; then
        log_error "PROD_DATABASE_URL environment variable not set"
        exit 1
      fi
      ;;
    *)
      log_error "Unknown target environment: $TARGET_ENV"
      exit 1
      ;;
  esac

  POSTGRES_BACKUP="$BACKUP_DIR/postgres-$SOURCE_ENV-$TIMESTAMP.json"

  # Export from source
  log_info "Exporting PostgreSQL data from $SOURCE_ENV..."

  EXPORT_CMD="DATABASE_URL=$SOURCE_DB_URL npm run brat -- pg:backup --output $POSTGRES_BACKUP --format json"

  if [[ "$COMPRESS" == "true" ]]; then
    EXPORT_CMD="$EXPORT_CMD --compress"
    POSTGRES_BACKUP="${POSTGRES_BACKUP}.gz"
  fi

  cd "$PROJECT_ROOT"
  eval "$EXPORT_CMD"

  if [[ ! -f "$POSTGRES_BACKUP" ]]; then
    log_error "Export failed: backup file not found"
    exit 1
  fi

  log_success "Exported PostgreSQL data to $POSTGRES_BACKUP"

  # Import to target
  log_info "Importing PostgreSQL data to $TARGET_ENV..."

  IMPORT_CMD="DATABASE_URL=$TARGET_DB_URL npm run brat -- pg:restore --input $POSTGRES_BACKUP --mode merge"

  if [[ "$DRY_RUN" == "true" ]]; then
    IMPORT_CMD="$IMPORT_CMD --dry-run"
  fi

  eval "$IMPORT_CMD"

  log_success "PostgreSQL migration complete"

  # Cleanup
  if [[ "$CLEANUP" == "true" && "$DRY_RUN" == "false" ]]; then
    log_info "Cleaning up PostgreSQL backup..."
    rm -f "$POSTGRES_BACKUP"
  fi
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "========================================="
echo "MIGRATION COMPLETE"
echo "========================================="
if [[ "$DRY_RUN" == "true" ]]; then
  log_warn "This was a DRY RUN. No changes were applied."
  log_info "Remove --dry-run flag to apply changes."
else
  log_success "Data migrated from $SOURCE_ENV to $TARGET_ENV"
fi

if [[ "$CLEANUP" == "false" ]]; then
  log_info "Backup files retained in: $BACKUP_DIR"
fi

echo "========================================="
