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

# Copy firebase config artifacts
cp /workspace/firebase.json /data/firebase.json
cp /workspace/firestore.rules /data/firestore.rules

echo "[firebase-emulator] Effective firebase.json:"
cat /data/firebase.json

# Authenticate the Firebase CLI via ADC using the mounted service account key
# This avoids interactive `firebase login` prompts.
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  echo "[firebase-emulator] Using ADC: ${GOOGLE_APPLICATION_CREDENTIALS:-unset}; project=${PROJECT_ID}"
  gcloud auth activate-service-account --key-file="${GOOGLE_APPLICATION_CREDENTIALS}" >/dev/null 2>&1 || true
else
  echo "[firebase-emulator] WARNING: GOOGLE_APPLICATION_CREDENTIALS not set or file not found; emulator will run without CLI auth."
fi

# Determine which emulators to start. 
# Default to firestore only if not specified via ONLY_EMULATORS
EMULATORS="${ONLY_EMULATORS:-firestore,pubsub,eventarc,ui}"

echo "[firebase-emulator] Starting emulators: ${EMULATORS}..."

exec firebase emulators:start \
  --config /data/firebase.json \
  --import=/data/export \
  --log-verbosity=DEBUG \
  --project="${PROJECT_ID}" \
  --export-on-exit=/data/export
