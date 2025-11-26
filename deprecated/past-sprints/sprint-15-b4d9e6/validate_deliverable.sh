#!/usr/bin/env bash
set -e

# Sprint 15 validation wrapper — planning phase
# This sprint focuses on planning an overlay-driven network implementation. No destructive operations are executed here.

if [[ ! -f "$(dirname "$0")/implementation-plan.md" ]]; then
  echo "[Sprint 15] planning artifacts not found next to this script." >&2
  exit 2
fi

echo "Welcome to Sprint 15!"
echo "✅ Planning artifacts present."
echo "ℹ️ This sprint's validation is planning-only until the implementation is approved."
echo "ℹ️ After approval, run the root validator to exercise the full Development Verification Flow:"
echo "   ./validate_deliverable.sh -- --env <env> --project-id <PROJECT_ID>"

echo "✅ Sprint 15 planning validation completed."
