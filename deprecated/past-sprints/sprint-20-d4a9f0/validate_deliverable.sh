#!/usr/bin/env bash
set -e

# Thin wrapper to run the root validation flow. Accepts same args.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

cd "$REPO_ROOT"
./validate_deliverable.sh "$@"
