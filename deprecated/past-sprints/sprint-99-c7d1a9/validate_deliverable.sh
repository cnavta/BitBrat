#!/usr/bin/env bash
set -euo pipefail

echo "🔎 Validating sprint-99-c7d1a9 deliverables..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "✅ Checking required documents exist..."
test -f "${SCRIPT_DIR}/technical-architecture-ingress-egress.md" || { echo "Missing technical architecture doc"; exit 1; }
test -f "${SCRIPT_DIR}/sprint-manifest.yaml" || { echo "Missing sprint-manifest.yaml"; exit 1; }
test -f "${SCRIPT_DIR}/implementation-plan.md" || { echo "Missing implementation-plan.md"; exit 1; }
test -f "${SCRIPT_DIR}/execution-plan.md" || { echo "Missing execution-plan.md"; exit 1; }
test -f "${SCRIPT_DIR}/backlog.yaml" || { echo "Missing backlog.yaml"; exit 1; }

echo "ℹ️  Root validation may take longer and run build/tests. Set SKIP_ROOT_VALIDATE=1 to skip."
if [[ "${SKIP_ROOT_VALIDATE:-0}" != "1" ]]; then
  if [[ -x "${REPO_ROOT}/validate_deliverable.sh" ]]; then
    "${REPO_ROOT}/validate_deliverable.sh"
  else
    echo "⚠️  Root validate_deliverable.sh not found or not executable; skipping root validation."
  fi
else
  echo "⏭️  Skipping root validation by request."
fi

echo "✅ Sprint deliverable validation complete."
