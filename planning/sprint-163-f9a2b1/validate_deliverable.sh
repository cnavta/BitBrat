#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🏗️ Synthesizing infrastructure..."
# Synthesize network
npx ts-node -e "require('./tools/brat/src/providers/cdktf-synth').synthModule('network',{rootDir: process.cwd(), env: 'dev', projectId: 'bitbrat-demo'})"
# Synthesize load-balancer
npx ts-node -e "require('./tools/brat/src/providers/cdktf-synth').synthModule('load-balancer',{rootDir: process.cwd(), env: 'dev', projectId: 'bitbrat-demo'})"

echo "🧪 Validating synthesized Terraform..."
cd infrastructure/cdktf/out/network
terraform init -backend=false
terraform validate
cd ../../../..

cd infrastructure/cdktf/out/load-balancer
terraform init -backend=false
terraform validate
cd ../../../..

echo "✅ Validation complete."
