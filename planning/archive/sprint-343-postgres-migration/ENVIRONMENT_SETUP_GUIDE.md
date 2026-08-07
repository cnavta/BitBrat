# Environment Setup Guide for PostgreSQL Migration Testing

**Date**: 2026-07-16
**Purpose**: Prepare local environment for end-to-end testing with PostgreSQL backend

---

## Quick Start

```bash
# 1. Start local Docker stack
npm run local

# 2. Wait for all services to be healthy (2-3 minutes)
docker ps | grep bitbrat

# 3. Verify PostgreSQL migrations
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "\dt"

# 4. Seed test data
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export GOOGLE_CLOUD_PROJECT="bitbrat-local"
npm run test-migration seed 1000

# 5. Run chat with PostgreSQL
export PERSISTENCE_DRIVER=postgres
npm run brat -- chat
```

---

## Detailed Setup

### Step 1: Prerequisites

**Install Dependencies**:
```bash
# Node.js 24+ and npm
node --version  # Should be v24.x.x

# Docker Desktop or Docker Engine
docker --version

# PostgreSQL client (for manual queries)
psql --version
```

**Build the Platform**:
```bash
# Install npm dependencies
npm install

# Build TypeScript
npm run build

# Verify build succeeded
ls -la dist/
```

### Step 2: Start Local Stack

**Launch Docker Compose**:
```bash
# Start all services with Loki logging
npm run local

# Or without Loki
npm run brat -- docker up --env local
```

**Monitor Startup**:
```bash
# Watch logs (in separate terminal)
npm run local:logs

# Or specific service
docker logs -f ingress-egress.bitbrat.local
```

**Wait for Health Checks**:
```bash
# All services should show "healthy" or "Up"
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Expected containers:
- `postgres.bitbrat.local` - PostgreSQL database
- `nats.bitbrat.local` - NATS JetStream message bus
- `firebase-emulator.bitbrat.local` - Firestore emulator
- `ingress-egress.bitbrat.local` - Ingress/Egress service
- `event-router.bitbrat.local` - Event router
- `llm-bot.bitbrat.local` - LLM bot service
- `state-engine.bitbrat.local` - State engine
- `persistence.bitbrat.local` - Persistence service
- And more...

### Step 3: Verify PostgreSQL Setup

**Check PostgreSQL is Running**:
```bash
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "SELECT version();"
```

**List Tables**:
```bash
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "\dt"
```

**Expected tables** (from migrations):
```
 events
 snapshots
 sources
 state
 mutation_log
 routing_rules
 context_packs
 service_registry
 auth_users
 auth_scopes
 user_state
 global_state
 sessions
 conversation_history
 llm_responses
 integration_configs
 metrics
```

**Verify pgvector Extension**:
```bash
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

**Check Vector Index on context_packs**:
```bash
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "\d context_packs"
```

Should show `embedding vector(1536)` column with IVFFLAT index.

### Step 4: Apply Migrations

Migrations are automatically applied during Docker initialization via `/docker-entrypoint-initdb.d`.

**Manual migration application** (if needed):
```bash
# Migration 001: Rename commands to routing_rules
docker exec -i bitbrat-postgres psql -U bitbrat -d bitbrat < infrastructure/postgres/migrations/001-rename-commands-to-routing-rules.sql

# Migration 002: Add persistence tables
docker exec -i bitbrat-postgres psql -U bitbrat -d bitbrat < infrastructure/postgres/migrations/002-add-persistence-tables.sql
```

**Verify migration status**:
```bash
# Check for new tables
docker exec -it bitbrat-postgres psql -U bitbrat -d bitbrat -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
```

### Step 5: Seed Test Data

**Set environment variables**:
```bash
export DATABASE_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export GOOGLE_CLOUD_PROJECT="bitbrat-local"
export PERSISTENCE_DRIVER=postgres
```

**Seed PostgreSQL**:
```bash
# Seed 1000 test documents
npm run test-migration seed 1000
```

**Seed Firestore** (for cross-backend testing):
```bash
# Use existing seed script or backup import
npm run brat -- setup
```

**Verify seeded data**:
```bash
# PostgreSQL counts
psql $DATABASE_URL -c "SELECT COUNT(*) FROM routing_rules"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM context_packs"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM auth_users"

# Firestore counts
npm run brat -- backup list --json | jq '.collections | length'
```

### Step 6: Environment Variables

**Create `.env.local` file** (optional, for persistent config):
```bash
cat > .env.local <<EOF
# PostgreSQL
DATABASE_URL=postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat
PERSISTENCE_DRIVER=postgres

# Firestore
FIRESTORE_EMULATOR_HOST=localhost:8080
GOOGLE_CLOUD_PROJECT=bitbrat-local

# NATS
NATS_URL=nats://localhost:4222

# Logging
LOG_LEVEL=debug
EOF
```

