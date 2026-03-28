#!/usr/bin/env bash
set -euo pipefail

# Bootstrap a Firebase project directory inside /data for the emulator
# Requirements:
#  - FIREBASE_PROJECT_ID (default: bitbrat-local)
#  - GOOGLE_APPLICATION_CREDENTIALS pointing to a JSON key mounted inside the container
#  - /workspace contains firebase.json, firestore.rules, firestore.indexes.json

PROJECT_ID="${FIREBASE_PROJECT_ID:-bitbrat-local}"
# Ensure runtime .cache points to the image-stored emulators to avoid re-downloads
# when mounting a volume to /data
mkdir -p /data/.cache/firebase
if [[ ! -L /data/.cache/firebase/emulators ]]; then
  # Remove any existing directory if it's not a symlink (might be from a previous volume)
  rm -rf /data/.cache/firebase/emulators
  ln -s /usr/local/share/firebase/.cache/firebase/emulators /data/.cache/firebase/emulators
  echo "[firebase-emulator] Linked pre-downloaded emulators to /data/.cache"
fi

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

# Authenticate the Firebase CLI using ADC if GOOGLE_APPLICATION_CREDENTIALS is provided.
# firebase-tools will pick up GOOGLE_APPLICATION_CREDENTIALS automatically if set.
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  echo "[firebase-emulator] Using ADC: ${GOOGLE_APPLICATION_CREDENTIALS:-unset}; project=${PROJECT_ID}"
  # No explicit login needed; firebase emulators:start uses GOOGLE_APPLICATION_CREDENTIALS
else
  echo "[firebase-emulator] WARNING: GOOGLE_APPLICATION_CREDENTIALS not set or file not found; emulator will run without CLI auth."
fi

# Determine which emulators to start.
# Default to firestore only if not specified via ONLY_EMULATORS
EMULATORS="${ONLY_EMULATORS:-firestore,pubsub,ui}"

echo "[firebase-emulator] Starting emulators: ${EMULATORS}..."

exec firebase emulators:start \
  --only "${EMULATORS}" \
  --config /data/firebase.json \
  --import=/data/export \
  --log-verbosity=DEBUG \
  --project="${PROJECT_ID}" \
  --export-on-exit=/data/export
