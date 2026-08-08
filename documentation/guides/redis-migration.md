# Redis Migration Guide for Existing Contexts

**Status**: Current
**Created**: 2026-08-07
**Related**: Sprint 1 (Redis Idempotency), Sprint 2 (BEC Generation Gaps)

---

## Overview

Sprint 1 introduced Redis-based distributed idempotency to prevent duplicate message processing. Sprint 2 updated the BEC generation tooling to automatically include Redis configuration for **all new contexts created after 2026-08-07**.

**If you have existing custom execution contexts created before Sprint 2**, they will be missing Redis configuration and need manual migration.

---

## Affected Contexts

### Check If Your Context Needs Migration

Run this command to check if your context has Redis configuration:

```bash
grep -i "REDIS" env/<your-context>/global.yaml
```

**If the command returns nothing** or **only shows `REDIS_URL`** without idempotency variables, your context needs migration.

### Which Contexts Are Affected?

- ✅ **`local`**: Manually updated in Sprint 2 (no migration needed)
- ✅ **`staging`**: Manually updated in Sprint 1 (no migration needed)
- ❌ **Custom contexts created before 2026-08-07**: Need manual migration
- ✅ **New contexts created after 2026-08-07**: Automatically include Redis

---

## Migration Steps

### Step 1: Add Redis Configuration to global.yaml

Add the following Redis configuration to `env/<your-context>/global.yaml`:

```yaml
# Redis Configuration (Sprint 1+: Distributed Idempotency Layer)
# Sprint 1+: Redis is used for distributed idempotency and deduplication
# Connection URL format: redis://host:port
# Default: redis container (local), managed Redis for staging/prod
REDIS_URL: "redis://redis:6379"

# REDIS_IDEMPOTENCY_ENABLED: Enable idempotency middleware for duplicate detection
# When true: Uses Redis SET NX EX pattern to prevent duplicate message processing
# When false: Idempotency layer is disabled (fail-open)
# Default: true (prevents debug trace message re-delivery after platform re-deployments)
REDIS_IDEMPOTENCY_ENABLED: true

# REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: Default time-to-live for idempotency keys
# Duration (in seconds) that idempotency keys remain in Redis
# After TTL expires, the same message can be reprocessed
# Default: 300 seconds (5 minutes) - sufficient for typical message redelivery scenarios
# Used when message/subscription doesn't specify custom TTL
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: 300
```

**Placement**: Add this block after the `PERSISTENCE_TTL_DAYS` variable and before the `STORAGE_DRIVER` variable (if present).

---

### Step 2: Add Redis Service to docker-compose File

**For docker-compose contexts only** (not cloud-run or k8s):

Add the Redis service to your `infrastructure/docker-compose/docker-compose.<your-context>.yaml`:

```yaml
services:
  # ... existing services ...

  redis:
    image: redis:7-alpine
    container_name: ${COMPOSE_PROJECT_NAME}-redis
    command: redis-server --appendonly yes
    networks:
      - bitbrat-network
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 5s
    restart: unless-stopped

# ... existing services ...

volumes:
  # ... existing volumes ...
  redis-data: {}
```

**Important**: Ensure `redis-data` is added to the `volumes` section at the bottom of the file.

---

### Step 3: Update Service Dependencies

For services using idempotency (`ingress-egress`, `auth`, `llm-bot`), add Redis to their `depends_on`:

**Before:**
```yaml
services:
  auth:
    # ... other config ...
    depends_on:
      nats:
        condition: service_healthy
      postgres:
        condition: service_healthy
```

**After:**
```yaml
services:
  auth:
    # ... other config ...
    depends_on:
      nats:
        condition: service_healthy
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
```

**Services to update** (if present in your context):
- `ingress-egress`
- `auth`
- `llm-bot`

---

### Step 4: Restart and Validate

1. **Stop the existing stack**:
   ```bash
   npm run brat -- docker down --context <your-context>
   ```

