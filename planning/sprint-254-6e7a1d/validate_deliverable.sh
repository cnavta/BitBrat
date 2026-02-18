#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating sprint-254-6e7a1d deliverables..."

# Check if documentation exists
if [ -f "documentation/bitbrat_state_memory_architecture.md" ]; then
    echo "✅ bitbrat_state_memory_architecture.md exists."
else
    echo "❌ bitbrat_state_memory_architecture.md is missing!"
    exit 1
fi

# Check for required sprint artifacts
ARTIFACTS=(
    "planning/sprint-254-6e7a1d/sprint-manifest.yaml"
    "planning/sprint-254-6e7a1d/implementation-plan.md"
    "planning/sprint-254-6e7a1d/request-log.md"
)

for art in "${ARTIFACTS[@]}"; do
    if [ -f "$art" ]; then
        echo "✅ $art exists."
    else
        echo "❌ $art is missing!"
        exit 1
    fi
done

echo "✅ Validation complete."
