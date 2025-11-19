#!/usr/bin/env bash
set -euo pipefail

echo "Validating Sprint 22 planning artifacts..."

base_dir="$(cd "$(dirname "$0")" && pwd)"

required=(
  "${base_dir}/sprint-manifest.yaml"
  "${base_dir}/sprint-execution-plan.md"
  "${base_dir}/backlog.md"
  "${base_dir}/request-log.md"
)

for f in "${required[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing required artifact: $f" >&2
    exit 1
  fi
done

echo "All required Sprint 22 planning artifacts are present. ✅"
