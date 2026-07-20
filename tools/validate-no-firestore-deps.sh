#!/usr/bin/env bash
# validate-no-firestore-deps.sh
# Validates that service compose files do not contain legacy Firestore dependencies
# Exit code 0: Clean (no dependencies found)
# Exit code 1: Failure (dependencies found)

set -e

echo "🔍 Scanning service compose files for legacy Firestore dependencies..."
echo ""

FOUND=0
SERVICES_DIR="infrastructure/docker-compose/services"

# Check for GOOGLE_APPLICATION_CREDENTIALS environment variable
if grep -r 'GOOGLE_APPLICATION_CREDENTIALS' "$SERVICES_DIR" --include="*.yaml" --quiet 2>/dev/null; then
  echo "❌ ERROR: Found GOOGLE_APPLICATION_CREDENTIALS in service compose files:"
  echo ""
  grep -r 'GOOGLE_APPLICATION_CREDENTIALS' "$SERVICES_DIR" --include="*.yaml" -n --color=always
  echo ""
  FOUND=1
fi

# Check for google-app-creds.json volume mounts
if grep -r 'google-app-creds.json' "$SERVICES_DIR" --include="*.yaml" --quiet 2>/dev/null; then
  echo "❌ ERROR: Found google-app-creds.json volume mounts in service compose files:"
  echo ""
  grep -r 'google-app-creds.json' "$SERVICES_DIR" --include="*.yaml" -n --color=always
  echo ""
  FOUND=1
fi

# Report results
if [ $FOUND -eq 0 ]; then
  echo "✅ All service compose files are clean (no Firestore dependencies)"
  echo ""
  echo "   Scanned: $SERVICES_DIR/*.yaml"
  echo "   Status: PASS"
  exit 0
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "⚠️  GOOGLE_APPLICATION_CREDENTIALS should NO LONGER be required"
  echo ""
  echo "   After PostgreSQL migration (Sprint 344), services use:"
  echo "     PERSISTENCE_DRIVER=postgres (default)"
  echo ""
  echo "   Action required:"
  echo "     1. Remove GOOGLE_APPLICATION_CREDENTIALS environment variable"
  echo "     2. Remove google-app-creds.json volume mount"
  echo "     3. Add postgres to depends_on (if missing)"
  echo ""
  echo "   See: planning/sprint-351-bootstrap-automation/service-audit-report.md"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
