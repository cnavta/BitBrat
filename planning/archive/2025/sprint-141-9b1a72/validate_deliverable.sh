#!/usr/bin/env bash
set -euo pipefail

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../.." && pwd)"

cd "$REPO_ROOT"
echo "Running repository validation..."
./validate_deliverable.sh

echo "Sprint validation complete."