**Load environment**:
```bash
source .env.local
```

### Step 7: Verify Chat Setup

**Test Firestore backend**:
```bash
export PERSISTENCE_DRIVER=firestore
npm run brat -- chat <<EOF
!help
exit
EOF
```

**Test PostgreSQL backend**:
```bash
export PERSISTENCE_DRIVER=postgres
npm run brat -- chat <<EOF
!help
exit
EOF
```

Both should complete without errors.

---

## Troubleshooting

### Container Not Starting

**Check Docker logs**:
```bash
docker logs bitbrat-postgres
docker logs firebase-emulator.bitbrat.local
```

**Restart specific service**:
```bash
docker restart bitbrat-postgres
```

**Rebuild service**:
```bash
docker compose -f infrastructure/docker-compose/local.docker-compose.yaml build postgres
docker compose -f infrastructure/docker-compose/local.docker-compose.yaml up -d postgres
```

### PostgreSQL Connection Refused

**Check if PostgreSQL is listening**:
```bash
docker exec -it bitbrat-postgres pg_isready -U bitbrat
```

**Check port binding**:
```bash
docker port bitbrat-postgres 5432
```

Should show `0.0.0.0:5432`.

**Test connection from host**:
```bash
psql "postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat" -c "SELECT 1"
```

### Missing Tables

**Check if migrations ran**:
```bash
docker logs bitbrat-postgres | grep -i "migration"
```

**Manually apply migrations**:
```bash
docker exec -i bitbrat-postgres psql -U bitbrat -d bitbrat < infrastructure/postgres/migrations/002-add-persistence-tables.sql
```

### Firestore Emulator Not Running

**Check emulator logs**:
```bash
docker logs firebase-emulator.bitbrat.local
```

**Verify emulator UI is accessible**:
```bash
curl http://localhost:4000
```

**Restart emulator**:
```bash
docker restart firebase-emulator.bitbrat.local
```

### NATS Connection Issues

**Check NATS logs**:
```bash
docker logs nats.bitbrat.local
```

**Test NATS connection**:
```bash
nats --server nats://localhost:4222 server ping
```

### Chat Command Not Working

**Verify environment variables**:
```bash
echo $PERSISTENCE_DRIVER
echo $DATABASE_URL
echo $FIRESTORE_EMULATOR_HOST
```

**Check service logs**:
```bash
docker logs llm-bot.bitbrat.local
docker logs event-router.bitbrat.local
docker logs persistence.bitbrat.local
```

**Run chat with debug logging**:
```bash
export LOG_LEVEL=debug
npm run brat -- chat
```

---

## Health Check Commands

**Quick health check**:
```bash
# PostgreSQL
psql $DATABASE_URL -c "SELECT 1"

# Firestore emulator
curl http://localhost:8080

# NATS
curl http://localhost:8222/healthz

# All services
docker ps --filter "name=bitbrat" --format "table {{.Names}}\t{{.Status}}"
```

**Detailed health check**:
```bash
# PostgreSQL stats
psql $DATABASE_URL -c "SELECT datname, numbackends FROM pg_stat_database WHERE datname='bitbrat'"

# Table sizes
psql $DATABASE_URL -c "SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC"

# Row counts
psql $DATABASE_URL -c "SELECT tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC"
```

---

## Cleanup

**Stop all services**:
```bash
npm run local:down
```

**Remove all data (full reset)**:
```bash
docker compose -f infrastructure/docker-compose/local.docker-compose.yaml down -v
```

**Remove Docker images (to rebuild)**:
```bash
docker images | grep bitbrat | awk '{print $3}' | xargs docker rmi
```

**Clean npm build artifacts**:
```bash
rm -rf dist/ node_modules/.cache
npm run build
```

---

## Testing Checklist

Before running the test plan, verify:

- [ ] All Docker containers are running
- [ ] PostgreSQL has all tables (17 tables expected)
- [ ] pgvector extension is installed
- [ ] Test data is seeded (1000+ documents)
- [ ] Firestore emulator is accessible
- [ ] NATS is healthy
- [ ] Environment variables are set
- [ ] `brat chat` command works with Firestore
- [ ] `brat chat` command works with PostgreSQL
- [ ] No errors in service logs

If all checks pass, proceed to **BRAT_CHAT_TEST_PLAN.md**.

---

## Next Steps

1. Complete environment setup using this guide
2. Run through **BRAT_CHAT_TEST_PLAN.md** scenarios
3. Document test results
4. Report any issues or failures
5. Proceed to Phase 3 (Production Rollout) if all tests pass
