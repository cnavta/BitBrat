#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")"/../.. && pwd)
SPRINT_DIR="$ROOT_DIR/planning/sprint-13-ace12f"

required=(
  "$SPRINT_DIR/technical-architecture.md"
  "$SPRINT_DIR/implementation-plan.md"
  "$SPRINT_DIR/project-implementation-plan.md"
  "$SPRINT_DIR/sprint-manifest.yaml"
  "$SPRINT_DIR/request-log.md"
  "$SPRINT_DIR/verification-report.md"
  "$SPRINT_DIR/retro.md"
  "$SPRINT_DIR/publication.yaml"
)

for f in "${required[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing required artifact: $f" >&2
    exit 1
  fi
done

echo "All Sprint 13 planning artifacts are present."

echo "Lint check: ensuring documents reference architecture.yaml..."
if ! grep -q "architecture.yaml" "$SPRINT_DIR/technical-architecture.md"; then
  echo "technical-architecture.md must reference architecture.yaml" >&2
  exit 1
fi

echo "Sprint 13 validator passed."