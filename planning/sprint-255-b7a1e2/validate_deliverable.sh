#!/usr/bin/env bash
set -euo pipefail

# This is the sprint-specific validation script for sprint-255-b7a1e2.
# It delegates to the main project validation script with the tool-gateway scope.

echo "🚀 Starting validation for sprint-255-b7a1e2 (Fix Tool Discovery + Logging)..."

# Ensure we are in the repo root to run the main script
cd "$(dirname "$0")/../.."

./validate_deliverable.sh --scope tool-gateway

echo "✅ Sprint-specific validation complete."
