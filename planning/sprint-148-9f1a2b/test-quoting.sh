#!/usr/bin/env bash
set -euo pipefail

# Mock Cloud Build substitutions
_SERVICE_NAME="llm-bot"
_REGION="us-central1"
_PORT="3000"
_MIN_INSTANCES="1"
_MAX_INSTANCES="1"
_CPU="1"
_MEMORY="512Mi"
_INGRESS="internal-and-cloud-load-balancing"
_VPC_CONNECTOR="brat-conn-us-central1-dev"
_ALLOW_UNAUTH="true"
_ENV_VARS_ARG="BUS_PREFIX=dev.;ENV_PREFIX=dev.;LLM_BOT_ENABLED=true;LLM_BOT_SYSTEM_PROMPT=You are BitBrat, a conversational, entertaining assistant. You may push boundaries, but NEVER in cruelty, and can be extremely kind when the moment is right. Always, always, laugh at the world, but also always show others understanding. Use the improv concept of 'Yes, and' when responding to users. Be creative, but never at the expense of being kind and understanding, though throwing a few little jokes and puns at people when appropriate never hurt anyone. We are all friends here, so jest away!"
_SECRET_SET_ARG="OPENAI_API_KEY=OPENAI_API_KEY:1"
_TAG="latest"

# Mock gcloud
gcloud() {
  echo "MOCK GCLOUD CALLED WITH ARGS:"
  for arg in "$@"; do
    echo "  ARG: [$arg]"
  done
}
export -f gcloud

# Script logic from cloudbuild.oauth-flow.yaml
IMAGE="${_REGION}-docker.pkg.dev/PROJECT_ID/REPO/${_SERVICE_NAME}:${_TAG}"
ALLOW_FLAG=""
if [ "${_ALLOW_UNAUTH}" = "true" ]; then
  ALLOW_FLAG="--allow-unauthenticated"
fi

# Build command as an array
CMD=(run deploy "${_SERVICE_NAME}" \
  --image "$IMAGE" \
  --region "${_REGION}" \
  --platform managed \
  --port "${_PORT}" \
  --min-instances "${_MIN_INSTANCES}" \
  --max-instances "${_MAX_INSTANCES}" \
  --cpu "${_CPU}" --memory "${_MEMORY}" \
  --execution-environment gen2 \
  --no-cpu-throttling)

if [ -n "${_INGRESS}" ]; then CMD+=("--ingress" "${_INGRESS}"); fi
if [ -n "${_VPC_CONNECTOR}" ]; then CMD+=("--vpc-connector" "${_VPC_CONNECTOR}"); fi
if [ -n "$ALLOW_FLAG" ]; then CMD+=("$ALLOW_FLAG"); fi
if [ -n "${_SECRET_SET_ARG}" ]; then
  SEC_RAW="${_SECRET_SET_ARG}"
  SEC_RAW=$(printf '%s' "$SEC_RAW" | sed -e 's/\\\\/\\/g' -e 's/\\,/,/g' -e 's/\\=/=/g')
  CMD+=("--set-secrets" "$(printf '%s' "$SEC_RAW" | tr ';' ',')")
fi

ENV_DELIM='~'
ENV_RAW="${_ENV_VARS_ARG}"
ENV_RAW=$(printf '%s' "$ENV_RAW" | sed -e 's/\\\\\\\\/\\\\/g' -e 's/\\\\,/,/g' -e 's/\\\\=/=/g')

if [ -n "$ENV_RAW" ]; then
  ENV_MAPPED=$(printf '%s' "$ENV_RAW" | tr ';' "$ENV_DELIM")
  SET_ENV_ARG="^$ENV_DELIM^$ENV_MAPPED"
  CMD+=("--set-env-vars" "$SET_ENV_ARG")
fi

echo "Executing: gcloud ${CMD[*]}"
gcloud "${CMD[@]}"
