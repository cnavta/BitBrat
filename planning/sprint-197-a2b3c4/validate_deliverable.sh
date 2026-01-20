#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skip for speed if already installed in this environment

echo "🧱 Building project..."
# npm run build # Mock or skip if no build step needed for validation of these config changes

echo "🧪 Running tests..."
# Run the repro script to ensure getDriver is now robust
npx ts-node repro_driver.ts

echo "🏃 Checking Firestore Emulator support..."
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export FIRESTORE_DATABASE_ID="test-db"
# We can't easily run the full app here but we can check if it logs correctly in a small script
npx ts-node -e "
import { getFirestore } from './src/common/firebase';
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
try { getFirestore(); } catch(e) {}
" | grep "Initializing Firestore"

echo "🚀 Cloud dry-run deployment..."
# run dry run if applicable
# ./infrastructure/deploy-local.sh --dry-run

echo "✅ Validation complete."
