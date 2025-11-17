#!/usr/bin/env bash
set -e

# Sprint 14 validation wrapper
# This sprint focuses on planning and CI wiring design. No destructive operations are executed here.

if [[ ! -f "$(dirname "$0")/implementation-plan.md" ]]; then
  echo "[Sprint 14] planning artifacts not found next to this script." >&2
  exit 2
fi

echo "Welcome to Sprint 14!"
echo "✅ Planning artifacts present."
echo "ℹ️ This sprint's validation is planning-only until the implementation is approved."
echo "ℹ️ After approval, run the root validator to exercise the full Development Verification Flow:"
echo "   ./validate_deliverable.sh"

echo "✅ Sprint 14 planning validation completed."
