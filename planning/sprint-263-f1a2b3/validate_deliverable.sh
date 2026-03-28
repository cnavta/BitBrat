#!/usr/bin/env bash
set -euo pipefail
echo "🧱 Rebuilding firebase-emulator service..."
export GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/dummy-creds.json
docker compose --project-directory . -f infrastructure/docker-compose/docker-compose.local.yaml build firebase-emulator
echo "✅ Build complete."
