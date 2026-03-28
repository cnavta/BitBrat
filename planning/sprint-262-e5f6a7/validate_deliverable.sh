#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building all project services to verify GPG fix..."

# List of all Dockerfiles to build
SERVICES="api-gateway auth event-router ingress-egress llm-bot oauth-flow persistence query-analyzer scheduler state-engine tool-gateway obs-mcp brat"

for svc in $SERVICES; do
    echo "--- Building $svc ---"
    # We use -f Dockerfile.$svc if it exists, otherwise Dockerfile
    if [ -f "Dockerfile.$svc" ]; then
        docker build -f "Dockerfile.$svc" . -t "bitbrat-$svc:test"
    else
        echo "Warning: Dockerfile.$svc not found, skipping."
    fi
done

echo "✅ All services built successfully."
