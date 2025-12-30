#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Checking for required files..."
ls architecture.yaml
ls planning/sprint-183-lb-https/sprint-manifest.yaml
ls planning/sprint-183-lb-https/implementation-plan.md
ls planning/sprint-183-lb-https/verification-report.md
ls planning/sprint-183-lb-https/retro.md

echo "🧪 Running tests..."
npm test tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts

echo "✅ Validation complete."
