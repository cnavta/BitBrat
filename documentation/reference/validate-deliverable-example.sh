#!/usr/bin/env bash
set -euo pipefail

# Copy this template into the sprint directory, then replace each placeholder
# with a real command or an explicit not-applicable record from the approved plan.

echo "Install dependencies"
<install-command>

echo "Build"
<build-command>

echo "Test"
<test-command>

echo "Run applicable integration, runtime, health, and deployment checks"
<applicable-checks>

echo "Validation complete"
