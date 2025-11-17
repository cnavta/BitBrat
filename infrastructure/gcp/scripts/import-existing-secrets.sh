#!/usr/bin/env bash
set -euo pipefail

# Disabled by security policy: Manual Secret Manager governance in effect.
# This script is intentionally a no-op to prevent any automated creation, import,
# modification, or destruction of Secret Manager resources.
# If you need to manage secrets, do so manually via the GCP Console or approved runbooks.

echo "[import-existing-secrets] Disabled: Secret Manager is managed manually. No action performed." >&2
exit 0