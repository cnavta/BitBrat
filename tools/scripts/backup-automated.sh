#!/bin/bash
# =============================================================================
# Automated Backup Script
# =============================================================================
#
# Automatically backs up both Firestore and PostgreSQL to timestamped files.
# Designed to run as a cron job for regular backups.
#
# Usage:
#   ./backup-automated.sh [environment] [options]
#
# Examples:
#   ./backup-automated.sh local                    # Backup local environment
#   ./backup-automated.sh staging --retention 7    # Backup staging, keep 7 days
#   ./backup-automated.sh prod --s3-upload         # Backup prod + upload to S3
#
# Cron Example (daily at 2am):
#   0 2 * * * /path/to/backup-automated.sh prod --retention 30 >> /var/log/bitbrat-backup.log 2>&1
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
DATE_ONLY=$(date +%Y%m%d)

# Parse arguments
ENVIRONMENT="${1:-local}"
shift || true

# Options
RETENTION_DAYS=30
S3_UPLOAD=false
S3_BUCKET="${S3_BUCKET:-}"
GCS_UPLOAD=false
GCS_BUCKET="${GCS_BUCKET:-}"
INCLUDE_SECRETS=false
COMPRESS=true
NOTIFY_EMAIL="${NOTIFY_EMAIL:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --retention)
      RETENTION_DAYS="$2"
      shift 2
      ;;
    --s3-upload)
      S3_UPLOAD=true
      shift
      ;;
    --s3-bucket)
      S3_BUCKET="$2"
      S3_UPLOAD=true
      shift 2
      ;;
    --gcs-upload)
      GCS_UPLOAD=true
      shift
      ;;
    --gcs-bucket)
      GCS_BUCKET="$2"
      GCS_UPLOAD=true
      shift 2
      ;;
    --include-secrets)
      INCLUDE_SECRETS=true
      shift
      ;;
    --no-compress)
      COMPRESS=false
      shift
      ;;
    --notify)
      NOTIFY_EMAIL="$2"
      shift 2
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Helper functions
log_info() {
  echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] [INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] [SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] [WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] [ERROR]${NC} $1"
}

send_notification() {
  local subject=$1
  local body=$2

  if [[ -n "$NOTIFY_EMAIL" ]]; then
    echo "$body" | mail -s "$subject" "$NOTIFY_EMAIL" || log_warn "Failed to send email notification"
  fi
}

# Create backup directory structure
BACKUP_ENV_DIR="$BACKUP_DIR/$ENVIRONMENT"
BACKUP_DATE_DIR="$BACKUP_ENV_DIR/$DATE_ONLY"
mkdir -p "$BACKUP_DATE_DIR"

log_info "Starting automated backup for environment: $ENVIRONMENT"
log_info "Backup directory: $BACKUP_DATE_DIR"

# =============================================================================
# BACKUP FIRESTORE
# =============================================================================
log_info "Backing up Firestore config..."

FIRESTORE_BACKUP="$BACKUP_DATE_DIR/firestore-$TIMESTAMP.json"

FIRESTORE_CMD="cd $PROJECT_ROOT && npm run brat -- backup export --target $ENVIRONMENT --out $FIRESTORE_BACKUP"

if [[ "$INCLUDE_SECRETS" == "true" ]]; then
  FIRESTORE_CMD="$FIRESTORE_CMD --include-secrets"
fi

if eval "$FIRESTORE_CMD"; then
  FIRESTORE_SIZE=$(du -h "$FIRESTORE_BACKUP" | cut -f1)
  log_success "Firestore backup complete: $FIRESTORE_BACKUP ($FIRESTORE_SIZE)"
else
  log_error "Firestore backup failed"
  send_notification "BitBrat Backup Failed" "Firestore backup failed for $ENVIRONMENT"
  exit 1
fi

# Compress if enabled
if [[ "$COMPRESS" == "true" ]]; then
  log_info "Compressing Firestore backup..."
  gzip -9 "$FIRESTORE_BACKUP"
  FIRESTORE_BACKUP="${FIRESTORE_BACKUP}.gz"
  FIRESTORE_SIZE=$(du -h "$FIRESTORE_BACKUP" | cut -f1)
  log_success "Compression complete ($FIRESTORE_SIZE)"
fi

# =============================================================================
# BACKUP POSTGRESQL
# =============================================================================
log_info "Backing up PostgreSQL database..."