2. **Start with Redis**:
   ```bash
   npm run brat -- docker up --context <your-context>
   ```

3. **Verify Redis is running**:
   ```bash
   docker ps | grep <your-context> | grep redis
   ```

   Expected output:
   ```
   bitbrat-<context>-redis   redis:7-alpine   ...   Up (healthy)   ...
   ```

4. **Test Redis connectivity**:
   ```bash
   docker exec bitbrat-<context>-redis redis-cli ping
   ```

   Expected output:
   ```
   PONG
   ```

5. **Check idempotency logs** (for services using idempotency):
   ```bash
   docker logs bitbrat-<context>-auth 2>&1 | grep idempotency
   ```

   Expected output (similar to):
   ```
   [info] Idempotency middleware active (Redis: redis://redis:6379, TTL: 300s)
   ```

---

## Validation Checklist

After migration, verify the following:

- [ ] `env/<context>/global.yaml` contains all three Redis variables (`REDIS_URL`, `REDIS_IDEMPOTENCY_ENABLED`, `REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS`)
- [ ] `docker-compose.<context>.yaml` includes `redis` service
- [ ] `docker-compose.<context>.yaml` includes `redis-data` volume
- [ ] Idempotency services (`ingress-egress`, `auth`, `llm-bot`) depend on Redis
- [ ] `docker ps` shows Redis container as `healthy`
- [ ] `redis-cli ping` returns `PONG`
- [ ] Service logs confirm idempotency middleware is active

---

## Troubleshooting

### Redis Container Not Starting

**Symptom**: `docker ps` shows Redis container as `starting` or `unhealthy`

**Solution**:
1. Check Redis logs: `docker logs bitbrat-<context>-redis`
2. Verify port 6379 is not in use: `lsof -i :6379` (local) or `netstat -an | grep 6379` (remote)
3. Ensure `redis-data` volume is defined in `volumes` section

---

### Services Fail to Start (Waiting for Redis)

**Symptom**: Services log "waiting for redis" or similar dependency messages

**Solution**:
1. Verify Redis healthcheck is passing: `docker inspect bitbrat-<context>-redis | grep Health`
2. Increase Redis `start_period` in healthcheck (currently 5s, try 10s)
3. Restart stack: `npm run brat -- docker down && npm run brat -- docker up`

---

### Idempotency Not Active (Logs Show "Fail-Open")

**Symptom**: Service logs show "idempotency middleware disabled" or "fail-open mode"

**Possible Causes**:
1. **`REDIS_IDEMPOTENCY_ENABLED`** is set to `false` in `global.yaml`
2. **`REDIS_URL`** is incorrect or Redis is not reachable
3. Service was started before Redis became healthy (transient issue)

**Solution**:
1. Verify `REDIS_IDEMPOTENCY_ENABLED: true` in `env/<context>/global.yaml`
2. Verify `REDIS_URL` matches Redis container hostname (`redis://redis:6379`)
3. Restart the service: `docker restart bitbrat-<context>-auth`

---

### Port Conflicts

**Symptom**: Redis fails to start with "port already allocated" error

**Solution**:
1. Check if another Redis instance is running: `docker ps | grep redis`
2. Stop conflicting container or change port in compose file
3. For local development, ensure only one context is running at a time

---

## Cloud Platform Deployments

### Cloud Run (GCP)

Redis configuration for Cloud Run contexts:

1. **Provision managed Redis** (Cloud Memorystore):
   ```bash
   gcloud redis instances create bitbrat-redis \
     --size=1 \
     --region=us-central1 \
     --redis-version=redis_7_0
   ```

2. **Get Redis internal IP**:
   ```bash
   gcloud redis instances describe bitbrat-redis --region=us-central1 --format="get(host)"
   ```

3. **Update environment variables** (via Secret Manager or direct env vars):
   ```
   REDIS_URL=redis://<internal-ip>:6379
   REDIS_IDEMPOTENCY_ENABLED=true
   REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS=300
   ```

