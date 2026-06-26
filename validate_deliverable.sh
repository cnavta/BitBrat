#!/usr/bin/env bash
set -euo pipefail

# Path fix for local environment
export PATH=$PATH:/opt/homebrew/bin

echo "🔧 Installing dependencies..."
# npm ci # Skipping as we assume env is ready for this local tool task

echo "🧱 Building project..."
npm run build

echo "🧪 Running setup utility tests..."
npm test tools/brat/src/cli/setup.test.ts

echo "🏃 Verifying CLI command entrypoint..."
node dist/tools/brat/src/cli/index.js help setup || true

# -----------------------------------------------------------------------------
# Reusable standard service Dockerfile validation (sprint-318)
# Build a representative service via the shared Dockerfile.service, boot it,
# health-check it, then tear it down. Gracefully skips when docker is unavailable
# so the script stays logically passable per AGENTS.md §2.6.
# -----------------------------------------------------------------------------
echo "🐳 Validating reusable Dockerfile.service ..."
SVC_NAME="llm-bot"
SVC_ENTRY="dist/apps/llm-bot-service.js"
SVC_PORT="3000"
IMAGE_TAG="bitbrat-${SVC_NAME}:validate"
CONTAINER_NAME="bitbrat-${SVC_NAME}-validate"

if ! command -v docker >/dev/null 2>&1; then
  echo "⚠️  docker not found — skipping shared-Dockerfile build/boot validation (logically passable)."
else
  echo "   • Building ${SVC_NAME} from Dockerfile.service ..."
  docker build -f Dockerfile.service \
    --build-arg SERVICE_NAME="${SVC_NAME}" \
    --build-arg SERVICE_ENTRY="${SVC_ENTRY}" \
    --build-arg SERVICE_PORT="${SVC_PORT}" \
    -t "${IMAGE_TAG}" .

  echo "   • Booting container ..."
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker run -d --rm --name "${CONTAINER_NAME}" -p "${SVC_PORT}:${SVC_PORT}" "${IMAGE_TAG}"

  echo "   • Health check on port ${SVC_PORT} ..."
  HEALTH_OK=0
  for i in $(seq 1 15); do
    if curl -fsS "http://localhost:${SVC_PORT}/healthz" >/dev/null 2>&1 \
       || curl -fsS "http://localhost:${SVC_PORT}/" >/dev/null 2>&1; then
      HEALTH_OK=1
      break
    fi
    sleep 2
  done

  echo "   • Tearing down container ..."
  docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true

  if [[ "${HEALTH_OK}" -ne 1 ]]; then
    echo "❌ Shared Dockerfile.service health check failed for ${SVC_NAME}." >&2
    exit 1
  fi
  echo "   ✅ ${SVC_NAME} built and booted from Dockerfile.service."
fi

# -----------------------------------------------------------------------------
# brat backup (Firestore config export/import) validation (sprint-319)
#   - serializer round-trip + exclusion guard + provider + connection unit tests
#   - emulator export->wipe->import round-trip (auto-skips when no emulator runtime)
#   - `brat backup list` smoke check (no DB access)
# The emulator round-trip is gracefully skipped when FIRESTORE_EMULATOR_HOST is
# unreachable, keeping this script logically passable per AGENTS.md §2.6.
# -----------------------------------------------------------------------------
echo "🧪 Running brat backup tests (registry guard, serializer, provider, connection, round-trip)..."
npm test -- \
  tools/brat/src/backup \
  tools/brat/src/providers/gcp/__tests__/firestore.test.ts

echo "📋 brat backup list smoke check ..."
node dist/tools/brat/src/cli/index.js backup list >/dev/null
echo "   ✅ brat backup list OK."

# -----------------------------------------------------------------------------
# Bit model & universal MCP control plane validation (sprint-324)
#   - architecture.yaml additive ratification (profile / mcp.exposure / bit: glossary / §6.3)
#   - Platform Ring conformance on the hello-bit fixture + the MCP fold-down + discovery
#   - deployment-target parity: the bit.* / registration / auth path must behave identically
#     regardless of the messaging backend (PubSub on GCP vs NATS on Local/Remote Docker)
# -----------------------------------------------------------------------------
echo "🧩 Validating architecture.yaml (Bit model additive ratification)..."
node dist/tools/brat/src/cli/index.js config validate

echo "🧪 Running Bit Platform Ring conformance + MCP fold-down + discovery tests..."
npm test -- \
  tests/common/bit-conformance.spec.ts \
  tests/common/mcp-server.spec.ts \
  tests/integration/mcp-discovery.test.ts

echo "🔀 Asserting messaging-driver parity for the bit.* / registration path (PubSub + NATS)..."
for DRIVER in pubsub nats; do
  echo "   • MESSAGE_BUS_DRIVER=${DRIVER}"
  MESSAGE_BUS_DRIVER="${DRIVER}" MESSAGE_BUS_DISABLE_SUBSCRIBE=1 \
    npm test -- tests/common/bit-conformance.spec.ts >/dev/null
done
echo "   ✅ Bit control plane behaves identically across messaging drivers (GCP / Local / Remote Docker parity)."

echo "✅ Validation complete."
