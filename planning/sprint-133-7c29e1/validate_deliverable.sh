#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOC_PATH="$ROOT_DIR/documentation/technical-architecture/user-context-v1.md"

echo "🔎 Validating Technical Architecture deliverable..."

if [[ ! -f "$DOC_PATH" ]]; then
  echo "❌ Missing TA document at $DOC_PATH"
  exit 1
fi

echo "✅ Found TA document. Running structure checks..."

required_sections=(
  "## 2. Firestore Data Model"
  "### 2.1 Roles Configuration"
  "### 2.2 User Profile Extension"
  "## 3. LLM Bot Integration & Data Flow"
  "## 4. Caching & Invalidation"
  "## 5. Security, Permissions, and Privacy"
  "## 6. Migration & Backfill"
  "## 7. Observability"
  "## 8. Configuration Flags (llm-bot)"
  "## 9. Acceptance Criteria Mapping"
)

missing=0
for sec in "${required_sections[@]}"; do
  if ! grep -Fq "$sec" "$DOC_PATH"; then
    echo "❌ Missing required section: $sec"
    missing=1
  else
    echo "✔︎ Section present: $sec"
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "❌ One or more required sections are missing."
  exit 1
fi

echo "✅ TA document structure looks good."
exit 0
