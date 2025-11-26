#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPRINT_DIR="$SCRIPT_DIR"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🔎 Validating Sprint 98 planning artifacts..."

required_files=(
  "$SPRINT_DIR/sprint-manifest.yaml"
  "$SPRINT_DIR/implementation-plan.md"
  "$SPRINT_DIR/request-log.md"
)

for f in "${required_files[@]}"; do
  if [[ -f "$f" ]]; then
    echo "✅ Found: ${f#$ROOT_DIR/}"
  else
    echo "❌ Missing required file: ${f#$ROOT_DIR/}" >&2
    exit 1
  fi
done

# architecture.yaml presence
if [[ -f "$ROOT_DIR/architecture.yaml" ]]; then
  echo "✅ Found: architecture.yaml (canonical source of truth)"
else
  echo "❌ Missing architecture.yaml at repo root" >&2
  exit 1
fi

# Check key sections exist in implementation-plan.md
plan="$SPRINT_DIR/implementation-plan.md"
declare -a sections=(
  "## Objective & Scope"
  "## Deliverables"
  "## Acceptance Criteria"
  "## Testing & Validation Strategy"
  "## Deployment Approach"
  "## Dependencies & References"
  "## Publication Plan"
  "## Definition of Done"
  "## Traceability"
)

for s in "${sections[@]}"; do
  if grep -q "^$s" "$plan"; then
    echo "✅ Section present: $s"
  else
    echo "❌ Missing section in implementation-plan.md: $s" >&2
    exit 1
  fi
done

# Check references to prior sprint docs for continuity
refs=(
  "planning/past-sprints/sprint-97-f2c9a1/phase-1-event-bus-architecture.md"
  "planning/past-sprints/sprint-97-f2c9a1/sprint-execution-plan.md"
  "planning/past-sprints/sprint-97-f2c9a1/trackable-backlog.md"
)

for r in "${refs[@]}"; do
  if grep -q "$r" "$plan"; then
    echo "✅ Reference present in plan: $r"
  else
    echo "❌ Expected reference missing from plan: $r" >&2
    exit 1
  fi
done

echo "✅ All validation steps passed for Sprint 98 planning deliverables."
