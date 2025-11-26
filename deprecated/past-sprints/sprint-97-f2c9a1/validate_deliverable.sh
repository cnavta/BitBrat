#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SPRINT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[Sprint 97] Validating Phase 1 Event Bus documentation..."

must_exist() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "❌ Missing required file: $path" >&2
    exit 1
  else
    echo "✅ Found: $path"
  fi
}

must_contain() {
  local path="$1"
  local needle="$2"
  if ! grep -qi -- "$needle" "$path"; then
    echo "❌ Expected to find '$needle' in $path" >&2
    exit 1
  else
    echo "✅ '$needle' present in $(basename "$path")"
  fi
}

# Required files
DOC_ARCH="$SPRINT_DIR/phase-1-event-bus-architecture.md"
DOC_PLAN="$SPRINT_DIR/implementation-plan.md"
DOC_LOG="$SPRINT_DIR/request-log.md"
DOC_EXEC_PLAN="$SPRINT_DIR/sprint-execution-plan.md"
DOC_BACKLOG="$SPRINT_DIR/trackable-backlog.md"
DOC_PR_BODY="$SPRINT_DIR/pr-body.md"
DOC_VERIF="$SPRINT_DIR/verification-report.md"
DOC_PUBLICATION_YAML="$SPRINT_DIR/publication.yaml"

must_exist "$DOC_ARCH"
must_exist "$DOC_PLAN"
must_exist "$DOC_LOG"
must_exist "$DOC_EXEC_PLAN"
must_exist "$DOC_BACKLOG"
must_exist "$DOC_PR_BODY"
must_exist "$DOC_VERIF"
must_exist "$DOC_PUBLICATION_YAML"

echo "[Check] Core interfaces and API shapes"
must_contain "$DOC_ARCH" "publishJson("
must_contain "$DOC_ARCH" "subscribe("

echo "[Check] Initial topics aligned with architecture.yaml"
must_contain "$DOC_ARCH" "internal.ingress.v1"
must_contain "$DOC_ARCH" "internal.finalize.v1"
must_contain "$DOC_ARCH" "internal.llmbot.v1"

echo "[Check] Envelope v1 and attributes"
must_contain "$DOC_ARCH" "Envelope v1"
must_contain "$DOC_ARCH" "correlationId"
must_contain "$DOC_ARCH" "traceparent"

echo "[Check] Env-based driver selection"
must_contain "$DOC_ARCH" "MESSAGE_BUS_DRIVER"
must_contain "$DOC_ARCH" "BUS_PREFIX"

echo "[Check] Operational expectations: idempotency, retries/backoff, DLQ"
must_contain "$DOC_ARCH" "Idempotency"
must_contain "$DOC_ARCH" "backoff"
must_contain "$DOC_ARCH" "deadletter"

echo "[Check] Compliance checklist present"
must_contain "$DOC_ARCH" "Minimal Compliance Checklist"

echo "[Check] Execution plan & backlog basics"
must_contain "$DOC_EXEC_PLAN" "Sprint 97 — Execution Plan"
must_contain "$DOC_BACKLOG" "EB-1"

echo "✅ Sprint 97 documentation validation passed."
