#!/usr/bin/env bash
set -e

# Enforce running from repo root
if [[ ! -f "package.json" || ! -f "architecture.yaml" ]]; then
  echo "[validate_deliverable] Error: please run this command from the repository root (where package.json and architecture.yaml reside)." >&2
  exit 2
fi

# Parse arguments
ENV_ARG=""
PROJECT_ID_ARG=""
SHOW_HELP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-e)
      ENV_ARG="$2"; shift 2 ;;
    --project-id|-p)
      PROJECT_ID_ARG="$2"; shift 2 ;;
    --help|-h)
      SHOW_HELP=true; shift ;;
    --)
      shift; break ;;
    *)
      echo "Unknown argument: $1" >&2
      SHOW_HELP=true; shift ;;
  esac
done

if $SHOW_HELP; then
  cat <<EOF
Usage: ./validate_deliverable.sh [--env <env>] [--project-id <PROJECT_ID>]

Description:
  Runs the full Development Verification Flow plus infra dry-run validation steps (Sprints 14 & 24 updates).

Options:
  -e, --env           Environment overlay to use (default: dev)
  -p, --project-id    GCP Project ID to target (default: value of $PROJECT_ID)
  -h, --help          Show this help message
EOF
  exit 0
fi

ENV_ARG=${ENV_ARG:-dev}
PROJECT_ID_ARG=${PROJECT_ID_ARG:-${PROJECT_ID:-}}

if [[ -z "$PROJECT_ID_ARG" ]]; then
  echo "[validate_deliverable] Error: --project-id not provided and PROJECT_ID env var is empty. Provide a project ID." >&2
  exit 2
fi

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Compiling..."
npm run build

echo "🧪 Running tests..."
export CI=1
# Ensure CI uses a zero-I/O message bus to avoid any network connections (@google-cloud/pubsub or NATS)
export MESSAGE_BUS_DRIVER=${MESSAGE_BUS_DRIVER:-noop}
# Explicitly disable any background subscriptions in services during tests
export MESSAGE_BUS_DISABLE_SUBSCRIBE=1
# Disable any message bus network I/O at the factory level
export MESSAGE_BUS_DISABLE_IO=1
# Disable Pub/Sub topic/subscription ensure logic if any pubsub path is accidentally hit
export PUBSUB_ENSURE_DISABLE=1
npm test

# Sprint 14: Infra dry-run validation
echo "🧭 Infra dry-run validation (env=$ENV_ARG, project=$PROJECT_ID_ARG)"

# Enable required APIs (dry-run)
echo "➡️  Enabling required APIs (dry-run)"
npm run brat -- apis enable --env "$ENV_ARG" --project-id "$PROJECT_ID_ARG" --dry-run

# Plan network (dry-run)
echo "➡️  Planning network (dry-run)"
npm run brat -- infra plan network --env "$ENV_ARG" --project-id "$PROJECT_ID_ARG" --dry-run

# Plan connectors (dry-run)
echo "➡️  Planning connectors (dry-run)"
npm run brat -- infra plan connectors --env "$ENV_ARG" --project-id "$PROJECT_ID_ARG" --dry-run

# Plan buckets (dry-run)
echo "➡️  Planning buckets (dry-run)"
npm run brat -- infra plan buckets --env "$ENV_ARG" --project-id "$PROJECT_ID_ARG" --dry-run

# Plan load balancer (dry-run)
echo "➡️  Planning load balancer (dry-run)"
npm run brat -- infra plan lb --env "$ENV_ARG" --project-id "$PROJECT_ID_ARG" --dry-run

# URL map import (dry-run)
echo "➡️  URL map import (dry-run)"
npm run brat -- lb urlmap import --env "$ENV_ARG" --project-id "$PROJECT_ID_ARG" --dry-run

# Original local verification flow
echo "🚀 Running local deployment..."
npm run local

echo "🚀 Shutting local deployment down..."
npm run local:down

echo "🚀 Running dry-run deployment..."
npm run deploy:cloud -- --dry-run

echo "✅ All validation steps passed."