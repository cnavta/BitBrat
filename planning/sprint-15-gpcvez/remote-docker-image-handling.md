# Remote Docker Deployment: Image Build & Transfer Mechanics

**Sprint**: sprint-15-gpcvez
**Context**: Investigation into obs-mcp deployment behavior
**Question**: When deploying to a remote Docker environment, are images downloaded from the local machine or built remotely?

---

## Answer: Images are Built Remotely (On the Remote Host)

When deploying to a remote Docker environment via SSH, **images are built on the remote Docker daemon**, not transferred from the local machine.

---

## How Remote Docker Deployments Work

### High-Level Flow

1. **Source Code Sync** (Local → Remote)
   - Files are synced from local machine to remote host via `rsync`
   - Includes: source code, Dockerfiles, compose files, config files

2. **Build Execution** (Remote Docker Daemon)
   - `docker compose build` runs **on the remote Docker daemon**
   - Build context is the synced source code **on the remote host**
   - Resulting images stored in **remote Docker daemon's image cache**

3. **Container Launch** (Remote Docker Daemon)
   - `docker compose up` runs **on the remote Docker daemon**
   - Uses images from **remote daemon's cache**

### Key Insight

**No image transfer occurs between local and remote machines**. The local machine only transfers source code and configuration files, then executes Docker commands remotely via SSH.

---

## Implementation Details

### File Path References

**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`

#### 1. Source Code Synchronization (Lines 567-689)

```typescript
private async syncRemoteFiles(target: any): Promise<void> {
  const remoteDir = target.remoteDir;
  const sshTarget = target.host.replace('ssh://', '');

  console.log(`[brat] Syncing deployment files to remote: ${sshTarget}:${remoteDir}`);

  // Create remote directory
  await execCmd('ssh', [sshTarget, `mkdir -p "${remoteDir}"`]);

  // Sync files using rsync
  const rsyncArgs = [
    '-avz',
    '--delete',
    '--exclude', 'node_modules',
    '--exclude', '.git',
    '--exclude', 'dist',
    `${repoRoot}/`,
    `${sshTarget}:${remoteDir}/`
  ];

  await execCmd('rsync', rsyncArgs);
}
```

**What gets synced**:
- `src/` - Source code
- `infrastructure/docker-compose/` - Compose files
- `Dockerfile.*` - Docker build definitions
- `architecture.yaml` - System configuration
- `package.json`, `tsconfig.json` - Build configuration
- `.secure.{ENV}/` - Secrets (if present)

**What does NOT get synced**:
- `node_modules/` - Excluded (rebuilt on remote if needed)
- `.git/` - Excluded (not needed for deployment)
- `dist/` - Excluded (rebuilt from TypeScript on remote)
- Docker images - **Never transferred**

#### 2. Remote Build Execution (Lines 175-189, 881-946)

```typescript
// orchestrator.ts:175-189
if (isRemote) {
  console.log(`[brat] Remote target detected. Building ${buildServices.length} services...`);

  for (let i = 0; i < buildServices.length; i += maxConcurrent) {
    const batch = buildServices.slice(i, i + maxConcurrent);
    console.log(`[brat] Building batch: ${batch.join(', ')}`);
    const buildArgs = [...composeArgs, 'build'];
    if (this.options.noCache) {
      buildArgs.push('--no-cache');
    }
    buildArgs.push(...batch);
    await this.executeDockerCompose(targetConfig, buildArgs);
  }
}

