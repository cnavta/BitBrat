#!/usr/bin/env bash
set -euo pipefail

# BitBrat — Cloud deployment entrypoint (stub for Sprint 1)
# Supports --dry-run to satisfy validation. Real implementation in a future sprint.

# Enforce running from repo root
if [[ ! -f "package.json" || ! -f "architecture.yaml" ]]; then
  echo "[deploy-cloud] Error: please run this command from the repository root (where package.json and architecture.yaml reside)." >&2
  exit 2
fi

DRY_RUN="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN="true"; shift ;;
    *) shift ;;
  esac
done

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[deploy-cloud] Dry run: no actions performed (stub)."
  exit 0
fi

echo "[deploy-cloud] Not implemented yet. Use --dry-run during Sprint 1."
exit 0
