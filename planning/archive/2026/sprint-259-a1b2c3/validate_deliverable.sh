#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building firebase-emulator service..."
# Use docker-compose to build just the failing service
docker compose -f infrastructure/docker-compose/docker-compose.local.yaml build firebase-emulator

echo "✅ Validation complete."