POSTGRES_BACKUP="$BACKUP_DATE_DIR/postgres-$TIMESTAMP.json"

# Get database URL for environment
case $ENVIRONMENT in
  local)
    DB_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
    ;;
  staging)
    DB_URL="${STAGING_DATABASE_URL:-}"
    ;;
  prod)
    DB_URL="${PROD_DATABASE_URL:-}"
    ;;
  *)
    log_error "Unknown environment: $ENVIRONMENT"
    exit 1
    ;;
esac

if [[ -z "$DB_URL" ]]; then
  log_warn "Database URL not set for $ENVIRONMENT, skipping PostgreSQL backup"
else
  POSTGRES_CMD="DATABASE_URL=$DB_URL npm run brat -- pg:backup --output $POSTGRES_BACKUP --format json"

  if [[ "$COMPRESS" == "true" ]]; then
    POSTGRES_CMD="$POSTGRES_CMD --compress"
    POSTGRES_BACKUP="${POSTGRES_BACKUP}.gz"
  fi

  cd "$PROJECT_ROOT"
  if eval "$POSTGRES_CMD"; then
    POSTGRES_SIZE=$(du -h "$POSTGRES_BACKUP" | cut -f1)
    log_success "PostgreSQL backup complete: $POSTGRES_BACKUP ($POSTGRES_SIZE)"
  else
    log_error "PostgreSQL backup failed"
    send_notification "BitBrat Backup Failed" "PostgreSQL backup failed for $ENVIRONMENT"
    exit 1
  fi
fi

# =============================================================================
# UPLOAD TO CLOUD STORAGE
# =============================================================================

# Upload to S3
if [[ "$S3_UPLOAD" == "true" ]]; then
  if [[ -z "$S3_BUCKET" ]]; then
    log_error "S3_BUCKET not set"
    exit 1
  fi

  log_info "Uploading backups to S3: s3://$S3_BUCKET/$ENVIRONMENT/$DATE_ONLY/"

  if command -v aws &> /dev/null; then
    aws s3 sync "$BACKUP_DATE_DIR" "s3://$S3_BUCKET/$ENVIRONMENT/$DATE_ONLY/" --quiet
    log_success "Uploaded to S3"
  else
    log_error "AWS CLI not installed, skipping S3 upload"
  fi
fi

# Upload to GCS
if [[ "$GCS_UPLOAD" == "true" ]]; then
  if [[ -z "$GCS_BUCKET" ]]; then
    log_error "GCS_BUCKET not set"
    exit 1
  fi

  log_info "Uploading backups to GCS: gs://$GCS_BUCKET/$ENVIRONMENT/$DATE_ONLY/"

  if command -v gsutil &> /dev/null; then
    gsutil -m rsync -r "$BACKUP_DATE_DIR" "gs://$GCS_BUCKET/$ENVIRONMENT/$DATE_ONLY/"
    log_success "Uploaded to GCS"
  else
    log_error "gsutil not installed, skipping GCS upload"
  fi
fi

# =============================================================================
# CLEANUP OLD BACKUPS
# =============================================================================
log_info "Cleaning up backups older than $RETENTION_DAYS days..."

find "$BACKUP_ENV_DIR" -type d -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true

OLD_COUNT=$(find "$BACKUP_ENV_DIR" -type d -mindepth 1 | wc -l | tr -d ' ')
log_info "Retained $OLD_COUNT backup date directories"

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "========================================="
echo "BACKUP SUMMARY"
echo "========================================="
echo "Environment:     $ENVIRONMENT"
echo "Date:            $DATE_ONLY"
echo "Firestore:       $FIRESTORE_SIZE"
if [[ -n "$POSTGRES_SIZE" ]]; then
  echo "PostgreSQL:      $POSTGRES_SIZE"
fi
echo "Retention:       $RETENTION_DAYS days"
if [[ "$S3_UPLOAD" == "true" ]]; then
  echo "S3 Bucket:       s3://$S3_BUCKET/$ENVIRONMENT/$DATE_ONLY/"
fi
if [[ "$GCS_UPLOAD" == "true" ]]; then
  echo "GCS Bucket:      gs://$GCS_BUCKET/$ENVIRONMENT/$DATE_ONLY/"
fi
echo "========================================="

log_success "Automated backup complete"

# Send success notification
send_notification "BitBrat Backup Successful" "Backup completed successfully for $ENVIRONMENT on $DATE_ONLY"
