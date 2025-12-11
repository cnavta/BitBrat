#!/usr/bin/env bash
set -euo pipefail

echo "Checking sprint artifacts..."
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

required=(
  "$BASE_DIR/sprint-manifest.yaml"
  "$BASE_DIR/implementation-plan.md"
  "$BASE_DIR/technical-architecture.md"
  "$BASE_DIR/publication.yaml"
  "$BASE_DIR/request-log.md"
)

for f in "${required[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing required artifact: $f" >&2
    exit 1
  fi
done

echo "Validating presence of ALLOWED_SIGILS in env configs..."
grep -q "ALLOWED_SIGILS" "$BASE_DIR/../../env/dev/command-processor.yaml"
grep -q "ALLOWED_SIGILS" "$BASE_DIR/../../env/local/command-processor.yaml"

echo "Artifacts present and basic checks passed."