4. **Ensure VPC connector** allows Cloud Run services to reach Redis internal IP

---

### Kubernetes

Redis configuration for K8s contexts:

1. **Deploy Redis via Helm** or use managed Redis (AWS ElastiCache, Azure Cache for Redis)
2. **Create Kubernetes Secret** with Redis connection details
3. **Mount secret** as environment variables in service deployments
4. **Update service dependencies** to ensure Redis is available before services start

---

## Migration for Agent-Dev Contexts

Agent-dev contexts provisioned before Sprint 2 also need manual migration.

**Quick Migration**:
1. Follow Steps 1-4 above
2. Replace `<your-context>` with `agent-dev-*` (your specific agent-dev context name)
3. Restart via MCP tool: `agent_dev.stop()` then `agent_dev.start()`

**Alternative**: Destroy and recreate agent-dev context (auto-includes Redis):
```javascript
agent_dev.destroy({ name: 'agent-dev-old', confirm: true })
agent_dev.provision()  // New context auto-includes Redis (Sprint 2+)
```

---

## Verification Script

Save this as `verify-redis-migration.sh` to validate your migration:

```bash
#!/bin/bash
CONTEXT="${1:-local}"

echo "Verifying Redis migration for context: $CONTEXT"
echo "=============================================="

# Check global.yaml
echo -e "\n1. Checking env/$CONTEXT/global.yaml..."
if grep -q "REDIS_URL" "env/$CONTEXT/global.yaml" && \
   grep -q "REDIS_IDEMPOTENCY_ENABLED" "env/$CONTEXT/global.yaml" && \
   grep -q "REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS" "env/$CONTEXT/global.yaml"; then
  echo "✅ All Redis variables present"
else
  echo "❌ Missing Redis variables"
  exit 1
fi

# Check docker-compose file
echo -e "\n2. Checking docker-compose file..."
COMPOSE_FILE="infrastructure/docker-compose/docker-compose.$CONTEXT.yaml"
if [ -f "$COMPOSE_FILE" ]; then
  if grep -q "redis:" "$COMPOSE_FILE" && grep -q "redis-data:" "$COMPOSE_FILE"; then
    echo "✅ Redis service and volume present"
  else
    echo "❌ Missing Redis service or volume"
    exit 1
  fi
else
  echo "⚠️  Compose file not found (may be cloud-run or k8s context)"
fi

# Check running containers
echo -e "\n3. Checking running containers..."
if docker ps | grep -q "$CONTEXT.*redis"; then
  echo "✅ Redis container running"

  # Test connectivity
  REDIS_CONTAINER=$(docker ps --filter "name=$CONTEXT.*redis" --format "{{.Names}}")
  if docker exec "$REDIS_CONTAINER" redis-cli ping 2>&1 | grep -q "PONG"; then
    echo "✅ Redis responds to ping"
  else
    echo "❌ Redis not responding"
    exit 1
  fi
else
  echo "⚠️  Redis container not running (start stack first)"
fi

echo -e "\n=============================================="
echo "✅ Redis migration validated successfully!"
```

**Usage**:
```bash
chmod +x verify-redis-migration.sh
./verify-redis-migration.sh <your-context>
```

---

## Summary

**What You Did**:
1. Added 3 Redis environment variables to `global.yaml`
2. Added Redis service and `redis-data` volume to `docker-compose` file
3. Updated service dependencies for idempotency services
4. Restarted stack and validated Redis is healthy

**What Changed**:
- New contexts created after Sprint 2 automatically include this configuration
- Your existing context now matches the reference configuration
- Idempotency middleware is now active (prevents duplicate message processing)

**Need Help?**
- Check Sprint 1 artifacts: `planning/sprint-1-9ih2e3/`
- Check Sprint 2 artifacts: `planning/sprint-2-8olsv2/`
- Review reference implementation: `env/staging/global.yaml` and `infrastructure/docker-compose/docker-compose.staging.yaml`

---

**Last Updated**: 2026-08-07 (Sprint 2)
