#!/usr/bin/env bash
set -euo pipefail

# Fix Terraform apply failing with Cloud Run deletion protection when the resource is tainted.
# This script untaints the Cloud Run v2 service so Terraform can update
# deletion_protection=false in-place instead of attempting a destroy.
# Optionally performs a targeted apply for just the Cloud Run service.
#
# Usage examples:
#   # Only untaint, then you run a normal apply yourself
#   ./fix-cloud-run-deletion-protection.sh \
#     --env-dir infrastructure/gcp/prod
#
#   # Un-taint and perform a targeted apply for the Cloud Run service
#   ./fix-cloud-run-deletion-protection.sh \
#     --env-dir infrastructure/gcp/prod \
#     --project-id twitch-452523 \
#     --region us-central1 \
#     --apply
#
# Notes:
# - This script is idempotent. If the resource is not tainted, untaint will be a no-op.
# - Ensure your prod overlay sets `deletion_protection = false` before running.
# - After running with --apply (or after a manual apply), re-run a full `terraform apply`
#   to process any remaining changes.

ENV_DIR="infrastructure/gcp/prod"
PROJECT_ID=""
REGION=""
DO_APPLY=false
MODULE_NAME="run_oauth"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-dir)
      ENV_DIR="$2"; shift 2 ;;
    --project-id)
      PROJECT_ID="$2"; shift 2 ;;
    --region)
      REGION="$2"; shift 2 ;;
    --module-name)
      MODULE_NAME="$2"; shift 2 ;;
    --apply)
      DO_APPLY=true; shift 1 ;;
    -h|--help)
      sed -n '1,120p' "$0"; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$ENV_DIR" ]]; then
  echo "ERROR: ENV_DIR not found: $ENV_DIR" >&2
  exit 1
fi

pushd "$ENV_DIR" >/dev/null

# Always ensure working directory is initialized
terraform init -input=false -no-color >/dev/null

TARGET_ADDR="module.${MODULE_NAME}.google_cloud_run_v2_service.this"

echo "Checking current Terraform state for ${TARGET_ADDR}..."
if ! terraform state show -no-color "$TARGET_ADDR" >/dev/null 2>&1; then
  echo "ERROR: Terraform state does not contain ${TARGET_ADDR}. Ensure you ran 'terraform apply' previously or module names match."
  popd >/dev/null
  exit 1
fi

# Attempt untaint (safe even if not tainted)
echo "Removing taint from ${TARGET_ADDR} (if present)..."
terraform untaint -no-color "$TARGET_ADDR" || true

echo "✅ Untaint complete for ${TARGET_ADDR}."

if [[ "$DO_APPLY" == true ]]; then
  if [[ -z "$PROJECT_ID" || -z "$REGION" ]]; then
    echo "ERROR: --project-id and --region are required when using --apply" >&2
    popd >/dev/null
    exit 1
  fi
  echo "Applying only the Cloud Run service to update deletion_protection in-place..."
  terraform apply -no-color -auto-approve \
    -target="$TARGET_ADDR" \
    -var="project_id=${PROJECT_ID}" \
    -var="region=${REGION}"
  echo "✅ Targeted apply complete. You can now run a full 'terraform apply' to process remaining changes."
else
  echo "No apply performed. Next steps:"
  echo "  1) Verify your overlay sets deletion_protection = false (already configured)."
  echo "  2) Run: terraform plan -var=\"project_id=<ID>\" -var=\"region=<REGION>\""
  echo "  3) Run: terraform apply -var=\"project_id=<ID>\" -var=\"region=<REGION>\""
fi

popd >/dev/null
