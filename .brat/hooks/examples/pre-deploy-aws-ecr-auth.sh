#!/bin/bash
#
# Example: AWS ECR Authentication
# Hook Type: pre-deploy
# Purpose: Authenticate to Amazon Elastic Container Registry
#
# Environment Variables Required:
# - AWS_REGION: AWS region (e.g., us-east-1)
# - AWS_ACCOUNT_ID: AWS account ID
# - AWS credentials via one of:
#   - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (stored in .secure.{context}/.env)
#   - IAM role (if running on EC2/ECS)
#   - AWS SSO session
#
# Prerequisites:
# - AWS CLI v2 installed
#
# Usage:
# 1. Configure AWS credentials
# 2. Set environment variables in .secure.{context}/.env:
#    AWS_REGION=us-east-1
#    AWS_ACCOUNT_ID=123456789012
#    AWS_ACCESS_KEY_ID=AKIA...
#    AWS_SECRET_ACCESS_KEY=xxx...
# 3. Configure in architecture.yaml:
#    executionContexts:
#      staging:
#        deployment:
#          hooks:
#            pre-deploy: .brat/hooks/examples/pre-deploy-aws-ecr-auth.sh
#

set -e
set -u

log() {
  echo "[aws-ecr-auth] $*"
}

log "Authenticating to AWS ECR..."

# Check required environment variables
if [ -z "${AWS_REGION:-}" ]; then
  log "ERROR: AWS_REGION not set"
  exit 1
fi

if [ -z "${AWS_ACCOUNT_ID:-}" ]; then
  log "ERROR: AWS_ACCOUNT_ID not set"
  exit 1
fi

# Construct ECR registry URL
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

log "Authenticating to ${ECR_REGISTRY}..."

# Get ECR login password and authenticate Docker
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${ECR_REGISTRY}"

log "✓ Successfully authenticated to AWS ECR"
exit 0
