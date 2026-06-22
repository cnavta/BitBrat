#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validating documentation planning artifacts..."

# 1. Check if required files exist
FILES=(
    "planning/sprint-316-d9e8f7/sprint-manifest.yaml"
    "planning/sprint-316-d9e8f7/implementation-plan.md"
    "planning/sprint-316-d9e8f7/request-log.md"
    "planning/sprint-316-d9e8f7/analysis-report.md"
    "planning/sprint-316-d9e8f7/backlog-316.yaml"
)

for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing required file: $file"
        exit 1
    fi
    echo "✅ Found $file"
done

# 2. Validate YAML files (using a simple check since node is not available)
echo "🧱 Validating YAML structure..."
for file in "planning/sprint-316-d9e8f7/sprint-manifest.yaml" "planning/sprint-316-d9e8f7/backlog-316.yaml"; do
    if grep -q ":" "$file"; then
        echo "✅ $file looks like valid YAML (contains key-value pairs)"
    else
        echo "❌ $file does not look like valid YAML"
        exit 1
    fi
done

# 3. Check for mandatory topics in implementation-plan.md
echo "📝 Checking coverage in implementation-plan.md..."
TOPIC_PATTERNS=(
    "Local platform execution"
    "brat.*command overview"
    "Seed data setup"
    "brat chat.*introduction"
    "Event router and rule format"
    "Ingest -> Analysis -> React -> Egress flow"
    "!lurk.*command setup tutorial"
)

for pattern in "${TOPIC_PATTERNS[@]}"; do
    if ! grep -Ei "$pattern" planning/sprint-316-d9e8f7/implementation-plan.md > /dev/null; then
        echo "❌ Missing topic in implementation-plan.md: $pattern"
        exit 1
    fi
    echo "✅ Topic covered (pattern: $pattern)"
done

echo "✅ Validation complete."
