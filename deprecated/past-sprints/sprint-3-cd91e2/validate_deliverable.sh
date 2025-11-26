#!/usr/bin/env bash
set -e

# Sprint-level validation script (dry-run safe)
# This script is intended to be invoked by humans or CI to validate Sprint 3 deliverables.
# It performs local build/test and executes dry-run placeholders for infra until modules exist.

# Enforce running from repo root
if [[ ! -f "package.json" || ! -f "architecture.yaml" ]]; then
  echo "[sprint-3] Error: run from repo root (package.json + architecture.yaml required)." >&2
  exit 2
fi

echo "🔧 Installing dependencies..."
npm ci || npm install

echo "🧱 Compiling..."
npm run build

echo "🧪 Running tests..."
npm test

# Dry-run deploy placeholders (do not fail if scripts are missing)
if [[ -x "./infrastructure/deploy-local.sh" ]]; then
  echo "🚀 Dry-run local deploy..."
  ./infrastructure/deploy-local.sh --dry-run || true
else
  echo "ℹ️ Skipping local deploy dry-run (script not found)."
fi

echo "🚀 Dry-run cloud deploy..."
npm run deploy:cloud -- --dry-run || true

# Terraform plans (networking) — only if terraform and directories are present
if command -v terraform >/dev/null 2>&1; then
  if [[ -d "infrastructure/gcp/prod" ]]; then
    echo "📦 Terraform init/plan (prod overlay, backend disabled for safety)..."
    terraform -chdir=infrastructure/gcp/prod init -backend=false -input=false -upgrade || true
    terraform -chdir=infrastructure/gcp/prod plan -input=false -lock=false || true
  else
    echo "ℹ️ Skipping Terraform prod overlay (directory not found)."
  fi
else
  echo "ℹ️ Terraform not installed; skipping Terraform validation."
fi

# Placeholder for LB smoke test (to be implemented once LB exists)
LB_HOSTNAME=${LB_HOSTNAME:-}
if [[ -n "$LB_HOSTNAME" ]]; then
  echo "🌐 Smoke test against https://$LB_HOSTNAME/healthz ..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "https://$LB_HOSTNAME/healthz" -o /dev/null || true
  else
    echo "ℹ️ curl not available; skipping smoke test."
  fi
else
  echo "ℹ️ LB_HOSTNAME not set; skipping LB smoke test."
fi

echo "✅ Sprint 3 validation steps completed (dry-run)."