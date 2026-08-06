#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Validating Docker Compose configuration..."

# Use a temporary directory for validation to avoid side effects
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

cp infrastructure/docker-compose/docker-compose.local.yaml "$TEMP_DIR/"
mkdir -p "$TEMP_DIR/infrastructure/docker-compose/services"
cp infrastructure/docker-compose/services/*.compose.yaml "$TEMP_DIR/infrastructure/docker-compose/services/"

# Check each service file for proper depends_on condition
SERVICES=("auth" "command-processor" "event-router" "ingress-egress" "llm-bot" "oauth-flow" "persistence" "scheduler")

for SVC in "${SERVICES[@]}"; do
    FILE="infrastructure/docker-compose/services/${SVC}.compose.yaml"
    echo "Checking $FILE..."
    
    # Check for nats healthy dependency
    if ! grep -q "nats:" "$FILE" || ! grep -A 2 "nats:" "$FILE" | grep -q "condition: service_healthy"; then
        echo "❌ Error: $FILE missing 'nats' with 'service_healthy' condition."
        exit 1
    fi
    
    # Check for firebase-emulator healthy dependency
    if ! grep -q "firebase-emulator:" "$FILE" || ! grep -A 2 "firebase-emulator:" "$FILE" | grep -q "condition: service_healthy"; then
        echo "❌ Error: $FILE missing 'firebase-emulator' with 'service_healthy' condition."
        exit 1
    fi
done

echo "🧪 Running docker compose config dry-run..."
# We need .env.local for config validation to pass if variables are used
if [ -f .env.local ]; then
    ./infrastructure/deploy-local.sh --dry-run
else
    echo "⚠️ Skipping dry-run deployment validation (missing .env.local)."
fi

echo "✅ Validation complete. All services have proper dependencies on healthy infra."
