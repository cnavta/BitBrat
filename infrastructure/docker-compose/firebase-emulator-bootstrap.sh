#!/usr/bin/env bash
set -euo pipefail

# Bootstrap a Firebase project directory inside /data for the emulator
# Requirements:
#  - FIREBASE_PROJECT_ID (default: bitbrat-local)
#  - GOOGLE_APPLICATION_CREDENTIALS pointing to a JSON key mounted inside the container
#  - /workspace contains firebase.json, firestore.rules, firestore.indexes.json

PROJECT_ID="${FIREBASE_PROJECT_ID:-bitbrat-local}"
export HOME=/data

mkdir -p /data/export

# Create minimal .firebaserc if missing (equivalent to `firebase init` project selection)
if [[ ! -f /data/.firebaserc ]]; then
  echo "{\"projects\":{\"default\":\"${PROJECT_ID}\"}}" > /data/.firebaserc
fi

# Copy firebase config artifacts into /data if missing
[[ -f /data/firebase.json ]] || cp /workspace/firebase.json /data/firebase.json
[[ -f /data/firestore.rules ]] || cp /workspace/firestore.rules /data/firestore.rules
if [[ -f /workspace/firestore.indexes.json && ! -f /data/firestore.indexes.json ]]; then
  cp /workspace/firestore.indexes.json /data/firestore.indexes.json
fi

# Authenticate the Firebase CLI via ADC using the mounted service account key
# This avoids interactive `firebase login` prompts.
echo "[firebase-emulator] Using ADC: ${GOOGLE_APPLICATION_CREDENTIALS:-unset}; project=${PROJECT_ID}"
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  gcloud auth activate-service-account --key-file="${GOOGLE_APPLICATION_CREDENTIALS}" >/dev/null 2>&1 || true
  # Provide a token for firebase-tools if it attempts authenticated calls
  export FIREBASE_TOKEN="$(gcloud auth print-access-token || true)"
else
  echo "[firebase-emulator] WARNING: GOOGLE_APPLICATION_CREDENTIALS not set or file not found; emulator will run without CLI auth."
fi

# Determine which emulators to start. 
# Default to firestore only if not specified via ONLY_EMULATORS
EMULATORS="${ONLY_EMULATORS:-firestore,pubsub}"

echo "[firebase-emulator] Starting emulators: ${EMULATORS}..."

exec firebase emulators:start \
  --config /data/firebase.json \
  --only "${EMULATORS}" \
  --project "${PROJECT_ID}" \
  --import=/data/export \
  --export-on-exit=/data/export
