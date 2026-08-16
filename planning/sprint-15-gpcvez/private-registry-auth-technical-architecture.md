# Technical Architecture: Private Container Registry Authentication

**Sprint**: sprint-15-gpcvez
**Type**: Architecture Decision Record (ADR) + Technical Specification
**Status**: Proposed
**Author**: Lead Architect (Claude)
**Date**: 2026-08-16

---

## Executive Summary

The BitBrat Platform currently lacks systematic support for authenticating to private container registries during deployment. This prevents services using pre-built images from private registries (e.g., `us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest`) from being deployed to remote environments where the Docker daemon lacks authentication credentials.

This document proposes a **deployment lifecycle hook system** as a flexible, implementation-independent solution that allows projects to inject authentication logic at critical deployment stages without coupling the platform to specific registry providers.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Analysis](#current-state-analysis)
3. [Requirements](#requirements)
4. [Proposed Solutions](#proposed-solutions)
5. [Recommended Approach](#recommended-approach)
6. [Technical Specification](#technical-specification)
7. [Implementation Plan](#implementation-plan)
8. [Migration Strategy](#migration-strategy)
9. [Security Considerations](#security-considerations)
10. [References](#references)

---

## Problem Statement

### Issue

The `obs-mcp` service is defined with an external image from a private Google Artifact Registry:

```yaml
# architecture.yaml
services:
  obs-mcp:
    category: domain
    profile: mcp-server
    active: true
    image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
    # ... env, secrets, etc.
```

**Current Behavior**:
- **Local deployments** (Docker Desktop): Work if user has run `gcloud auth configure-docker` manually
- **Remote deployments** (SSH to staging): **Fail** with "pull access denied" errors because remote Docker daemon lacks GCR credentials
- **Cloud Run deployments**: Work automatically (Cloud Run Service Account has IAM permissions)

**Root Cause**:

The deployment system has no mechanism to:
1. Detect that authentication is required for a registry
2. Inject authentication credentials before pulling images
3. Support multiple registry providers (GCR, ECR, ACR, Docker Hub, custom registries)

### Impact

- **Immediate**: obs-mcp cannot be deployed to staging environment
- **Medium-term**: Any service using private images faces the same issue
- **Long-term**: Platform lacks extensibility for deployment customization

### Scope

This architecture addresses:
- ✅ Private container registry authentication (all providers)
- ✅ Deployment lifecycle customization (pre/post hooks)
- ✅ BEC (BitBrat Execution Context) and project-specific logic
- ✅ Local, remote, and cloud deployment targets
- ✅ Implementation independence (no hard-coded provider logic)

This architecture does **not** address:
- ❌ Image building (already handled by build strategies)
- ❌ Image scanning/vulnerability management (future work)
- ❌ Image caching/layer optimization (out of scope)

---

## Current State Analysis

### Deployment Process Flow

#### Local Deployment (`docker-compose`)

```
1. Load architecture.yaml
2. Resolve execution context (local)
3. Generate docker-compose.yaml (or use existing)
4. Execute: docker compose build <services>
5. Execute: docker compose up -d <services>
```

**Image Handling**:
- Services with `build:` → Built locally from Dockerfile
- Services with `image:` → Pulled from registry (relies on local Docker credentials)

**Authentication**:
- Assumes user has configured Docker credentials (`~/.docker/config.json`)
- No platform-enforced authentication step

#### Remote Deployment (`ssh://remote-host`)

```
1. Load architecture.yaml
2. Resolve execution context (staging)
3. Sync source files to remote host (rsync)
4. SSH: docker compose build <services>  (on remote)
5. SSH: docker compose up -d <services>   (on remote)
```

**Image Handling**:
- Services with `build:` → Built on remote Docker daemon
- Services with `image:` → Pulled from registry **by remote Docker daemon**

**Authentication**:
- **No credentials synced to remote**
- **No authentication step before pull**
- **Fails if remote Docker daemon lacks credentials**

**Current Flow** (tools/brat/src/orchestration/docker/orchestrator.ts):

```typescript
// Lines 567-689: syncRemoteFiles()
// Syncs: source code, Dockerfiles, compose files, .secure.{ENV}/
// Does NOT sync: Docker credentials, registry auth tokens

// Lines 175-189: Build services
await this.executeDockerCompose(targetConfig, ['build', ...services]);

// Lines 206-225: Start services
await this.executeDockerCompose(targetConfig, ['up', '-d', '--no-build', ...services]);
```

**Gap**: No authentication injection point between sync and pull.

#### Cloud Run Deployment

```
1. Load architecture.yaml
2. Resolve execution context (prod)
3. Determine image source:
   - If service.image exists: Use external image (deploy-only)
   - Else: Build via Cloud Build and push to Artifact Registry
4. Execute: gcloud run deploy <service> --image <image>
```

**Image Handling**:
- Cloud Run Service Account has IAM permissions to pull from Artifact Registry
- **Authentication handled automatically by GCP**

**Current Flow** (tools/brat/src/orchestration/deployment/cloud-run-strategy.ts):

```typescript
// Lines 68-75: Detect external image
const isExternalImage = !!service.image;

// Lines 49-250: prepare()
// If isExternalImage: Skip build, use service.image directly
// Else: Submit Cloud Build to build and push

// Lines 251-300: execute()
// gcloud run deploy --image <service.image or built-image>
```

**No issue**: GCP handles auth automatically via Service Account.

### Image Registry Providers

| Provider | Registry Format | Auth Method | Current Support |
|----------|----------------|-------------|-----------------|
| **Google Artifact Registry** | `{region}-docker.pkg.dev/{project}/{repo}/{image}` | `gcloud auth configure-docker` | ✅ Cloud Run<br>❌ Docker Compose |
| **Google Container Registry (GCR)** | `gcr.io/{project}/{image}` | `gcloud auth configure-docker` | ✅ Cloud Run<br>❌ Docker Compose |
| **AWS ECR** | `{account}.dkr.ecr.{region}.amazonaws.com/{image}` | `aws ecr get-login-password` | ❌ None |
| **Azure ACR** | `{registry}.azurecr.io/{image}` | `az acr login` | ❌ None |
| **Docker Hub (Private)** | `docker.io/{user}/{image}` or `{user}/{image}` | `docker login` | ❌ None |
| **GitHub Container Registry** | `ghcr.io/{user}/{image}` | `echo $PAT \| docker login ghcr.io` | ❌ None |
| **GitLab Container Registry** | `registry.gitlab.com/{user}/{image}` | `docker login registry.gitlab.com` | ❌ None |
| **Custom/Self-hosted** | `{domain}/{path}/{image}` | Provider-specific | ❌ None |

### Authentication Mechanisms

#### Docker Credential Storage

**Location**: `~/.docker/config.json`

```json
{
  "auths": {
    "us-central1-docker.pkg.dev": {
      "auth": "base64(username:password)"
    },
    "gcr.io": {
      "auth": "base64(_json_key:service-account-json)"
    }
  },
  "credHelpers": {
    "us-central1-docker.pkg.dev": "gcloud",
    "gcr.io": "gcloud",
    "123456789.dkr.ecr.us-east-1.amazonaws.com": "ecr-login"
  }
}
```

**Authentication Flow**:
1. Docker attempts to pull image
2. Checks `config.json` for `auths[registry]` or `credHelpers[registry]`
3. If `credHelpers`: Executes helper binary (e.g., `docker-credential-gcloud get`)
4. If `auths`: Uses stored token
5. Sends auth token in Docker Registry API request

#### Provider-Specific Authentication

**Google Cloud (GCR/Artifact Registry)**:
```bash
# Option 1: Configure credential helper (preferred)
gcloud auth configure-docker us-central1-docker.pkg.dev

# Option 2: Service account key file
cat gcp-key.json | docker login -u _json_key --password-stdin gcr.io

# Option 3: Short-lived token
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin gcr.io
```

**AWS ECR**:
```bash
# Get login password and pipe to docker login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com
```

**Azure ACR**:
```bash
# Option 1: Azure CLI login
az acr login --name myregistry

# Option 2: Service principal
docker login myregistry.azurecr.io -u <client-id> -p <client-secret>
```

**Docker Hub / Generic**:
```bash
docker login -u <username> -p <password> docker.io
docker login -u <username> -p <token> ghcr.io
```

### Current Code Locations

**Deployment Strategies**:
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` (Lines 34-1200)
- `tools/brat/src/orchestration/deployment/cloud-run-strategy.ts` (Lines 35-400)

**Docker Orchestrator**:
- `tools/brat/src/orchestration/docker/orchestrator.ts`
  - Lines 567-689: `syncRemoteFiles()` - Syncs source to remote
  - Lines 175-225: Build and up logic
  - Lines 881-946: `executeDockerCompose()` - SSH command execution

**Image Detection**:
- Services with `image:` field → External image (pull from registry)
- Services with `entry:` field → Build from source

---

## Requirements

### Functional Requirements

**FR1**: Support authentication to private container registries across all deployment targets (local, remote, cloud).

**FR2**: Support multiple registry providers without hard-coding provider-specific logic in platform core.

**FR3**: Allow BEC (BitBrat Execution Context) and project-specific customization of deployment behavior.

**FR4**: Provide clear injection points for authentication logic before image pulls.

**FR5**: Fail fast with actionable error messages when authentication is missing.

**FR6**: Support both credential-based and token-based authentication methods.

**FR7**: Maintain backward compatibility with existing deployments that don't use private registries.

### Non-Functional Requirements

**NFR1**: **Security** - Credentials must not be logged, committed to git, or transmitted insecurely.

**NFR2**: **Portability** - Solution must work on Linux, macOS, and Windows.

**NFR3**: **Maintainability** - Hook scripts must be simple, testable, and version-controlled with the project.

**NFR4**: **Performance** - Authentication overhead must not significantly impact deployment time (<10% increase).

**NFR5**: **Observability** - Hook execution must be logged with success/failure status and duration.

**NFR6**: **Extensibility** - Hook system must support future use cases beyond authentication (e.g., pre-flight checks, post-deployment validation).

---

## Proposed Solutions

### Option 1: Hard-Coded Provider Support

**Description**: Add explicit support for GCR, ECR, ACR authentication in deployment strategies.

**Implementation**:
```typescript
// tools/brat/src/orchestration/deployment/docker-compose-strategy.ts

private async authenticateRegistries(services: ServiceWithName[], context: ResolvedContext): Promise<void> {
  const registries = this.detectRegistries(services);

  for (const registry of registries) {
    if (registry.startsWith('gcr.io') || registry.includes('pkg.dev')) {
      await this.authenticateGCR(registry, context);
    } else if (registry.includes('.ecr.')) {
      await this.authenticateECR(registry, context);
    } else if (registry.includes('.azurecr.io')) {
      await this.authenticateACR(registry, context);
    }
  }
}
```

**Pros**:
- ✅ Simple to implement for known providers
- ✅ No user configuration required (detect and authenticate automatically)
- ✅ Clear error messages for each provider

**Cons**:
- ❌ Tightly couples platform to specific providers
- ❌ Requires platform updates for new providers
- ❌ Cannot support custom/self-hosted registries
- ❌ No flexibility for project-specific auth methods
- ❌ Violates Open/Closed Principle (not extensible without modification)

**Verdict**: ❌ **Not Recommended** - Lacks extensibility and violates architectural principles.

---

### Option 2: Registry Configuration in `architecture.yaml`

**Description**: Define registry authentication in execution contexts.

**Implementation**:
```yaml
# architecture.yaml
executionContexts:
  staging:
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/bitbrat-staging
        registries:
          - name: bitbrat-artifacts
            url: us-central1-docker.pkg.dev
            auth:
              type: gcloud
              serviceAccountKey: .secure.staging/gcp-sa.json
          - name: docker-hub
            url: docker.io
            auth:
              type: basic
              username: ${DOCKER_HUB_USER}
              password: ${DOCKER_HUB_TOKEN}
```

```typescript
// Deployment strategy reads registries from context and authenticates
for (const registry of context.deployment.docker.registries) {
  await this.authenticate(registry);
}
```

**Pros**:
- ✅ Declarative configuration (aligns with architecture.yaml philosophy)
- ✅ Supports multiple registries per context
- ✅ Clear documentation of registry dependencies
- ✅ Version-controlled authentication logic

**Cons**:
- ❌ Still requires platform code for each auth type
- ❌ Exposes credentials in architecture.yaml (even if from env vars)
- ❌ Limited flexibility for complex auth flows
- ❌ Mixes infrastructure config with auth logic

**Verdict**: ⚠️ **Partial Solution** - Good for simple cases, but lacks flexibility for complex scenarios.

---

### Option 3: Deployment Lifecycle Hooks (Recommended)

**Description**: Introduce pre-deploy and post-deploy hooks that execute user-defined scripts at specific deployment stages.

**Implementation**:
```yaml
# architecture.yaml
executionContexts:
  staging:
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/bitbrat-staging
      hooks:
        pre-deploy: .brat/hooks/pre-deploy.sh
        post-deploy: .brat/hooks/post-deploy.sh
        pre-build: .brat/hooks/staging/pre-build.sh
        post-build: .brat/hooks/staging/post-build.sh
```

```bash
# .brat/hooks/pre-deploy.sh
#!/bin/bash
set -e

echo "[pre-deploy] Authenticating to Google Artifact Registry..."

# Option 1: Service account key (if available)
if [ -f ".secure.staging/gcp-sa.json" ]; then
  cat .secure.staging/gcp-sa.json | docker login -u _json_key --password-stdin us-central1-docker.pkg.dev
  echo "[pre-deploy] ✓ Authenticated to GCR via service account"
  exit 0
fi

# Option 2: gcloud credential helper (if gcloud is installed)
if command -v gcloud &> /dev/null; then
  gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
  echo "[pre-deploy] ✓ Configured gcloud credential helper"
  exit 0
fi

echo "[pre-deploy] ✗ No authentication method available for GCR"
exit 1
```

**Hook Execution Flow**:
```
1. Load architecture.yaml
2. Resolve execution context
3. **Execute pre-deploy hook** (if defined)
4. Sync files (remote deployments only)
5. **Execute pre-build hook** (if defined)
6. Build images
7. **Execute post-build hook** (if defined)
8. Start containers
9. **Execute post-deploy hook** (if defined)
```

**Pros**:
- ✅ **Maximum flexibility** - Users implement auth logic exactly as needed
- ✅ **Implementation-independent** - Platform doesn't care about registry providers
- ✅ **BEC-specific** - Different hooks per execution context (local, staging, prod)
- ✅ **Extensible** - Hooks can handle authentication, validation, monitoring, etc.
- ✅ **Testable** - Hook scripts can be tested independently
- ✅ **Portable** - Works on any platform with shell access
- ✅ **Backward compatible** - Hooks are optional (no impact on existing deployments)
- ✅ **Observable** - Hook execution logged with status and duration

**Cons**:
- ❌ Requires users to write shell scripts (adds complexity)
- ❌ Hook scripts must be maintained per-project
- ❌ Potential for security issues if hooks are poorly written

**Mitigations**:
- Provide example hooks for common scenarios (GCR, ECR, ACR, Docker Hub)
- Document security best practices (no hardcoded secrets, use env vars)
- Add hook validation (check execute permissions, syntax validation)
- Provide hook templates in `documentation/templates/`

**Verdict**: ✅ **Recommended** - Best balance of flexibility, extensibility, and simplicity.

---

### Option 4: Plugin System

**Description**: Formalize hooks as a plugin system with TypeScript interfaces.

**Implementation**:
```typescript
// tools/brat/src/plugins/types.ts
export interface DeploymentPlugin {
  name: string;
  version: string;
  hooks: {
    preDeploy?: (context: DeploymentContext) => Promise<void>;
    postDeploy?: (context: DeploymentContext) => Promise<void>;
    preBuild?: (context: BuildContext) => Promise<void>;
    postBuild?: (context: BuildContext) => Promise<void>;
  };
}

// .brat/plugins/gcp-registry-auth.ts
export default {
  name: 'gcp-registry-auth',
  version: '1.0.0',
  hooks: {
    async preDeploy(ctx) {
      const keyPath = '.secure.staging/gcp-sa.json';
      if (fs.existsSync(keyPath)) {
        await execCmd('docker', ['login', '-u', '_json_key', '--password-stdin', 'us-central1-docker.pkg.dev'], {
          stdin: fs.readFileSync(keyPath),
        });
      }
    },
  },
} as DeploymentPlugin;
```

```yaml
# architecture.yaml
executionContexts:
  staging:
    deployment:
      plugins:
        - .brat/plugins/gcp-registry-auth.ts
        - .brat/plugins/slack-notifier.ts
```

**Pros**:
- ✅ Type-safe plugin development
- ✅ Rich plugin ecosystem potential
- ✅ Better error handling and validation
- ✅ IDE support (autocomplete, type checking)

**Cons**:
- ❌ Significant platform complexity (plugin loader, sandbox, error handling)
- ❌ Requires TypeScript knowledge (higher barrier to entry than bash)
- ❌ Increased build/transpilation overhead
- ❌ Over-engineered for current needs

**Verdict**: ⚠️ **Future Enhancement** - Consider after hook system is proven successful.

---

## Recommended Approach

### Solution: **Deployment Lifecycle Hooks** (Option 3)

**Rationale**:
1. **Flexibility**: Hooks allow BEC-specific and project-specific logic without platform changes
2. **Simplicity**: Shell scripts are universally understood and easy to write/test
3. **Extensibility**: Hook system supports authentication and future use cases
4. **Backward Compatibility**: Optional hooks don't break existing deployments
5. **Security**: Hooks can leverage existing secret management (.secure.{ENV}/)

**Hook Types**:

| Hook | Execution Stage | Use Cases | Environment |
|------|----------------|-----------|-------------|
| `pre-deploy` | Before sync (remote) or build (local) | Registry auth, env validation | Local or Remote |
| `post-deploy` | After containers start | Health checks, smoke tests, notifications | Local or Remote |
| `pre-build` | Before `docker compose build` | Build-time auth, dependency checks | Local or Remote |
| `post-build` | After `docker compose build` | Image scanning, tagging | Local or Remote |

**Hook Contract**:

```bash
# Hook script receives context via environment variables
# BRAT_CONTEXT_NAME - Execution context (local, staging, prod)
# BRAT_DEPLOYMENT_TYPE - docker-compose, cloud-run, etc.
# BRAT_TARGET_HOST - Deployment target (unix:///var/run/docker.sock, ssh://user@host)
# BRAT_REMOTE_DIR - Remote directory (if applicable)
# BRAT_SERVICES - Space-separated list of services being deployed
# BRAT_REPO_ROOT - Repository root directory

# Hook script must:
# - Exit 0 on success
# - Exit non-zero on failure (deployment will abort)
# - Write informational output to stdout
# - Write error output to stderr
```

---

## Technical Specification

### Schema Changes

#### `architecture.yaml` - Execution Context Hooks

```yaml
executionContexts:
  <context-name>:
    deployment:
      type: docker-compose | cloud-run
      hooks:
        pre-deploy: string    # Path to pre-deploy hook script (relative to repo root)
        post-deploy: string   # Path to post-deploy hook script
        pre-build: string     # Path to pre-build hook script
        post-build: string    # Path to post-build hook script
      # ... existing fields
```

**JSON Schema**:

```json
{
  "executionContexts": {
    "type": "object",
    "patternProperties": {
      "^[a-z][a-z0-9-]*$": {
        "type": "object",
        "properties": {
          "deployment": {
            "type": "object",
            "properties": {
              "hooks": {
                "type": "object",
                "properties": {
                  "pre-deploy": { "type": "string", "pattern": "^[^/].*\\.(sh|bash|ts|js)$" },
                  "post-deploy": { "type": "string", "pattern": "^[^/].*\\.(sh|bash|ts|js)$" },
                  "pre-build": { "type": "string", "pattern": "^[^/].*\\.(sh|bash|ts|js)$" },
                  "post-build": { "type": "string", "pattern": "^[^/].*\\.(sh|bash|ts|js)$" }
                },
                "additionalProperties": false
              }
            }
          }
        }
      }
    }
  }
}
```

**Constraints**:
- Hook paths must be relative (not absolute)
- Hook files must have `.sh`, `.bash`, `.ts`, or `.js` extension
- Hook files must exist and be executable (`chmod +x`)

### TypeScript Types

```typescript
// tools/brat/src/config/types.ts

export interface DeploymentHooks {
  'pre-deploy'?: string;
  'post-deploy'?: string;
  'pre-build'?: string;
  'post-build'?: string;
}

export interface DeploymentConfig {
  type: 'docker-compose' | 'cloud-run';
  hooks?: DeploymentHooks;
  docker?: DockerDeploymentConfig;
  gcp?: GcpDeploymentConfig;
}

export interface ExecutionContext {
  name: string;
  description?: string;
  deployment: DeploymentConfig;
  runtime?: RuntimeConfig;
  infrastructure?: InfrastructureConfig;
  tags?: string[];
}
```

### Hook Executor Implementation

```typescript
// tools/brat/src/orchestration/hooks/hook-executor.ts

import { execCmd } from '../exec';
import * as path from 'path';
import * as fs from 'fs';

export interface HookContext {
  contextName: string;
  deploymentType: string;
  targetHost?: string;
  remoteDir?: string;
  services: string[];
  repoRoot: string;
  verbose?: boolean;
}

export type HookType = 'pre-deploy' | 'post-deploy' | 'pre-build' | 'post-build';

export class HookExecutor {
  /**
   * Execute a deployment hook if defined in the execution context.
   *
   * @param hookType - Type of hook to execute
   * @param hookPath - Path to hook script (relative to repo root)
   * @param context - Hook execution context
   * @returns True if hook succeeded, false if hook not defined, throws on failure
   */
  async execute(
    hookType: HookType,
    hookPath: string | undefined,
    context: HookContext
  ): Promise<boolean> {
    if (!hookPath) {
      if (context.verbose) {
        console.log(`[hooks] No ${hookType} hook defined, skipping`);
      }
      return false;
    }

    const fullPath = path.join(context.repoRoot, hookPath);

    // Validate hook file exists
    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `${hookType} hook not found: ${hookPath}\n` +
        `Expected path: ${fullPath}\n` +
        `Check deployment.hooks.${hookType} in architecture.yaml executionContexts.${context.contextName}`
      );
    }

    // Validate hook file is executable (Unix-like systems only)
    if (process.platform !== 'win32') {
      const stats = fs.statSync(fullPath);
      const isExecutable = (stats.mode & 0o111) !== 0;
      if (!isExecutable) {
        throw new Error(
          `${hookType} hook is not executable: ${hookPath}\n` +
          `Run: chmod +x ${hookPath}`
        );
      }
    }

    console.log(`[hooks] Executing ${hookType} hook: ${hookPath}`);

    const startTime = Date.now();

    // Build environment variables for hook
    const env = {
      ...process.env,
      BRAT_CONTEXT_NAME: context.contextName,
      BRAT_DEPLOYMENT_TYPE: context.deploymentType,
      BRAT_SERVICES: context.services.join(' '),
      BRAT_REPO_ROOT: context.repoRoot,
    };

    if (context.targetHost) {
      env.BRAT_TARGET_HOST = context.targetHost;
    }

    if (context.remoteDir) {
      env.BRAT_REMOTE_DIR = context.remoteDir;
    }

    // Determine shell command based on file extension
    let cmd: string;
    let args: string[];

    if (hookPath.endsWith('.ts') || hookPath.endsWith('.js')) {
      // TypeScript/JavaScript hook - execute with Node.js
      cmd = hookPath.endsWith('.ts') ? 'npx' : 'node';
      args = hookPath.endsWith('.ts') ? ['ts-node', fullPath] : [fullPath];
    } else {
      // Shell script - execute directly
      cmd = fullPath;
      args = [];
    }

    // Execute hook
    const result = await execCmd(cmd, args, {
      cwd: context.repoRoot,
      env,
      stdio: 'inherit', // Stream output to console
    });

    const duration = Date.now() - startTime;

    if (result.code !== 0) {
      throw new Error(
        `${hookType} hook failed with exit code ${result.code}\n` +
        `Hook: ${hookPath}\n` +
        `Duration: ${duration}ms\n` +
        `Fix the hook script and retry deployment.`
      );
    }

    console.log(`[hooks] ✓ ${hookType} hook succeeded (${duration}ms)`);

    return true;
  }
}
```

### Integration into Deployment Strategies

#### Docker Compose Strategy

```typescript
// tools/brat/src/orchestration/deployment/docker-compose-strategy.ts

import { HookExecutor, HookType } from '../hooks/hook-executor';

export class DockerComposeStrategy implements DeploymentStrategy {
  private readonly hookExecutor = new HookExecutor();

  async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
    const startTime = Date.now();
    const service = plan.metadata.service;
    const context = plan.metadata.context;

    try {
      // ============================================================================
      // STAGE 1: Pre-Deploy Hook
      // ============================================================================
      await this.hookExecutor.execute(
        'pre-deploy',
        context.deployment.hooks?.['pre-deploy'],
        {
          contextName: context.name,
          deploymentType: context.deployment.type,
          targetHost: context.deployment.docker?.host,
          remoteDir: context.deployment.docker?.remoteDir,
          services: [service.name],
          repoRoot: plan.metadata.repoRoot,
          verbose: plan.options.verbose,
        }
      );

      // ============================================================================
      // STAGE 2: Sync files (remote only)
      // ============================================================================
      const isRemote = context.deployment.docker?.host?.startsWith('ssh://');
      if (isRemote) {
        await this.syncRemoteFiles(context);
      }

      // ============================================================================
      // STAGE 3: Pre-Build Hook
      // ============================================================================
      await this.hookExecutor.execute(
        'pre-build',
        context.deployment.hooks?.['pre-build'],
        {
          contextName: context.name,
          deploymentType: context.deployment.type,
          targetHost: context.deployment.docker?.host,
          remoteDir: context.deployment.docker?.remoteDir,
          services: [service.name],
          repoRoot: plan.metadata.repoRoot,
          verbose: plan.options.verbose,
        }
      );

      // ============================================================================
      // STAGE 4: Build images
      // ============================================================================
      const orchestrator = new DockerOrchestrator({
        repoRoot: plan.metadata.repoRoot,
        context: context.name,
        service: service.name,
        dryRun: plan.options.dryRun,
        forceRecreate: plan.options.forceRecreate,
        noCache: plan.options.forceBuild,
      });

      await orchestrator.build();

      // ============================================================================
      // STAGE 5: Post-Build Hook
      // ============================================================================
      await this.hookExecutor.execute(
        'post-build',
        context.deployment.hooks?.['post-build'],
        {
          contextName: context.name,
          deploymentType: context.deployment.type,
          targetHost: context.deployment.docker?.host,
          remoteDir: context.deployment.docker?.remoteDir,
          services: [service.name],
          repoRoot: plan.metadata.repoRoot,
          verbose: plan.options.verbose,
        }
      );

      // ============================================================================
      // STAGE 6: Start containers
      // ============================================================================
      await orchestrator.up();

      // ============================================================================
      // STAGE 7: Post-Deploy Hook
      // ============================================================================
      await this.hookExecutor.execute(
        'post-deploy',
        context.deployment.hooks?.['post-deploy'],
        {
          contextName: context.name,
          deploymentType: context.deployment.type,
          targetHost: context.deployment.docker?.host,
          remoteDir: context.deployment.docker?.remoteDir,
          services: [service.name],
          repoRoot: plan.metadata.repoRoot,
          verbose: plan.options.verbose,
        }
      );

      const durationMs = Date.now() - startTime;

      return {
        status: 'success',
        service: service.name,
        durationMs,
      };
    } catch (error: any) {
      return {
        status: 'failed',
        service: service.name,
        error: error.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
```

### Example Hook Scripts

#### Google Artifact Registry Authentication

```bash
# .brat/hooks/staging/pre-deploy-gcp-auth.sh
#!/bin/bash
set -e

CONTEXT="${BRAT_CONTEXT_NAME:-staging}"
REGISTRY="us-central1-docker.pkg.dev"
SA_KEY_PATH=".secure.${CONTEXT}/gcp-sa.json"

echo "[gcp-auth] Authenticating to ${REGISTRY}..."

# Method 1: Service account key file (preferred for remote deployments)
if [ -f "${SA_KEY_PATH}" ]; then
  cat "${SA_KEY_PATH}" | docker login -u _json_key --password-stdin "${REGISTRY}"
  echo "[gcp-auth] ✓ Authenticated via service account key"
  exit 0
fi

# Method 2: gcloud credential helper (for local deployments with gcloud installed)
if command -v gcloud &> /dev/null; then
  gcloud auth configure-docker "${REGISTRY}" --quiet
  echo "[gcp-auth] ✓ Configured gcloud credential helper"
  exit 0
fi

# Method 3: Short-lived access token (if gcloud is available but can't configure helper)
if command -v gcloud &> /dev/null; then
  gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "${REGISTRY}"
  echo "[gcp-auth] ✓ Authenticated via gcloud access token"
  exit 0
fi

echo "[gcp-auth] ✗ No authentication method available"
echo "Tried:"
echo "  1. Service account key: ${SA_KEY_PATH} (not found)"
echo "  2. gcloud CLI (not installed)"
echo ""
echo "To fix:"
echo "  - Place GCP service account key at ${SA_KEY_PATH}"
echo "  - OR install gcloud CLI: https://cloud.google.com/sdk/docs/install"
exit 1
```

#### AWS ECR Authentication

```bash
# .brat/hooks/prod/pre-deploy-ecr-auth.sh
#!/bin/bash
set -e

CONTEXT="${BRAT_CONTEXT_NAME:-prod}"
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="${AWS_ACCOUNT_ID}"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "[ecr-auth] Authenticating to ${REGISTRY}..."

# Validate AWS_ACCOUNT_ID is set
if [ -z "${ACCOUNT_ID}" ]; then
  echo "[ecr-auth] ✗ AWS_ACCOUNT_ID not set"
  echo "Set AWS_ACCOUNT_ID in .secure.${CONTEXT}/.env or as environment variable"
  exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "[ecr-auth] ✗ AWS CLI not installed"
  echo "Install: https://aws.amazon.com/cli/"
  exit 1
fi

# Get ECR login password and authenticate
aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin "${REGISTRY}"

echo "[ecr-auth] ✓ Authenticated to ECR"
exit 0
```

#### Multi-Registry Authentication

```bash
# .brat/hooks/staging/pre-deploy.sh
#!/bin/bash
set -e

CONTEXT="${BRAT_CONTEXT_NAME:-staging}"

echo "[pre-deploy] Authenticating to all required registries..."

# Google Artifact Registry
if [ -f ".secure.${CONTEXT}/gcp-sa.json" ]; then
  cat ".secure.${CONTEXT}/gcp-sa.json" | \
    docker login -u _json_key --password-stdin us-central1-docker.pkg.dev
  echo "[pre-deploy] ✓ Authenticated to Google Artifact Registry"
fi

# Docker Hub (private images)
if [ -n "${DOCKER_HUB_USER}" ] && [ -n "${DOCKER_HUB_TOKEN}" ]; then
  echo "${DOCKER_HUB_TOKEN}" | docker login -u "${DOCKER_HUB_USER}" --password-stdin docker.io
  echo "[pre-deploy] ✓ Authenticated to Docker Hub"
fi

# GitHub Container Registry (ghcr.io)
if [ -n "${GITHUB_TOKEN}" ]; then
  echo "${GITHUB_TOKEN}" | docker login -u "${GITHUB_USER}" --password-stdin ghcr.io
  echo "[pre-deploy] ✓ Authenticated to GitHub Container Registry"
fi

echo "[pre-deploy] ✓ Authentication complete"
exit 0
```

#### Health Check Post-Deploy Hook

```bash
# .brat/hooks/staging/post-deploy.sh
#!/bin/bash
set -e

SERVICES="${BRAT_SERVICES}"
TARGET="${BRAT_TARGET_HOST}"

echo "[post-deploy] Running health checks for: ${SERVICES}"

# Wait for containers to be healthy (30 second timeout)
for service in ${SERVICES}; do
  echo "[post-deploy] Checking ${service}..."

  # For remote deployments, use SSH
  if [[ "${TARGET}" == ssh://* ]]; then
    ssh_host="${TARGET#ssh://}"
    ssh "${ssh_host}" "timeout 30 docker wait ${service}" || {
      echo "[post-deploy] ✗ ${service} failed to start"
      exit 1
    }
  else
    # Local deployment
    timeout 30 docker wait "${service}" || {
      echo "[post-deploy] ✗ ${service} failed to start"
      exit 1
    }
  fi

  echo "[post-deploy] ✓ ${service} is healthy"
done

echo "[post-deploy] ✓ All services healthy"
exit 0
```

---

## Implementation Plan

### Phase 1: Core Hook System (Sprint 15)

**Deliverables**:
1. ✅ Technical Architecture Document (this document)
2. TypeScript types for `DeploymentHooks` in `config/types.ts`
3. `HookExecutor` class in `orchestration/hooks/hook-executor.ts`
4. Schema validation for `executionContexts.*.deployment.hooks`
5. Integration into `DockerComposeStrategy.execute()`
6. Unit tests for `HookExecutor`
7. Integration tests for hook execution flow

**Acceptance Criteria**:
- Hook executor validates file existence and permissions
- Hook executor passes correct environment variables
- Hook executor logs execution status and duration
- Hook failures abort deployment with clear error message
- Hooks are optional (backward compatible)

**Estimated Effort**: 2-3 days

### Phase 2: Example Hooks & Documentation (Sprint 15)

**Deliverables**:
1. Example hooks in `documentation/examples/hooks/`:
   - `gcp-artifact-registry-auth.sh`
   - `aws-ecr-auth.sh`
   - `azure-acr-auth.sh`
   - `docker-hub-auth.sh`
   - `multi-registry-auth.sh`
   - `health-check-post-deploy.sh`
2. Hook development guide: `documentation/guides/deployment-hooks.md`
3. Hook security guide: `documentation/guides/hook-security-best-practices.md`
4. Update `documentation/guides/extending-bitbrat.md` with hooks section

**Acceptance Criteria**:
- Example hooks cover all major registry providers
- Documentation explains hook contract and environment variables
- Security guide covers secret management and credential handling
- Examples are copy-paste ready for common use cases

**Estimated Effort**: 1-2 days

### Phase 3: obs-mcp Deployment Fix (Sprint 15)

**Deliverables**:
1. GCP authentication hook for staging context
2. Update `architecture.yaml` to reference hook
3. Test deployment to staging environment
4. Verification report confirming successful deployment

**Implementation**:

```yaml
# architecture.yaml
executionContexts:
  staging:
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/bitbrat-staging
      hooks:
        pre-deploy: .brat/hooks/staging/pre-deploy-gcp-auth.sh
```

```bash
# .brat/hooks/staging/pre-deploy-gcp-auth.sh
#!/bin/bash
set -e

REGISTRY="us-central1-docker.pkg.dev"
SA_KEY=".secure.staging/gcp-sa.json"

if [ -f "${SA_KEY}" ]; then
  cat "${SA_KEY}" | docker login -u _json_key --password-stdin "${REGISTRY}"
  echo "✓ Authenticated to ${REGISTRY}"
else
  echo "✗ Service account key not found: ${SA_KEY}"
  exit 1
fi
```

**Acceptance Criteria**:
- `npm run brat -- bit deploy obs-mcp --context staging` succeeds
- obs-mcp container starts and passes health check
- Hook execution logged in deployment output

**Estimated Effort**: 0.5 days

### Phase 4: Cloud Run Support (Future Sprint)

**Deliverables**:
1. Hook execution in `CloudRunStrategy`
2. Pre-build hooks for Cloud Build authentication
3. Example hooks for GCP Artifact Registry push/pull

**Note**: Cloud Run deployments already handle authentication via Service Account IAM, so hooks are primarily for non-standard scenarios (e.g., pulling base images from external registries during Cloud Build).

**Estimated Effort**: 1 day

### Phase 5: Advanced Features (Future)

**Potential Enhancements**:
- TypeScript/JavaScript hook support (currently shell only)
- Hook templating (parameterized hooks)
- Hook discovery (auto-detect hooks in `.brat/hooks/`)
- Hook dry-run mode (validate hooks without executing)
- Hook timeout configuration
- Hook retry logic
- Parallel hook execution
- Hook marketplace (community-contributed hooks)

---

## Migration Strategy

### Backward Compatibility

**No Breaking Changes**:
- Hooks are **optional** (opt-in feature)
- Existing deployments without hooks continue to work unchanged
- No changes to existing `architecture.yaml` schema (hooks are additive)

### Migration Path for obs-mcp

**Current State**:
```yaml
services:
  obs-mcp:
    active: false  # Cannot deploy to staging (no auth)
    image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
```

**Step 1**: Enable obs-mcp
```yaml
services:
  obs-mcp:
    active: true  # Enable service
```

**Step 2**: Create staging pre-deploy hook
```bash
# .brat/hooks/staging/pre-deploy.sh
#!/bin/bash
set -e
cat .secure.staging/gcp-sa.json | docker login -u _json_key --password-stdin us-central1-docker.pkg.dev
chmod +x .brat/hooks/staging/pre-deploy.sh
```

**Step 3**: Configure hook in context
```yaml
executionContexts:
  staging:
    deployment:
      hooks:
        pre-deploy: .brat/hooks/staging/pre-deploy.sh
```

**Step 4**: Deploy
```bash
npm run brat -- bit deploy obs-mcp --context staging
```

### Rollout Plan

**Phase 1**: Internal testing (Sprint 15)
- Implement hook system
- Test with obs-mcp deployment to staging
- Document findings and edge cases

**Phase 2**: Documentation (Sprint 15)
- Publish example hooks
- Write deployment hooks guide
- Update extending-bitbrat.md

**Phase 3**: Gradual adoption (Sprint 16+)
- Add hooks to other contexts as needed
- Collect user feedback
- Refine hook system based on real-world usage

---

## Security Considerations

### Threat Model

**Threats**:
1. **T1**: Secrets leaked in hook scripts committed to git
2. **T2**: Secrets logged to console during hook execution
3. **T3**: Malicious hook scripts executing arbitrary code
4. **T4**: Hook scripts exposing secrets in process listing
5. **T5**: Insecure credential storage in hook scripts

**Mitigations**:

**M1 (T1)**: Hook script guidelines
- Store secrets in `.secure.{ENV}/` (git-ignored)
- Use environment variables, not hardcoded secrets
- Lint hook scripts for potential secret leaks

**M2 (T2)**: Docker login output suppression
- Use `--password-stdin` (prevents password in process args)
- Capture docker login output to prevent token leakage
- Log only success/failure status, not credentials

**M3 (T3)**: Hook validation
- Require hooks to be in project-controlled directories (`.brat/hooks/`)
- Warn if hook path is outside repo
- Document best practices for hook security review

**M4 (T4)**: Process argument security
- Use stdin for passwords (`--password-stdin`)
- Avoid passing secrets as command-line arguments
- Use environment variables when necessary

**M5 (T5)**: Secret management integration
- Document integration with `.secure.{ENV}/` pattern
- Provide examples using secret files, not hardcoded values
- Support secret injection via environment variables

### Security Best Practices for Hook Authors

**DO**:
- ✅ Store secrets in `.secure.{ENV}/` directory
- ✅ Use `--password-stdin` for docker login
- ✅ Check file permissions (`chmod 400` for key files)
- ✅ Validate required environment variables are set
- ✅ Use `set -e` to fail fast on errors
- ✅ Log informational messages to stdout
- ✅ Log errors to stderr
- ✅ Exit with non-zero code on failure

**DON'T**:
- ❌ Hardcode secrets in hook scripts
- ❌ Echo secrets to console
- ❌ Pass secrets as command-line arguments (visible in `ps`)
- ❌ Store secrets in environment variables unless necessary
- ❌ Commit hook scripts with actual secret values
- ❌ Use `docker login -p <password>` (use `-password-stdin`)

**Example (Secure)**:
```bash
#!/bin/bash
set -e

SA_KEY=".secure.staging/gcp-sa.json"

# Validate key file exists
if [ ! -f "${SA_KEY}" ]; then
  echo "ERROR: Service account key not found: ${SA_KEY}" >&2
  exit 1
fi

# Authenticate using stdin (secure)
cat "${SA_KEY}" | docker login -u _json_key --password-stdin us-central1-docker.pkg.dev

echo "✓ Authenticated to Artifact Registry"
```

**Example (Insecure - DON'T DO THIS)**:
```bash
#!/bin/bash

# ❌ BAD: Hardcoded secret
PASSWORD="super-secret-password"

# ❌ BAD: Secret visible in process args
docker login -u user -p "${PASSWORD}" docker.io

# ❌ BAD: Secret logged to console
echo "Using password: ${PASSWORD}"
```

---

## References

### Related Documentation

- **BitBrat Platform**: `architecture.yaml` - Execution contexts and deployment config
- **Docker Compose**: https://docs.docker.com/compose/
- **Docker Registry Authentication**: https://docs.docker.com/engine/reference/commandline/login/
- **GCP Artifact Registry Auth**: https://cloud.google.com/artifact-registry/docs/docker/authentication
- **AWS ECR Auth**: https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html
- **Azure ACR Auth**: https://docs.microsoft.com/en-us/azure/container-registry/container-registry-authentication

### Code References

**Deployment Strategies**:
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` - Docker Compose deployment
- `tools/brat/src/orchestration/deployment/cloud-run-strategy.ts` - Cloud Run deployment

**Docker Orchestrator**:
- `tools/brat/src/orchestration/docker/orchestrator.ts` - Docker command execution

**Configuration**:
- `tools/brat/src/config/types.ts` - Execution context types
- `tools/brat/src/config/execution-context-schema.ts` - Schema validation

**Utilities**:
- `tools/brat/src/orchestration/exec.ts` - Command execution wrapper

### Prior Art

**Deployment Lifecycle Hooks in Other Systems**:
- **Kubernetes**: Lifecycle hooks (postStart, preStop)
- **Helm**: Chart hooks (pre-install, post-install, pre-upgrade, etc.)
- **Cloud Foundry**: Buildpack lifecycle hooks
- **Heroku**: Release phase (post-build, pre-deploy)
- **Docker Compose**: No native hooks (gap this proposal addresses)

---

## Appendix

### A. Hook Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `BRAT_CONTEXT_NAME` | Execution context name | `staging` |
| `BRAT_DEPLOYMENT_TYPE` | Deployment strategy | `docker-compose` |
| `BRAT_TARGET_HOST` | Deployment target host | `ssh://root@bitbrat.lan` |
| `BRAT_REMOTE_DIR` | Remote deployment directory | `/opt/bitbrat-staging` |
| `BRAT_SERVICES` | Space-separated service list | `obs-mcp llm-bot` |
| `BRAT_REPO_ROOT` | Repository root directory | `/Users/user/BitBratPlatform` |

### B. Hook Exit Codes

| Exit Code | Meaning | Deployment Action |
|-----------|---------|-------------------|
| 0 | Success | Continue deployment |
| 1-255 | Failure | Abort deployment, display error |

### C. Supported Hook File Extensions

| Extension | Interpreter | Notes |
|-----------|-------------|-------|
| `.sh` | `bash` | Default shell script |
| `.bash` | `bash` | Explicit bash script |
| `.ts` | `npx ts-node` | TypeScript (requires ts-node) |
| `.js` | `node` | JavaScript (Node.js) |

### D. Example: Remote Hook Execution Flow

```
Local Machine                        Remote Host (bitbrat.lan)
├─ Load architecture.yaml
├─ Resolve context: staging
├─ Execute pre-deploy hook           [Runs on local machine]
│  └─ .brat/hooks/staging/pre-deploy.sh
│     └─ docker login (local daemon) ← Auth credentials cached locally
│
├─ Sync files via rsync              ──────────────────────→ Receive source code
│  └─ src/, Dockerfiles, compose                            └─ Write to /opt/bitbrat-staging/
│
├─ SSH: Execute pre-build hook       ──────────────────────→ Execute hook on remote
│                                                              └─ docker login (remote daemon)
│                                                                 └─ Auth credentials cached remotely
│
├─ SSH: docker compose build         ──────────────────────→ Build images on remote
│                                                              └─ Use cached credentials to pull base images
│
├─ SSH: docker compose up            ──────────────────────→ Start containers on remote
│                                                              └─ Use cached credentials to pull service images
│
├─ Execute post-deploy hook          ──────────────────────→ Execute hook on remote
   └─ Health checks, notifications                            └─ Verify containers are healthy
```

**Key Insight**: Pre-deploy hook runs **locally** (before sync), pre-build/post-build/post-deploy hooks can run **remotely** (after sync). This allows authentication on both local and remote Docker daemons as needed.

---

## Decision Log

**Decision**: Adopt deployment lifecycle hooks (Option 3) as the mechanism for private registry authentication and deployment customization.

**Date**: 2026-08-16

**Rationale**:
1. Provides maximum flexibility for BEC-specific and project-specific requirements
2. Implementation-independent (no hard-coded provider logic)
3. Extensible beyond authentication (validation, monitoring, notifications)
4. Backward compatible (hooks are optional)
5. Simple to implement and test
6. Aligns with industry best practices (Helm, Kubernetes, etc.)

**Trade-offs Accepted**:
- Requires users to write shell scripts (adds complexity)
- Hook scripts must be maintained per-project
- Security depends on hook author following best practices

**Alternatives Considered**:
- Option 1 (Hard-coded providers): Rejected - not extensible
- Option 2 (Registry config in architecture.yaml): Rejected - limited flexibility
- Option 4 (Plugin system): Deferred - over-engineered for current needs

**Next Steps**:
1. Implement `HookExecutor` class
2. Integrate into `DockerComposeStrategy`
3. Create example hooks for GCR authentication
4. Document hook system in deployment hooks guide
5. Test with obs-mcp deployment to staging

---

**Document Status**: ✅ Ready for Review
**Review Required By**: Product Owner, Lead Engineer
**Target Implementation**: Sprint 15 (2026-08-16 - 2026-08-30)
