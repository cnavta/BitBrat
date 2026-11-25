# New Staging Box Setup Recommendations

**Date**: 2026-11-25
**Context**: Sprint 66 completion - Setting up new staging box with more memory
**Current Staging**: bitbrat.lan (Intel N100, 7.5GB RAM, 109.7GB eMMC)

## Executive Summary

The current staging environment (bitbrat.lan) is running on **constrained hardware** (Intel N100, 7.5GB RAM) that is **insufficient** for the BitBrat platform's growing resource demands. Sprint 66 exposed critical memory and performance bottlenecks:

- **Tool-orchestrator SSE buffer overflow**: 504 tools exceeded memory/socket limits
- **PostgreSQL connection pool pressure**: 100 max connections with 505 concurrent tool registrations
- **Loki log storage explosion**: 4.9GB of logs consuming 65% of available disk space
- **eMMC/SD card storage at 72% capacity**: Limited headroom for future growth

**Recommendation**: Minimum **16GB RAM** (32GB ideal), **SSD storage** (NVMe preferred), and modern multi-core CPU (6+ cores) for staging environment to match production workloads and prevent resource-related failures.

---

## 1. Current Staging Environment Analysis

### Hardware Specifications

| Component | Current (bitbrat.lan) | Status |
|-----------|----------------------|--------|
| **CPU** | Intel N100 (4 cores @ 1.4GHz) | ⚠️ **Low-power CPU** - bottleneck for 19 concurrent services |
| **RAM** | 7.5GB (7.0GB available) | ❌ **CRITICAL** - Insufficient for platform workload |
| **Storage** | 109.7GB eMMC/SD card | ❌ **CRITICAL** - Slow I/O, 72% full (29GB free) |
| **Swap** | 4GB | ⚠️ Limited swap space for memory pressure |
| **Network** | Local network (bitbrat.lan) | ✅ Adequate for staging |

### Software & Infrastructure

| Component | Version | Status |
|-----------|---------|--------|
| **OS** | Alpine Linux 3.23.4 | ✅ Latest stable |
| **Kernel** | 6.18.34-0-lts | ✅ Modern LTS kernel |
| **Docker** | 29.5.2 | ✅ Latest stable |
| **Docker Compose** | v2.40.3 | ✅ Latest stable |

### Current Resource Utilization

**Docker Volumes** (as of Sprint 66):
```
Loki logs:              4.9GB    (65% of available disk space)
PostgreSQL data:        407MB
NATS data:              24.4MB
Redis data:             32KB
Promtail positions:     713KB
Ollama data:            2.5KB
```

**Deployment Directory** (`/opt/bitbrat-staging`):
```
dist/:                  9.5MB    (Compiled TypeScript)
src/:                   5.8MB    (Source code)
tools/:                 4.0MB    (Brat CLI)
infrastructure/:        436KB
package-lock.json:      492KB
```

**Total Disk Usage**: ~75GB / 109.7GB (72% full)

### Critical Issues Identified

