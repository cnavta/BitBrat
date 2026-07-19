#!/bin/bash

# Staging Migration Script
# Migrates data from staging Firestore to staging PostgreSQL

# Set environment variables for staging
export FIRESTORE_EMULATOR_HOST="bitbrat.lan:8080"
export GCLOUD_PROJECT="bitbrat-local"

# PostgreSQL connection via SSH tunnel
# We'll use SSH port forwarding to connect to staging PostgreSQL
echo "Setting up SSH tunnel to staging PostgreSQL..."
ssh -f -N -L 5433:localhost:5432 root@bitbrat.lan

# Wait for tunnel to establish
sleep 2

# Set PostgreSQL connection to use the tunnel
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5433/bitbrat"

echo "Running migration to staging..."
npm run brat -- migrate all

# Close the tunnel
echo "Closing SSH tunnel..."
pkill -f "ssh -f -N -L 5433:localhost:5432 root@bitbrat.lan"

echo "Migration complete!"
