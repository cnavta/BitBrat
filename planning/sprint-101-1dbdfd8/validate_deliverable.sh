#!/usr/bin/env bash
set -euo pipefail

echo "Delegating to repo-level validate_deliverable.sh..."
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/../.. && pwd)"
cd "$ROOT_DIR"

./validate_deliverable.sh
