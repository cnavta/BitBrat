#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building firebase-emulator service with optimized Dockerfile..."
# Use docker compose with --project-directory . to ensure correct relative paths
docker compose --project-directory . -f infrastructure/docker-compose/docker-compose.local.yaml build firebase-emulator

echo "✅ Validation complete."