1. **Memory Pressure** (Sprint 66 Issue #6):
   - Tool-orchestrator crashed attempting to serialize 504 tools
   - PostgreSQL needs 512MB shared_buffers + 100 connection pool
   - 19 active services + infrastructure competing for 7.5GB RAM
   - **Insufficient headroom** for LLM operations, image generation, concurrent tool execution

2. **Storage Bottlenecks**:
   - **eMMC/SD card I/O latency** (10-100x slower than SSD)
   - Loki logs growing unbounded (4.9GB, no rotation policy)
   - PostgreSQL WAL/checkpoint writes suffer from slow storage
   - Only 29GB free space (72% full) - limited headroom

3. **CPU Constraints**:
   - Intel N100 is low-power processor (6W TDP)
   - 4 cores @ 1.4GHz struggling with 19 concurrent services
   - LLM operations, image generation, event processing all CPU-bound

4. **Legacy Volume Cleanup Needed**:
   - Multiple old deployment contexts (wankle, zoozie, torantoo) consuming disk space
   - Unused volumes from previous deployments

---

## 2. Platform Resource Requirements

### Service Inventory (19 Active Services)

**Platform Services** (11):
- `ingress-egress` (profile: gateway)
- `auth` (profile: gateway)
- `event-router` (profile: gateway)
- `query-analyzer` (profile: llm)
- `llm-bot` (profile: llm)
- `persistence` (profile: core)
- `api-gateway` (profile: gateway)
- `disposition-service` (profile: core)
- `claim-check` (profile: core)
- `utility` (profile: core)
- `tool-orchestrator` (profile: core)

**Domain Services** (6):
- `oauth-flow` (profile: gateway)
- `scheduler` (profile: mcp-server)
- `state-engine` (profile: mcp-server)
- `image-gen-mcp` (profile: mcp-server)
- `story-engine-mcp` (profile: mcp-server)
- `reflex` (profile: mcp-server)

**Infrastructure Services** (4):
- `postgres` (PostgreSQL 15-alpine)
- `nats` (NATS 2.10-alpine)
- `redis` (Redis 7-alpine)
- `loki` (Grafana Loki for logs, Sprint 59)

### Memory Requirements (Staging Configuration)

**Infrastructure Services**:
```yaml
PostgreSQL:
  shared_buffers: 512MB            # From architecture.yaml staging config
  effective_cache_size: 1GB
  max_connections: 100
  work_mem: 10MB per connection    # Up to 1GB for concurrent queries
  Total: ~1.5-2GB base + query overhead

NATS:
  NATS_JETSTREAM_MAX_MEM: -1       # Unlimited (uses NATS_JETSTREAM_MAX_FILE instead)
  NATS_JETSTREAM_MAX_FILE: 10Gi    # Disk-backed, minimal RAM
  Total: ~100-200MB

Redis:
  maxmemory: 1gb                   # From architecture.yaml staging config
  Total: ~1GB

Loki:
  Estimated: ~500MB-1GB            # Log ingestion/query engine
```

**Application Services** (19 services × avg 150-300MB each):
- Minimal per-service overhead: ~100-150MB
- LLM services (llm-bot, query-analyzer): 200-500MB each
- Gateway services (ingress-egress, api-gateway, event-router): 150-300MB each
- MCP servers: 100-200MB each
- **Total application memory**: ~3-5GB

**Operating System + Docker**:
- Alpine Linux base: ~100MB
- Docker daemon: ~200-300MB
- Kernel buffers/cache: ~500MB-1GB

**Total Baseline Memory**: ~6-10GB **without** active workloads

**Peak Memory (Active Workloads)**:
- LLM inference (OpenAI API calls): +500MB-1GB (request/response buffers)
- Image generation (DALL-E): +200-500MB (image processing)
- Tool-orchestrator with 504 tools: +500MB-1GB (tool metadata, MCP protocol overhead)
- Concurrent user sessions (10-20 active): +500MB-1GB
- **Peak total**: ~10-15GB

**Recommended RAM**: **16GB minimum** (32GB ideal for headroom)

### Storage Requirements

**Persistent Volumes**:
```
PostgreSQL data:        2-5GB       (events, tool registry, state)
Loki logs:              10-20GB     (with rotation/retention)
NATS data:              1-2GB       (JetStream file storage)
Redis snapshots:        100-500MB   (AOF persistence)
Ollama models:          0-10GB      (if using local LLM)
Application storage:    1-5GB       (images, generated files)
```

**Docker Images** (~10-15GB):
- Base images (Node 24, Alpine, Postgres, etc.)
- Service images (19 × ~300-500MB avg)

**Source Code + Build Artifacts** (~1GB):
- `/opt/bitbrat-staging` deployment directory

**Total Storage Need**: **50-100GB minimum** (100GB+ recommended for growth)

**Storage Type**: **SSD (NVMe preferred)** for:
- PostgreSQL WAL writes (critical for ACID durability)
- NATS JetStream message persistence
- Loki log ingestion (high I/O)
- Docker layer caching (build performance)

### CPU Requirements

**Workload Characteristics**:
- **Event-driven architecture**: High concurrency, low latency
- **LLM operations**: CPU-bound (JSON serialization, prompt processing)
- **PostgreSQL**: CPU-intensive for queries, indexing, vacuuming
- **Docker Compose**: 19+ concurrent containers

**Recommended CPU**:
- **Minimum**: 6 cores (modern x86_64, 2.5GHz+ base clock)
- **Ideal**: 8-12 cores (Intel i5/i7, AMD Ryzen 5/7, or equivalent)
- **Architecture**: x86_64 (ARM64 supported but less tested)

---

## 3. Recommended Hardware Specifications

### Option 1: Budget-Friendly Staging Box (Minimum Viable)

| Component | Specification | Rationale |
|-----------|--------------|-----------|
| **CPU** | Intel i5-12400 (6 cores/12 threads @ 2.5GHz) or AMD Ryzen 5 5600 (6 cores/12 threads @ 3.5GHz) | Balanced price/performance, sufficient for staging workloads |
| **RAM** | **16GB DDR4** (single-channel OK) | 2x current capacity, adequate for 19 services + infrastructure |
| **Storage** | **256GB NVMe SSD** (PCIe 3.0 or better) | Fast I/O, enough for platform + logs with rotation |
| **Network** | 1 Gbps Ethernet | Adequate for staging (matches bitbrat.lan) |
| **Budget** | ~$300-500 (Mini PC or used server) | Cost-effective upgrade path |

**Expected Performance**:
- ✅ Handles 19 services + infrastructure comfortably
- ✅ Supports concurrent LLM operations and image generation
- ✅ PostgreSQL query performance 10-50x faster than eMMC
- ⚠️ Limited headroom for heavy development/testing workloads

### Option 2: Production-Equivalent Staging Box (Recommended)

| Component | Specification | Rationale |
|-----------|--------------|-----------|
| **CPU** | Intel i7-13700 (16 cores/24 threads @ 2.1GHz) or AMD Ryzen 7 7700 (8 cores/16 threads @ 3.8GHz) | Matches production-class performance, future-proof |
| **RAM** | **32GB DDR4** (dual-channel) | Comfortable headroom for peak workloads, matches production |
| **Storage** | **512GB NVMe SSD** (PCIe 4.0) + optional **1TB HDD** (logs/backups) | High-performance primary storage, cheap bulk storage |
| **Network** | 1 Gbps Ethernet (2.5 Gbps optional) | Fast enough for staging |
| **Budget** | ~$600-1000 (Mini PC, NUC, or server) | Best price/performance ratio |

**Expected Performance**:
- ✅ Exceeds production workload requirements
- ✅ Comfortable headroom for development, load testing, concurrent users
- ✅ Fast builds, quick deployments, responsive services
- ✅ Future-proof for 2-3 years of platform growth

### Option 3: High-Performance Staging/Production Box (Ideal)

| Component | Specification | Rationale |
|-----------|--------------|-----------|
| **CPU** | Intel Xeon E-2388G (8 cores/16 threads @ 3.2GHz) or AMD EPYC 7313P (16 cores/32 threads @ 3.0GHz) | Server-class reliability, ECC RAM support |
| **RAM** | **64GB DDR4 ECC** (dual-channel) | Maximum headroom, error-correcting memory for data integrity |
| **Storage** | **1TB NVMe SSD** (PCIe 4.0, enterprise-grade) + **2TB HDD** (RAID 1 for backups) | Enterprise reliability, ample space for logs/backups |
| **Network** | 2.5 Gbps or 10 Gbps Ethernet | Overkill for staging but future-proof |
| **Budget** | ~$1500-2500 (Server-grade hardware) | Production-ready if needed |

**Expected Performance**:
- ✅ Can handle production workloads if needed (failover/backup)
- ✅ Extreme headroom for load testing, concurrent development
- ✅ ECC RAM prevents data corruption (critical for PostgreSQL)
- ✅ Enterprise-grade reliability for mission-critical testing

---

## 4. Operating System Recommendations

### Recommended: Alpine Linux 3.23+ (Current Choice)

**Pros**:
- ✅ **Minimal footprint**: ~100MB RAM base (vs 500MB-1GB for Ubuntu/Debian)
- ✅ **Security**: musl libc, hardened by default, minimal attack surface
- ✅ **Fast boot times**: 5-10 seconds
- ✅ **apk package manager**: Fast, lightweight, designed for containers
- ✅ **Already validated**: Current staging uses Alpine 3.23.4

**Cons**:
- ⚠️ **musl libc compatibility**: Some tools expect glibc (rare edge cases)
- ⚠️ **Smaller package repository**: Fewer pre-built packages than Debian/Ubuntu
- ⚠️ **Different tooling**: Uses OpenRC instead of systemd (learning curve)

**Recommendation**: **Keep Alpine Linux 3.23+** for consistency with current staging setup.

### Alternative: Ubuntu Server 24.04 LTS

**Pros**:
- ✅ **Wide compatibility**: glibc, largest package repository
- ✅ **Long-term support**: 5 years of security updates
- ✅ **Familiar tooling**: systemd, apt, standard GNU tools
- ✅ **Better documentation**: More community resources

**Cons**:
- ❌ **Larger footprint**: ~500MB-1GB RAM base
- ❌ **Slower boot times**: 20-30 seconds
- ❌ **More background services**: systemd, snapd, etc.

**Recommendation**: Only if Alpine compatibility issues arise.

### Alternative: Debian 12 (Bookworm)

**Pros**:
- ✅ **Stability-focused**: "Universal Operating System"
- ✅ **Wide compatibility**: glibc, large package repository
- ✅ **Minimal by default**: Lighter than Ubuntu

**Cons**:
- ❌ **Larger than Alpine**: ~300-500MB RAM base
- ❌ **Slower package updates**: Stability over bleeding-edge

**Recommendation**: Good middle ground if Alpine is too minimal.

---

## 5. Step-by-Step Migration Plan

### Phase 1: Pre-Migration (Preparation)

**Timeline**: 1-2 hours

#### 1.1 Backup Current Staging Environment

```bash
# SSH into current staging box
ssh root@bitbrat.lan

# Stop all services
cd /opt/bitbrat-staging
docker-compose down

# Backup PostgreSQL data
docker run --rm -v bitbrat-staging_postgres-data:/data -v $(pwd):/backup \
  postgres:15-alpine tar czf /backup/postgres-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .

# Backup Redis data (if needed)
docker run --rm -v bitbrat-staging_redis-data:/data -v $(pwd):/backup \
  redis:7-alpine tar czf /backup/redis-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .

# Backup NATS data (if needed)
docker run --rm -v bitbrat-staging_nats-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/nats-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .

# Download backups to local machine
scp root@bitbrat.lan:/opt/bitbrat-staging/*.tar.gz ./backups/
```

#### 1.2 Document Current Configuration

```bash
# Export environment variables
ssh root@bitbrat.lan "cd /opt/bitbrat-staging && cat .env.brat" > current-env.txt

# Export Docker Compose configuration
ssh root@bitbrat.lan "cd /opt/bitbrat-staging && cat .docker-compose.merged.yaml" > current-compose.yaml

# List all Docker volumes
ssh root@bitbrat.lan "docker volume ls" > current-volumes.txt

# List all Docker networks
ssh root@bitbrat.lan "docker network ls" > current-networks.txt
```

#### 1.3 Clean Up Old Volumes (Optional)

```bash
# Remove unused deployment contexts
ssh root@bitbrat.lan << 'EOF'
  # Stop and remove old contexts
  docker volume rm bitbrat-wankle_nats-data bitbrat-wankle_postgres-data bitbrat-wankle_redis-data
  docker volume rm bitbrat-zoozie_nats-data bitbrat-zoozie_postgres-data bitbrat-zoozie_redis-data
  docker volume rm bitbrat-torantoo_redis-data
  docker volume rm docker-compose_nats-data docker-compose_postgres-data docker-compose_redis-data docker-compose_bitbrat-storage

  # Prune unused volumes
  docker volume prune -f
EOF
```

**Potential Space Recovered**: ~200-300MB

### Phase 2: New Box Setup

**Timeline**: 2-4 hours

#### 2.1 Install Operating System

**Option A: Alpine Linux 3.23+ (Recommended)**

1. Download Alpine Standard ISO: https://alpinelinux.org/downloads/
2. Create bootable USB: `dd if=alpine-standard-3.23.4-x86_64.iso of=/dev/sdX bs=4M`
3. Boot from USB and run setup: `setup-alpine`
4. Configure:
   - Keyboard: `us`
   - Hostname: `bitbrat-staging` (or custom name)
   - Network: Configure static IP or DHCP
   - Timezone: Your timezone
   - Disk: Use `sys` mode (full installation)
   - User: Create `root` user with strong password
5. Reboot and SSH into new box

**Option B: Ubuntu Server 24.04 LTS**

1. Download Ubuntu Server ISO: https://ubuntu.com/download/server
2. Create bootable USB and install
3. Configure network, users, SSH during installation
4. Reboot and SSH into new box

#### 2.2 Install Docker and Docker Compose

**Alpine Linux**:
```bash
# Update package index
apk update

# Install Docker
apk add docker docker-compose docker-cli-compose

# Enable Docker service
rc-update add docker boot
service docker start

# Verify installation
docker --version
docker-compose --version
```

**Ubuntu/Debian**:
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt-get install docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

#### 2.3 Configure System Resources

**Increase File Descriptors** (for NATS, PostgreSQL):
```bash
# Alpine: Edit /etc/sysctl.conf
echo "fs.file-max = 100000" >> /etc/sysctl.conf
sysctl -p

# Ubuntu/Debian: Same as above
```

**Configure Swap** (if not already configured):
```bash
# Create 8GB swap file (adjust based on RAM)
dd if=/dev/zero of=/swapfile bs=1G count=8
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Make persistent
echo "/swapfile none swap sw 0 0" >> /etc/fstab
```

**Configure Docker Storage Driver** (use `overlay2`):
```bash
# Alpine: Edit /etc/docker/daemon.json
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

# Restart Docker
service docker restart  # Alpine
# OR
systemctl restart docker  # Ubuntu/Debian
```

#### 2.4 Configure Network

**Update DNS/Hostname**:

If using `bitbrat.lan` as hostname:
1. Update local `/etc/hosts` to point `bitbrat.lan` to new box IP
2. OR update DNS server (if using local DNS)
3. OR use new hostname (e.g., `bitbrat-staging.lan`)

**Example `/etc/hosts` entry** (on development machine):
```
# Old staging box (retire)
# 192.168.1.100  bitbrat.lan

# New staging box
192.168.1.200  bitbrat.lan
```

#### 2.5 Set Up SSH Access

```bash
# On new box: Enable SSH
# Alpine:
apk add openssh
rc-update add sshd
service sshd start

# Ubuntu: SSH installed by default
# Debian:
apt-get install openssh-server
systemctl enable ssh
systemctl start ssh

# Copy SSH keys from old box (optional)
ssh-copy-id root@<new-box-ip>
```

### Phase 3: Deploy BitBrat Platform

**Timeline**: 1-2 hours

#### 3.1 Deploy Platform to New Box

**From local development machine**:

```bash
# Verify new box is accessible
ssh root@<new-box-ip> "docker --version"

# Update architecture.yaml staging context (if hostname changed)
# Edit architecture.yaml:
#   executionContexts.staging.deployment.docker.host: ssh://root@<new-box-ip>

# OR update local SSH config (~/.ssh/config):
# Host bitbrat.lan
#   HostName <new-box-ip>
#   User root

# Deploy full stack to new box
npm run brat -- bit deploy --all --context staging

# Monitor deployment
npm run brat -- fleet logs --context staging --follow
```

#### 3.2 Restore Data (If Needed)

**If migrating data from old box**:

```bash
# Copy backup files to new box
scp ./backups/postgres-backup-*.tar.gz root@<new-box-ip>:/opt/bitbrat-staging/

# SSH into new box
ssh root@<new-box-ip>

# Stop PostgreSQL container
cd /opt/bitbrat-staging
docker-compose stop postgres

# Restore PostgreSQL data
docker run --rm -v bitbrat-staging_postgres-data:/data -v $(pwd):/backup \
  postgres:15-alpine sh -c "cd /data && tar xzf /backup/postgres-backup-*.tar.gz"

# Start PostgreSQL container
docker-compose start postgres

# Verify data restored
docker-compose exec postgres psql -U bitbrat -d bitbrat -c "\dt"
```

#### 3.3 Verify Deployment

```bash
# Check all services are running
npm run brat -- fleet list --context staging

# Check service health
npm run brat -- fleet health tool-orchestrator --context staging
npm run brat -- fleet health llm-bot --context staging

# Check logs for errors
npm run brat -- fleet logs tool-orchestrator --context staging --limit 50
npm run brat -- fleet logs llm-bot --context staging --limit 50

# Test MCP endpoint
curl http://<new-box-ip>:3000/healthz
```

### Phase 4: Post-Migration (Validation & Cleanup)

**Timeline**: 1-2 hours

#### 4.1 Functional Testing

```bash
# Send test message via MCP tools
npm run brat -- message send --context staging --text "Test message after migration"

# Verify tool-orchestrator exposes tools
npm run brat -- fleet info tool-orchestrator --context staging

# Check tool count (should be ~200 after Sprint 66 fix)
# Look for: "toolsToRegister: 200" in logs

# Test image generation (if enabled)
npm run brat -- message send --context staging --text "Generate an image of a cat"

# Monitor resource usage
ssh root@<new-box-ip> "docker stats --no-stream"
ssh root@<new-box-ip> "free -h"
ssh root@<new-box-ip> "df -h"
```

#### 4.2 Performance Comparison

**Run performance benchmarks** (if available):

```bash
# Compare service startup times
# Old box: ~30-60 seconds for full stack
# New box: Expected ~15-30 seconds

# Compare PostgreSQL query performance
# (Run sample queries against tool registry)

# Compare LLM response times
# (Send 10 test messages, measure latency)
```

#### 4.3 Old Box Cleanup (After 1-2 Weeks)

**Once new box is stable**:

```bash
# Stop old box services
ssh root@<old-box-ip> "cd /opt/bitbrat-staging && docker-compose down"

# Archive old box data (optional)
ssh root@<old-box-ip> "tar czf /tmp/bitbrat-staging-archive.tar.gz /opt/bitbrat-staging /var/lib/docker/volumes"

# Download archive
scp root@<old-box-ip>:/tmp/bitbrat-staging-archive.tar.gz ./backups/old-box-archive.tar.gz

# Decommission old box or repurpose for other tasks
```

---

## 6. Configuration Optimizations for New Box

### 6.1 PostgreSQL Tuning (16GB+ RAM)

**Update `architecture.yaml` staging context**:

```yaml
executionContexts:
  staging:
    infrastructure:
      persistence:
        config:
          maxConnections: 200          # Increase from 100
          sharedBuffers: 2GB            # Increase from 512MB (25% of 8GB dedicated to PG)
          effectiveCacheSize: 6GB       # Increase from 1GB (75% of 8GB dedicated to PG)
          maintenanceWorkMem: 256MB     # Increase from 64MB
          workMem: 20MB                 # Increase from 10MB (200 connections × 20MB = 4GB max)
```

**Or manually configure in Docker Compose** (temporary until architecture.yaml updated):

```yaml
# In .docker-compose.merged.yaml (auto-generated, edit locally for testing)
services:
  postgres:
    command:
      - postgres
      - -c
      - shared_buffers=2GB
      - -c
      - effective_cache_size=6GB
      - -c
      - maintenance_work_mem=256MB
      - -c
      - work_mem=20MB
      - -c
      - max_connections=200
```

### 6.2 Redis Tuning (16GB+ RAM)

**Update `env/staging/infra.yaml`** or **`architecture.yaml`**:

```yaml
# In docker-compose.yml or env overlay
services:
  redis:
    command:
      - redis-server
      - --appendonly yes
      - --appendfsync everysec
      - --maxmemory 2gb              # Increase from 1GB
      - --maxmemory-policy allkeys-lru
```

### 6.3 Loki Log Rotation (Prevent Log Explosion)

**Add Loki retention policy** to prevent 4.9GB log growth:

**Create `config/loki-staging.yaml`**:

```yaml
# Loki configuration for staging (Sprint 59+)
auth_enabled: false

server:
  http_listen_port: 3100

ingester:
  lifecycler:
    ring:
      kvstore:
        store: inmemory
      replication_factor: 1
  chunk_idle_period: 15m
  chunk_retain_period: 30s

schema_config:
  configs:
    - from: 2024-01-01
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/boltdb-shipper-active
    cache_location: /loki/boltdb-shipper-cache
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks

# CRITICAL: Add retention limits to prevent unbounded growth
limits_config:
  retention_period: 168h          # 7 days (matches PERSISTENCE_TTL_DAYS)
  ingestion_rate_mb: 10            # Limit ingestion to 10MB/s
  ingestion_burst_size_mb: 20      # Burst up to 20MB
  max_query_series: 500            # Prevent expensive queries

# CRITICAL: Enable compactor to enforce retention
compactor:
  working_directory: /loki/compactor
  shared_store: filesystem
  compaction_interval: 10m
  retention_enabled: true          # Enable retention enforcement
  retention_delete_delay: 2h       # Delete after 2 hours
  retention_delete_worker_count: 150
```

**Update `docker-compose.yml` to use config**:

```yaml
services:
  loki:
    image: grafana/loki:2.9.0
    volumes:
      - ./config/loki-staging.yaml:/etc/loki/local-config.yaml
      - loki-data:/loki
    command: -config.file=/etc/loki/local-config.yaml
```

**Expected Impact**: Loki logs will be pruned after 7 days, preventing 4.9GB+ growth.

### 6.4 Docker Logging (Prevent Container Log Explosion)

**Update `/etc/docker/daemon.json`** (if not already configured):

```json
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

**Per-container override** in `docker-compose.yml` (for verbose services):

```yaml
services:
  llm-bot:
    logging:
      driver: "json-file"
      options:
        max-size: "20m"           # Increase for LLM logs
        max-file: "5"
```

### 6.5 NATS JetStream Tuning (16GB+ RAM)

**Update `architecture.yaml` or `docker-compose.yml`**:

```yaml
# In docker-compose.yml
services:
  nats:
    environment:
      NATS_JETSTREAM_MAX_MEM: 2GB     # Allow some memory caching (was -1)
      NATS_JETSTREAM_MAX_FILE: 10Gi   # Keep disk limit
```

**Rationale**: With 16GB+ RAM, NATS can use 2GB for in-memory message caching, reducing disk I/O for high-frequency topics.

### 6.6 Service Resource Limits (Optional)

**Prevent runaway services** from consuming all resources:

```yaml
# In docker-compose.yml (add to resource-intensive services)
services:
  llm-bot:
    deploy:
      resources:
        limits:
          cpus: '2.0'              # Max 2 CPU cores
          memory: 2G               # Max 2GB RAM
        reservations:
          cpus: '0.5'              # Reserve 0.5 cores
          memory: 512M             # Reserve 512MB

  tool-orchestrator:
    deploy:
      resources:
        limits:
          cpus: '4.0'              # Max 4 CPU cores (heavy workload)
          memory: 4G               # Max 4GB RAM
        reservations:
          cpus: '1.0'
          memory: 1G
```

**Recommendation**: Only add limits after baseline resource usage is established (monitor with `docker stats`).

---

## 7. Monitoring & Observability Setup

### 7.1 Grafana + Loki Dashboard (Recommended)

**Add Grafana to staging stack** for log visualization:

```yaml
# In docker-compose.yml
services:
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3200:3000"
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer
    volumes:
      - grafana-data:/var/lib/grafana
      - ./config/grafana/provisioning:/etc/grafana/provisioning
    networks:
      - bitbrat.local

volumes:
  grafana-data:
```

**Configure Loki data source** in Grafana:
- URL: `http://loki:3100`
- Access: Server (default)

**Expected Benefits**:
- Real-time log streaming and filtering
- Dashboard for service health, error rates
- Sprint 66 Issue #6 would have been visible in Grafana dashboard

### 7.2 Prometheus Metrics (Optional)

**Add Prometheus for service metrics**:

```yaml
# In docker-compose.yml
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./config/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=7d'  # Match Loki retention
    networks:
      - bitbrat.local

volumes:
  prometheus-data:
```

**Configure `config/prometheus.yml`**:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'docker'
    static_configs:
      - targets: ['host.docker.internal:9323']  # Docker daemon metrics

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']     # If using postgres_exporter

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']        # If using redis_exporter

  - job_name: 'nats'
    static_configs:
      - targets: ['nats:8222']                  # NATS monitoring endpoint
```

### 7.3 Node Exporter (System Metrics)

**Add Node Exporter for host metrics**:

```yaml
# In docker-compose.yml
services:
  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    networks:
      - bitbrat.local
```

**Expected Benefits**:
- CPU, memory, disk, network usage metrics
- Correlate service performance with system resources
- Alerting on resource exhaustion

---

## 8. Security Hardening (Recommended)

### 8.1 Firewall Configuration

**Alpine Linux (using `iptables`)**:

```bash
# Install iptables
apk add iptables ip6tables

# Allow SSH
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow Docker services (if accessing from outside host)
iptables -A INPUT -p tcp --dport 3000:3200 -j ACCEPT  # Service ports
iptables -A INPUT -p tcp --dport 4222 -j ACCEPT       # NATS
iptables -A INPUT -p tcp --dport 5432 -j ACCEPT       # PostgreSQL (if remote access needed)

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Drop everything else
iptables -A INPUT -j DROP

# Save rules
rc-update add iptables
/etc/init.d/iptables save
```

**Ubuntu/Debian (using `ufw`)**:

```bash
# Install ufw
apt-get install ufw

# Allow SSH
ufw allow 22/tcp

# Allow Docker services
ufw allow 3000:3200/tcp
ufw allow 4222/tcp

# Enable firewall
ufw enable
```

### 8.2 SSH Hardening

**Edit `/etc/ssh/sshd_config`**:

```bash
# Disable password authentication (use SSH keys only)
PasswordAuthentication no

# Disable root login (create non-root user first)
PermitRootLogin no

# Change default SSH port (optional)
Port 2222

# Restart SSH service
service sshd restart  # Alpine
# OR
systemctl restart ssh  # Ubuntu/Debian
```

### 8.3 Docker Socket Protection

**Restrict Docker socket access** (prevent privilege escalation):

```bash
# Create docker group and add user
addgroup docker
adduser <your-user> docker

# Restrict socket permissions
chmod 660 /var/run/docker.sock
chown root:docker /var/run/docker.sock
```

### 8.4 Secrets Management

**Use `.secure.staging/.env` for secrets** (never commit to git):

```bash
# On new box, create secure directory
mkdir -p /opt/bitbrat-staging/.secure.staging

# Copy secrets from old box or create new ones
scp root@<old-box-ip>:/opt/bitbrat-staging/.secure.staging/.env \
    /opt/bitbrat-staging/.secure.staging/

# Set restrictive permissions
chmod 600 /opt/bitbrat-staging/.secure.staging/.env
```

**Rotate secrets** (recommended for new box):
- PostgreSQL password: `POSTGRES_PASSWORD`
- Redis password (if using): `REDIS_PASSWORD`
- MCP auth tokens: `MCP_AUTH_TOKEN`
- API keys: `OPENAI_API_KEY`, `TWITCH_CLIENT_SECRET`, etc.

---

## 9. Cost Analysis

### Current Staging (Intel N100 Mini PC)

**Hardware**: ~$200-300 (Mini PC)
**Power**: 6W TDP × 24h × 365 days × $0.12/kWh = **~$6/year**
**Total Year 1**: ~$206-306

**Limitations**: Insufficient RAM, slow storage, low-power CPU

### Recommended Staging (Option 2: 32GB RAM, NVMe SSD)

**Hardware**: ~$600-1000 (Mini PC or server)
**Power**: 65W TDP × 24h × 365 days × $0.12/kWh = **~$68/year**
**Total Year 1**: ~$668-1068
**Total Year 3** (amortized): ~$823-1203 ($274-401/year)

**Benefits**:
- 4x RAM (7.5GB → 32GB)
- 10-50x faster storage (eMMC → NVMe SSD)
- 2-4x faster CPU
- Future-proof for 2-3 years

**ROI Analysis**:
- **Avoided downtime**: Sprint 66 issues caused ~6-8 hours of debugging/fixing (2 engineers × $75/hr × 7 hours = ~$1050)
- **Faster development**: 2-5x faster builds, deployments, tests (saves ~5-10 hours/month = ~$3750-7500/year)
- **Production-equivalent testing**: Catch issues in staging, not production

**Break-even**: ~1 month (avoided downtime alone)

---

## 10. Migration Checklist

### Pre-Migration

- [ ] **Backup current staging data** (PostgreSQL, Redis, NATS)
- [ ] **Document current configuration** (.env.brat, docker-compose.yaml)
- [ ] **Archive old deployment contexts** (wankle, zoozie, torantoo)
- [ ] **Test backups** (verify restoration works)

### New Box Setup

- [ ] **Install operating system** (Alpine Linux 3.23+ or Ubuntu 24.04 LTS)
- [ ] **Install Docker and Docker Compose**
- [ ] **Configure system resources** (file descriptors, swap, storage driver)
- [ ] **Set up SSH access** (copy keys, disable password auth)
- [ ] **Configure firewall** (iptables/ufw)
- [ ] **Update DNS/hostname** (point bitbrat.lan to new box or use new hostname)

### Deployment

- [ ] **Update architecture.yaml** (if hostname changed)
- [ ] **Deploy BitBrat platform** (`npm run brat -- bit deploy --all --context staging`)
- [ ] **Restore data** (if migrating from old box)
- [ ] **Verify deployment** (all services running, health checks pass)

### Configuration

- [ ] **Tune PostgreSQL** (shared_buffers, max_connections, work_mem)
- [ ] **Tune Redis** (maxmemory)
- [ ] **Configure Loki retention** (prevent log explosion)
- [ ] **Configure Docker logging** (max-size, max-file)
- [ ] **Set resource limits** (optional, monitor first)

### Validation

- [ ] **Functional testing** (send test messages, verify tools exposed)
- [ ] **Performance comparison** (startup times, query performance, LLM latency)
- [ ] **Resource monitoring** (docker stats, free -h, df -h)
- [ ] **Load testing** (optional, simulate production workloads)

### Post-Migration

- [ ] **Monitor for 1-2 weeks** (watch for memory leaks, disk growth, errors)
- [ ] **Archive old box** (backup data, decommission)
- [ ] **Update documentation** (new box IP, hostname, specs)
- [ ] **Celebrate** 🎉 (staging is now production-ready!)

---

## 11. Troubleshooting

### Issue: Services fail to start after migration

**Symptoms**: `docker-compose up` fails, services crash immediately

**Diagnosis**:
```bash
# Check Docker logs
docker-compose logs <service-name>

# Check container status
docker ps -a
```

**Common Causes**:
- **Missing environment variables**: Check `.env.brat` and `.secure.staging/.env`
- **Volume mount errors**: Verify volume paths exist
- **Port conflicts**: Check if ports are already allocated (`netstat -tulpn`)
- **Resource limits**: Increase memory/CPU if hitting limits

**Fix**:
```bash
# Restart individual service
docker-compose restart <service-name>

# Full stack restart
docker-compose down && docker-compose up -d

# Check resource usage
docker stats --no-stream
```

### Issue: PostgreSQL connection errors

**Symptoms**: Services can't connect to PostgreSQL, `ECONNREFUSED` errors

**Diagnosis**:
```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Test connection
docker-compose exec postgres psql -U bitbrat -d bitbrat -c "\l"
```

**Common Causes**:
- **PostgreSQL not ready**: Wait for health check to pass (10-30 seconds)
- **Wrong credentials**: Verify `POSTGRES_USER`, `POSTGRES_PASSWORD` in `.secure.staging/.env`
- **Network issues**: Check Docker network connectivity

**Fix**:
```bash
# Wait for health check
docker-compose up -d postgres
sleep 30

# Restart dependent services
docker-compose restart <service-name>
```

### Issue: Out of memory errors

**Symptoms**: Services crash with `OOM killed`, `ENOMEM` errors

**Diagnosis**:
```bash
# Check memory usage
free -h

# Check swap usage
swapon --show

# Check Docker stats
docker stats --no-stream

# Check kernel logs
dmesg | grep -i "out of memory"
```

**Common Causes**:
- **Insufficient RAM**: Need more physical memory
- **Memory leaks**: Service consuming memory over time
- **No swap configured**: Add swap space

**Fix**:
```bash
# Add swap (temporary)
dd if=/dev/zero of=/swapfile bs=1G count=8
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Restart services
docker-compose restart

# Add resource limits (long-term fix)
# Edit docker-compose.yml, add deploy.resources.limits
```

### Issue: Loki logs growing unbounded

**Symptoms**: Disk usage increasing rapidly, Loki volume at 10GB+

**Diagnosis**:
```bash
# Check Loki volume size
docker system df -v | grep loki

# Check Loki configuration
docker-compose exec loki cat /etc/loki/local-config.yaml
```

**Fix**:
```bash
# Stop Loki
docker-compose stop loki

# Prune old logs (manual)
docker run --rm -v bitbrat-staging_loki-data:/loki alpine \
  find /loki/chunks -type f -mtime +7 -delete

# Apply retention configuration (see Section 6.3)

# Restart Loki
docker-compose start loki
```

### Issue: Slow performance compared to old box

**Symptoms**: Services slower than expected, high CPU/disk wait times

**Diagnosis**:
```bash
# Check CPU usage
top

# Check disk I/O
iostat -x 1 10  # Ubuntu/Debian
# OR
vmstat 1 10     # Alpine (if sysstat not available)

# Check Docker performance
docker stats --no-stream
```

**Common Causes**:
- **Resource contention**: Too many services on limited CPU/RAM
- **Slow storage**: Check if using HDD instead of SSD
- **Network latency**: DNS issues, slow external APIs

**Fix**:
```bash
# Restart services one at a time
docker-compose restart <service-name>

# Reduce service count (disable non-essential services)
docker-compose stop <service-name>

# Check storage type
lsblk -d -o name,rota  # 1 = HDD, 0 = SSD
```

---

## 12. Next Steps

1. **Review recommendations** with team
2. **Select hardware option** (Budget, Recommended, or Ideal)
3. **Order hardware** (if purchasing new box)
4. **Schedule migration** (allocate 4-8 hours downtime)
5. **Follow migration checklist** (Section 10)
6. **Monitor for 1-2 weeks** (validate performance, stability)
7. **Archive old box** (after validation period)
8. **Update documentation** (record new box specs, IP, configuration)

---

## Appendix A: Quick Reference Commands

### SSH into Staging Box
```bash
ssh root@bitbrat.lan
# OR (if hostname changed)
ssh root@<new-box-ip>
```

### Deploy Platform
```bash
npm run brat -- bit deploy --all --context staging
```

### Check Service Status
```bash
npm run brat -- fleet list --context staging
npm run brat -- fleet health <service> --context staging
```

### View Logs
```bash
npm run brat -- fleet logs <service> --context staging --limit 50 --follow
```

### Check Resource Usage
```bash
ssh root@bitbrat.lan "docker stats --no-stream"
ssh root@bitbrat.lan "free -h"
ssh root@bitbrat.lan "df -h"
```

### Restart Service
```bash
ssh root@bitbrat.lan "cd /opt/bitbrat-staging && docker-compose restart <service>"
```

### Full Stack Restart
```bash
ssh root@bitbrat.lan "cd /opt/bitbrat-staging && docker-compose down && docker-compose up -d"
```

---

## Appendix B: Resource Calculations

### Memory Allocation (32GB Box)

```
Operating System (Alpine):       500MB
Docker Daemon:                   300MB
PostgreSQL:                      3GB   (shared_buffers: 2GB + connections: 1GB)
Redis:                           2GB
NATS:                            2GB   (JetStream cache)
Loki:                            1GB
Application Services (19):       8GB   (~400MB avg per service)
LLM Operations (peak):           2GB   (request/response buffers)
Buffer (OS cache, misc):         13.2GB
-------------------------------------------
Total:                           32GB
```

**Headroom**: ~40% free for spikes, development, testing

### Storage Allocation (256GB SSD)

```
Operating System:                 5GB
Docker Images:                   15GB
PostgreSQL Data:                  5GB   (events, tool registry, state)
Loki Logs (7 days):              10GB   (with rotation)
NATS Data:                        2GB
Redis Snapshots:                  1GB
Application Storage:              5GB   (images, generated files)
Backups:                         10GB   (periodic PostgreSQL/Redis backups)
Free Space (40%):               100GB   (future growth)
-------------------------------------------
Total:                          153GB / 256GB
```

**Usage**: 60% (40% free for growth)

---

**End of Document**

For questions or clarifications, refer to:
- **architecture.yaml**: Canonical platform configuration
- **Sprint 66 Summary**: SPRINT-66-SUMMARY.md
- **Sprint 66 Recommendations**: SPRINT-66-RECOMMENDATIONS.md
- **BitBrat Documentation**: documentation/