// orchestrator.ts:923-946 (executeDockerCompose with remote SSH)
if (isSsh && target.remoteDir) {
  const sshTarget = target.host.replace('ssh://', '');
  const quotedArgs = args.map(arg => arg.includes(' ') ? `"${arg}"` : arg).join(' ');

  // Execute docker compose on remote host
  const sshCommand =
    `cd "${target.remoteDir}" && ` +
    `(docker compose ${quotedArgs} || docker-compose ${quotedArgs})`;

  const result = await execCmd('ssh', [sshTarget, sshCommand], {
    cwd: this.options.repoRoot,
    stdio: 'inherit'
  });
}
```

**Build process**:
1. SSH into remote host: `ssh user@remote-host`
2. Change to synced directory: `cd /opt/BitBratPlatform`
3. Execute Docker Compose build: `docker compose build <services>`
4. Docker daemon **on the remote host** builds images from local (remote) source code

#### 3. Container Deployment (Lines 206-225)

```typescript
// Up all services using remote Docker daemon
const upArgs = [...composeArgs, 'up', '-d', '--no-build'];
if (this.options.forceRecreate) {
  upArgs.push('--force-recreate');
}
if (this.options.servicesToStart && this.options.servicesToStart.length > 0) {
  upArgs.push(...this.options.servicesToStart);
}
await this.executeDockerCompose(targetConfig, upArgs);
```

**Container launch**:
- `docker compose up -d --no-build` runs on remote Docker daemon
- `--no-build` flag ensures no accidental rebuilds (already built in step 2)
- Containers started from images in **remote daemon's cache**

---

## Why This Design?

### Advantages

1. **Performance**
   - No large image transfers over network
   - Build uses remote machine's CPU/memory resources
   - Leverages remote Docker daemon's layer cache

2. **Consistency**
   - Same build process for local and remote deployments
   - Remote builds use remote environment's base images (OS, arch)
   - Ensures images are compatible with remote host architecture

3. **Security**
   - Images never stored on local machine (for remote deployments)
   - Secrets only exist on remote host (via `.secure.{ENV}/` sync)
   - Build context confined to remote environment

4. **Simplicity**
   - No image registry required for remote deployments
   - No image push/pull steps
   - Single source of truth (synced source code)

### Trade-offs

1. **Remote Host Requirements**
   - Remote host must have Docker installed
   - Remote host must have sufficient resources to build images
   - Remote host must have network access to pull base images (e.g., `node:20-alpine`)

2. **Build Time**
   - Every deployment triggers a rebuild (unless Docker layer cache is warm)
   - No shared image cache between multiple remote hosts
   - Base image rebuilds always occur (cache key is local-only, see lines 274-302)

---

## Command Execution Flow Example

### Scenario: Deploy `obs-mcp` to staging remote host

```bash
npm run brat -- bit deploy obs-mcp --context staging
```

**Execution Steps**:

```
1. [LOCAL] Resolve execution context: staging
   └─ Load architecture.yaml executionContexts.staging
   └─ Detect deployment type: docker (SSH remote)
   └─ Extract target: ssh://user@staging.bitbrat.lan, remoteDir: /opt/BitBratPlatform

2. [LOCAL → REMOTE] Sync source files
   └─ rsync -avz --delete --exclude node_modules src/ user@staging.bitbrat.lan:/opt/BitBratPlatform/src/
   └─ rsync -avz Dockerfile.* infrastructure/ architecture.yaml user@staging.bitbrat.lan:/opt/BitBratPlatform/
   └─ rsync -avz .secure.staging/ user@staging.bitbrat.lan:/opt/BitBratPlatform/.secure.staging/

3. [REMOTE] Build bitbrat-base image
   └─ ssh user@staging.bitbrat.lan "cd /opt/BitBratPlatform && docker compose --profile build-only build bitbrat-base"
   └─ Remote Docker daemon builds bitbrat-base from /opt/BitBratPlatform/Dockerfile.base
   └─ Image stored in remote daemon: bitbrat-staging-bitbrat-base:latest

4. [REMOTE] Build obs-mcp service
   └─ ssh user@staging.bitbrat.lan "cd /opt/BitBratPlatform && docker compose build obs-mcp"
   └─ Remote Docker daemon builds obs-mcp from /opt/BitBratPlatform/Dockerfile.service
   └─ Build uses bitbrat-base as base image (from remote daemon cache)
   └─ Image stored in remote daemon: bitbrat-staging-obs-mcp:latest

5. [REMOTE] Start obs-mcp container
   └─ ssh user@staging.bitbrat.lan "cd /opt/BitBratPlatform && docker compose up -d --no-build obs-mcp"
   └─ Remote Docker daemon starts container from bitbrat-staging-obs-mcp:latest
   └─ Container running on staging.bitbrat.lan
```

---

## Special Cases

### External Images (Pre-built Images)

**Example**: `obs-mcp` uses external image from registry

```yaml
# architecture.yaml
services:
  obs-mcp:
    image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
```

**Behavior**:
1. Source code **NOT** synced (no build context needed)
2. Docker Compose **pulls** image from registry on remote host
3. No build step occurs
4. Container launched from pulled image

**Remote execution**:
```bash
ssh user@staging.bitbrat.lan "cd /opt/BitBratPlatform && docker compose pull obs-mcp"
ssh user@staging.bitbrat.lan "cd /opt/BitBratPlatform && docker compose up -d obs-mcp"
```

### Hybrid: Build + External Base

**Example**: Service builds locally but uses external base image

```dockerfile
# Dockerfile.service
FROM us-central1-docker.pkg.dev/bitbrat-local/bitbrat-base:v1.0.0
COPY --from=builder /app/dist ./dist
```

**Behavior**:
1. Source code synced to remote
2. Remote Docker daemon **pulls** base image from registry
3. Remote Docker daemon **builds** service image using synced source
4. Container launched from built image

---

## Observability Stack (Loki) with Remote Deployments

**Question**: How does `--loki` flag work with remote deployments?

**Answer**: Loki and Promtail are deployed as pre-built images, **not** built from source.

```yaml
# infrastructure/docker-compose/observability/docker-compose.observability.yaml
services:
  loki:
    image: grafana/loki:2.9.3  # Pre-built image from Docker Hub

  promtail:
    image: grafana/promtail:2.9.3  # Pre-built image from Docker Hub
```

**Remote execution with `--loki`**:
```bash
npm run brat -- bit deploy --all --loki --context staging
```

**Steps**:
1. Sync source code (application services)
2. Build application services (auth, llm-bot, obs-mcp, etc.)
3. **Pull** Loki and Promtail images from Docker Hub (remote daemon)
4. Start all containers (application + observability)

**No build step for Loki/Promtail** - they are official pre-built images.

---

## Configuration Reference

### Remote Target Configuration

**File**: `architecture.yaml`

```yaml
executionContexts:
  staging:
    name: staging
    description: Staging environment on remote Docker host
    deployment:
      type: docker
      docker:
        host: ssh://user@staging.bitbrat.lan
        remoteDir: /opt/BitBratPlatform
        maxConcurrent: 2
```

**Fields**:
- `host`: SSH URL to remote Docker host
- `remoteDir`: Deployment directory on remote host (where files are synced)
- `maxConcurrent`: Max concurrent builds (default: 1 for SSH to avoid connection resets)

### Environment Variable Handling

**Remote environment variables** are written to `.env.brat` **on the remote host** after sync.

```typescript
// orchestrator.ts:352-498
private async writeEnvFile(envName: string, targetConfig: any, contextName?: string): Promise<string> {
  const env = this.envResolver.resolve(envName, securePath);

  // For remote targets, rewrite GOOGLE_APPLICATION_CREDENTIALS to remote path
  const isRemote = targetConfig?.host?.startsWith('ssh://');
  if (isRemote && targetConfig?.remoteDir && mergedEnv['GOOGLE_APPLICATION_CREDENTIALS']) {
    mergedEnv['GOOGLE_APPLICATION_CREDENTIALS'] = path.posix.join(
      targetConfig.remoteDir,
      'secrets/google-app-creds.json'
    );
  }

  // Write .env.brat to local repo root
  fs.writeFileSync('.env.brat', envContent);

  // Rsync will copy .env.brat to remote host
}
```

---

## Summary

| Aspect | Local Deployment | Remote Deployment (SSH) |
|--------|-----------------|------------------------|
| **Source Code** | Local file system | Synced via rsync |
| **Build Location** | Local Docker daemon | Remote Docker daemon |
| **Image Storage** | Local daemon cache | Remote daemon cache |
| **Build Context** | Local repo root | Remote synced directory |
| **Base Images** | Pulled by local daemon | Pulled by remote daemon |
| **Environment Variables** | `.env.brat` (local) | `.env.brat` (synced to remote) |
| **Secrets** | `.secure.{ENV}/` (local) | Synced to remote via rsync/scp |
| **Container Runtime** | Local Docker Engine | Remote Docker Engine |

**Key Takeaway**: Remote deployments use a **"sync source, build remote, run remote"** model, not an **"build local, transfer image, run remote"** model.

---

## Related Code Locations

- **Orchestrator**: `tools/brat/src/orchestration/docker/orchestrator.ts`
  - Lines 500-689: Remote file sync (`syncRemoteFiles`, `cleanupRemoteDeployment`)
  - Lines 175-254: Build and up logic (remote vs local branching)
  - Lines 881-946: Docker Compose execution (`executeDockerCompose`)

- **Deployment Strategy**: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
  - Lines 50-117: Preparation phase (remote detection)
  - Lines 596-850: Bulk deployment (`deployAll`)

- **Deploy Command**: `tools/brat/src/oclif-commands/bit/deploy.ts`
  - Lines 81-183: Command execution flow

---

**Document Status**: ✅ Complete
**Author**: Lead Implementor (Claude)
**Date**: 2026-08-16
