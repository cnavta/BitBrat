# Technical Architecture: Custom Container Registry Support

**Sprint**: 370-custom-registry
**Author**: Architect
**Date**: 2026-07-27
**Status**: DRAFT for Review

---

## Executive Summary

This document defines the technical architecture for adding custom container registry support to BitBrat Platform. Currently, the platform hardcodes GCP Artifact Registry URLs in multiple locations, making it impossible to use alternative registries (Docker Hub, AWS ECR, Azure ACR, GitHub Container Registry, private registries, etc.).

### Goals
1. **Registry Abstraction**: Centralize registry configuration in `architecture.yaml`
2. **Multi-Platform Support**: Enable Docker Compose (local/staging) and Cloud Run (production) to use custom registries
3. **Backward Compatibility**: Maintain existing GCP Artifact Registry behavior as default
4. **Developer Experience**: Simple configuration with sensible defaults

### Non-Goals
- Registry authentication management (assumes credentials are configured externally via `docker login`, GCP service accounts, etc.)
- Automated registry provisioning or lifecycle management
- Image mirroring or replication between registries
- Registry-specific optimizations (caching, pull-through, etc.)

---

## Current State Analysis

### Hardcoded Registry References

**Problem**: Registry URLs are scattered across the codebase:

1. **Cloud Build Configurations** (`cloudbuild.*.yaml`):
   ```yaml
   substitutions:
     _IMAGE: us-central1-docker.pkg.dev/$PROJECT_ID/bitbrat/llm-bot:${SHORT_SHA}
   ```

2. **Docker Compose Files** (`infrastructure/docker-compose/services/*.compose.yaml`):
   ```yaml
   services:
     obs-mcp:
       image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
   ```

3. **Deployment Code** (`tools/brat/src/oclif-commands/deploy/service.ts:110`):
   ```typescript
   const repoName = flags.repo || 'bitbrat-services';
   // Hardcoded: assumed to be GCP Artifact Registry
   ```

4. **Image URL Construction** (implicit pattern):
   ```
   {region}-docker.pkg.dev/{project}/{repo}/{service}:{tag}
   ```

### Current Image Workflow

**Local Development (Docker Compose)**:
1. Services specify `build.context` and `build.dockerfile` OR prebuilt `image`
2. `docker-compose up` builds images locally or pulls from registry
3. No registry push (images stay local)

**Production Deployment (Cloud Run via Cloud Build)**:
1. `brat deploy service <name>` triggers Cloud Build
2. Cloud Build builds image using `Dockerfile.service`
3. Image pushed to `us-central1-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:${TAG}`
4. `gcloud run deploy` uses pushed image

**Limitations**:
- Cannot use alternative registries (Docker Hub, ECR, ACR, etc.)
- Cannot use different registries per environment (dev uses local, staging uses Harbor, prod uses GCP)
- Cannot use org-wide registries or multi-project shared registries
- Hardcoded region (`us-central1`)

---

## Proposed Architecture

### 1. Registry Configuration Schema

Add top-level `registries` section to `architecture.yaml`:

```yaml
# architecture.yaml
registries:
  # Default registry (used if not overridden by context or service)
  default: gcp-artifact-registry

  # Registry definitions
  definitions:
    gcp-artifact-registry:
      type: gcp-artifact-registry
      url: us-central1-docker.pkg.dev
      project: ${PROJECT_ID}
      repository: bitbrat-services
      # Pattern: {url}/{project}/{repository}/{service}:{tag}

    docker-hub:
      type: docker-hub
      url: docker.io
      namespace: bitbratplatform
      # Pattern: {url}/{namespace}/{service}:{tag}

    github-cr:
      type: github-cr
      url: ghcr.io
      namespace: yourorg
      # Pattern: {url}/{namespace}/{service}:{tag}

    aws-ecr:
      type: aws-ecr
      url: 123456789012.dkr.ecr.us-east-1.amazonaws.com
      repository: bitbrat
      # Pattern: {url}/{repository}/{service}:{tag}

    azure-acr:
      type: azure-acr
      url: bitbratregistry.azurecr.io
      # Pattern: {url}/{service}:{tag}

    harbor:
      type: harbor
      url: harbor.bitbrat.lan
      project: bitbrat
      # Pattern: {url}/{project}/{service}:{tag}

    generic:
      type: generic
      url: registry.example.com:5000
      prefix: bitbrat/services
      # Pattern: {url}/{prefix}/{service}:{tag}

# Execution contexts can override registry per environment
executionContexts:
  local:
    deployment:
      type: docker-compose
      registry: docker-hub  # Override: use Docker Hub for local
    # ... rest of config

  staging:
    deployment:
      type: docker-compose
      registry: harbor  # Override: use private Harbor for staging
    # ... rest of config

  prod:
    deployment:
      type: cloud-run
      registry: gcp-artifact-registry  # Override: use GCP for production
    # ... rest of config

# Per-service overrides (rare, but supported)
services:
  obs-mcp:
    active: true
    registry: github-cr  # Override: pull from GitHub Container Registry
    image: ghcr.io/yourorg/obs-mcp:latest
    # ... rest of config
```

### 2. Registry URL Pattern Resolution

**Templating Engine**:

Each registry type has a pattern for constructing image URLs:

| Type | Pattern | Example |
|------|---------|---------|
| `gcp-artifact-registry` | `{url}/{project}/{repository}/{service}:{tag}` | `us-central1-docker.pkg.dev/twitch-452523/bitbrat-services/llm-bot:v0.18.3` |
| `docker-hub` | `{url}/{namespace}/{service}:{tag}` | `docker.io/bitbratplatform/llm-bot:v0.18.3` |
| `github-cr` | `{url}/{namespace}/{service}:{tag}` | `ghcr.io/yourorg/llm-bot:v0.18.3` |
| `aws-ecr` | `{url}/{repository}/{service}:{tag}` | `123456789012.dkr.ecr.us-east-1.amazonaws.com/bitbrat/llm-bot:v0.18.3` |
| `azure-acr` | `{url}/{service}:{tag}` | `bitbratregistry.azurecr.io/llm-bot:v0.18.3` |
| `harbor` | `{url}/{project}/{service}:{tag}` | `harbor.bitbrat.lan/bitbrat/llm-bot:v0.18.3` |
| `generic` | `{url}/{prefix}/{service}:{tag}` | `registry.example.com:5000/bitbrat/services/llm-bot:v0.18.3` |

**Resolution Priority** (highest to lowest):
1. Service-level `service.registry` + `service.image` (explicit override)
2. Execution context `executionContexts.<name>.deployment.registry`
3. Platform default `registries.default`
4. Fallback: GCP Artifact Registry (backward compatibility)

### 3. Implementation Changes

#### 3.1 Config Schema (`tools/brat/src/config/schema.ts`)

Add registry types to configuration schema:

```typescript
// New registry type definitions
export const RegistryDefinitionSchema = z.object({
  type: z.enum([
    'gcp-artifact-registry',
    'docker-hub',
    'github-cr',
    'aws-ecr',
    'azure-acr',
    'harbor',
    'generic',
  ]),
  url: z.string(),
  // Optional fields (vary by type)
  project: z.string().optional(),
  repository: z.string().optional(),
  namespace: z.string().optional(),
  prefix: z.string().optional(),
});

export const RegistriesConfigSchema = z.object({
  default: z.string(),
  definitions: z.record(z.string(), RegistryDefinitionSchema),
});

// Update root schema
export const ArchitectureYamlSchema = z.object({
  // ... existing fields
  registries: RegistriesConfigSchema.optional(),
  // ... existing fields
});

// Update ExecutionContextDeploymentSchema
export const ExecutionContextDeploymentSchema = z.object({
  type: z.enum(['docker-compose', 'cloud-run', 'k8s']),
  registry: z.string().optional(), // Reference to registries.definitions key
  // ... existing fields
});

// Update ServiceSchema
export const ServiceSchema = z.object({
  // ... existing fields
  registry: z.string().optional(), // Reference to registries.definitions key
  // ... existing fields
});
```

#### 3.2 Registry URL Builder (`tools/brat/src/util/registry.ts`)

New utility module for registry URL construction:

```typescript
import { RegistryDefinition } from '../config/schema';

export interface ImageUrlParams {
  service: string;
  tag: string;
  registry: RegistryDefinition;
  projectId?: string; // For variable substitution
}

export function buildImageUrl(params: ImageUrlParams): string {
  const { service, tag, registry, projectId } = params;

  // Substitute environment variables
  const substituted = {
    url: substituteVars(registry.url, { PROJECT_ID: projectId }),
    project: substituteVars(registry.project || '', { PROJECT_ID: projectId }),
    repository: registry.repository || '',
    namespace: registry.namespace || '',
    prefix: registry.prefix || '',
  };

  // Build URL based on registry type
  switch (registry.type) {
    case 'gcp-artifact-registry':
      return `${substituted.url}/${substituted.project}/${substituted.repository}/${service}:${tag}`;

    case 'docker-hub':
      return `${substituted.url}/${substituted.namespace}/${service}:${tag}`;

    case 'github-cr':
      return `${substituted.url}/${substituted.namespace}/${service}:${tag}`;

    case 'aws-ecr':
      return `${substituted.url}/${substituted.repository}/${service}:${tag}`;

    case 'azure-acr':
      return `${substituted.url}/${service}:${tag}`;

    case 'harbor':
      return `${substituted.url}/${substituted.project}/${service}:${tag}`;

    case 'generic':
      return `${substituted.url}/${substituted.prefix}/${service}:${tag}`;

    default:
      throw new Error(`Unsupported registry type: ${registry.type}`);
  }
}

export function resolveRegistry(
  serviceName: string,
  serviceConfig: ResolvedServiceConfig,
  contextConfig: ExecutionContext,
  platformConfig: ArchitectureYaml
): RegistryDefinition {
  // Priority 1: Service-level override
  if (serviceConfig.registry) {
    const def = platformConfig.registries?.definitions[serviceConfig.registry];
    if (!def) throw new Error(`Registry not found: ${serviceConfig.registry}`);
    return def;
  }

  // Priority 2: Execution context override
  if (contextConfig.deployment.registry) {
    const def = platformConfig.registries?.definitions[contextConfig.deployment.registry];
    if (!def) throw new Error(`Registry not found: ${contextConfig.deployment.registry}`);
    return def;
  }

  // Priority 3: Platform default
  if (platformConfig.registries?.default) {
    const def = platformConfig.registries.definitions[platformConfig.registries.default];
    if (!def) throw new Error(`Default registry not found: ${platformConfig.registries.default}`);
    return def;
  }

  // Priority 4: Fallback (backward compatibility)
  return {
    type: 'gcp-artifact-registry',
    url: 'us-central1-docker.pkg.dev',
    project: '${PROJECT_ID}',
    repository: 'bitbrat-services',
  };
}

function substituteVars(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\$\{([A-Z_]+)\}/g, (match, varName) => {
    return vars[varName] || match;
  });
}
```

#### 3.3 Deployment Command Updates

**`tools/brat/src/oclif-commands/deploy/service.ts`**:

```typescript
// Line ~110: Replace hardcoded repo with registry resolution
import { resolveRegistry, buildImageUrl } from '../../util/registry';

// ... in run() method:

const registry = resolveRegistry(svc.name, svc, this.context, cfg);
const imageUrl = buildImageUrl({
  service: svc.name,
  tag,
  registry,
  projectId,
});

// Update substitutions
const substitutions = computeDeploySubstitutions({
  svc,
  region: flags.region,
  tag,
  allowUnauth: effectiveAllowUnauth,
  dockerfile,
  envVarsArg: envVarsFileRel ? '' : envFiltered,
  envVarsFile: envVarsFileRel,
  secretSetArg: secretMap,
  ingressPolicy,
  vpcConnectorName,
  image: svc.image || imageUrl, // Use explicit image or constructed URL
  registry: registry.url, // Pass registry URL for build context
});
```

**`tools/brat/src/cli/index.ts`** (`computeDeploySubstitutions`):

```typescript
export function computeDeploySubstitutions(opts: {
  svc: ResolvedServiceConfig;
  repoName?: string; // DEPRECATED: will be removed
  region?: string;
  tag: string;
  allowUnauth: boolean;
  dockerfile: string;
  envVarsArg: string;
  envVarsFile: string;
  secretSetArg: string;
  ingressPolicy: string;
  vpcConnectorName: string;
  image?: string;
  registry?: string; // NEW: registry URL for build context
}): Record<string, string> {
  // ... existing logic

  // Use registry-based image URL if provided
  const imageUrl = opts.image ||
    `${opts.registry}/${opts.repoName || 'bitbrat-services'}/${opts.svc.name}:${opts.tag}`;

  return {
    _SERVICE_NAME: opts.svc.name,
    _REGION: opts.region || opts.svc.region || 'us-central1',
    _IMAGE: imageUrl,
    _DOCKERFILE: opts.dockerfile || 'Dockerfile.service',
    // ... rest of substitutions
  };
}
```

#### 3.4 Docker Compose Generation

**`tools/brat/src/orchestration/docker-compose.ts`** (new utility):

```typescript
import { resolveRegistry, buildImageUrl } from '../util/registry';

export function generateServiceComposeConfig(
  svc: ResolvedServiceConfig,
  context: ExecutionContext,
  cfg: ArchitectureYaml,
  tag: string
): object {
  // If explicit image is provided, use it
  if (svc.image) {
    return {
      image: svc.image,
      // ... rest of config
    };
  }

  // Otherwise, build from source or use registry URL
  const registry = resolveRegistry(svc.name, svc, context, cfg);
  const imageUrl = buildImageUrl({
    service: svc.name,
    tag,
    registry,
    projectId: process.env.PROJECT_ID,
  });

  // Local contexts typically build from source
  if (context.deployment.type === 'docker-compose' && context.name === 'local') {
    return {
      build: {
        context: '.',
        dockerfile: `Dockerfile.${svc.name}`,
        args: {
          SERVICE_NAME: svc.name,
          SERVICE_ENTRY: svc.entry.replace('src/', 'dist/').replace('.ts', '.js'),
          SERVICE_PORT: String(svc.port || 3000),
        },
      },
      image: imageUrl, // Tag built image with registry URL for potential push
      // ... rest of config
    };
  }

  // Remote/staging contexts may pull from registry
  return {
    image: imageUrl,
    // ... rest of config
  };
}
```

#### 3.5 Cloud Build Configuration Updates

**Option A: Dynamic Cloud Build Config Generation** (Recommended)

Instead of static `cloudbuild.*.yaml` files, generate Cloud Build config dynamically:

```typescript
// tools/brat/src/providers/gcp/cloudbuild-generator.ts
export function generateCloudBuildConfig(opts: {
  service: ResolvedServiceConfig;
  imageUrl: string;
  dockerfile: string;
  region: string;
  env: Record<string, string>;
  secrets: Record<string, string>;
}): object {
  const { service, imageUrl, dockerfile, region, env, secrets } = opts;

  // Deployment-only config (for prebuilt images)
  if (service.image) {
    return {
      steps: [
        {
          id: 'Deploy to Cloud Run',
          name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
          entrypoint: 'gcloud',
          args: [
            'run', 'deploy', service.name,
            `--image=${imageUrl}`,
            `--platform=managed`,
            `--region=${region}`,
            // ... env and secrets args
          ],
        },
      ],
    };
  }

  // Build + Deploy config
  return {
    steps: [
      {
        id: 'Build image',
        name: 'gcr.io/cloud-builders/docker',
        args: [
          'build',
          '-t', imageUrl,
          '-f', dockerfile,
          '--build-arg', `SERVICE_NAME=${service.name}`,
          '--build-arg', `SERVICE_ENTRY=${service.entry}`,
          '--build-arg', `SERVICE_PORT=${service.port}`,
          '.',
        ],
      },
      {
        id: 'Push image',
        name: 'gcr.io/cloud-builders/docker',
        args: ['push', imageUrl],
      },
      {
        id: 'Deploy to Cloud Run',
        name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
        entrypoint: 'gcloud',
        args: [
          'run', 'deploy', service.name,
          `--image=${imageUrl}`,
          `--platform=managed`,
          `--region=${region}`,
          // ... env and secrets args
        ],
      },
    ],
    images: [imageUrl],
  };
}
```

**Option B: Template-Based Cloud Build** (Simpler, but less flexible)

Keep existing `cloudbuild.*.yaml` files, but use `${_REGISTRY}` substitution:

```yaml
# cloudbuild.oauth-flow.yaml
substitutions:
  _REGISTRY: us-central1-docker.pkg.dev  # Default, overridden by brat
  _REPOSITORY: bitbrat-services
  _IMAGE: ${_REGISTRY}/${_REPOSITORY}/${_SERVICE_NAME}:${_TAG}
```

**Recommendation**: Use **Option A** for maximum flexibility and eliminate static config files.

#### 3.6 Local Docker Compose Updates

Update generated compose files to use registry URLs:

```yaml
# infrastructure/docker-compose/services/llm-bot.compose.yaml
services:
  llm-bot:
    build:
      context: .
      dockerfile: Dockerfile.service
      args:
        SERVICE_NAME: llm-bot
        SERVICE_ENTRY: dist/apps/llm-bot-service.js
        SERVICE_PORT: "3000"
    image: docker.io/bitbratplatform/llm-bot:latest  # Uses registry URL
    # ... rest of config
```

### 4. Migration Strategy

#### Phase 1: Schema & Utilities (Non-Breaking)
1. Add `registries` schema to `architecture.yaml`
2. Implement registry URL builder utilities
3. Add backward-compatible registry resolution (fallback to GCP)
4. No user-facing changes

#### Phase 2: Deployment Integration (Opt-In)
1. Update `brat deploy service` to use registry resolution
2. Update Cloud Build config generation
3. Users can opt-in via `registries` config in `architecture.yaml`
4. Existing deployments continue to work (fallback behavior)

#### Phase 3: Docker Compose Integration (Opt-In)
1. Update Docker Compose generation to use registry URLs
2. Update `brat context create` to prompt for registry configuration
3. Users can opt-in via `executionContexts.<name>.deployment.registry`

#### Phase 4: Documentation & Migration Guide
1. Document registry configuration in `documentation/guides/custom-registry.md`
2. Provide migration examples for common registries (Docker Hub, ECR, ACR, Harbor)
3. Update CLAUDE.md with registry configuration patterns

### 5. Configuration Examples

#### Example 1: Docker Hub for All Environments

```yaml
registries:
  default: docker-hub
  definitions:
    docker-hub:
      type: docker-hub
      url: docker.io
      namespace: bitbratplatform

executionContexts:
  local:
    deployment:
      type: docker-compose
      # Uses default (docker-hub)
    # ... rest of config
```

#### Example 2: Multi-Registry (Local/Staging/Prod)

```yaml
registries:
  default: gcp-artifact-registry
  definitions:
    local-registry:
      type: generic
      url: localhost:5000
      prefix: bitbrat

    staging-harbor:
      type: harbor
      url: harbor.bitbrat.lan
      project: bitbrat-staging

    prod-gcp:
      type: gcp-artifact-registry
      url: us-central1-docker.pkg.dev
      project: twitch-452523
      repository: bitbrat-prod

executionContexts:
  local:
    deployment:
      type: docker-compose
      registry: local-registry

  staging:
    deployment:
      type: docker-compose
      registry: staging-harbor

  prod:
    deployment:
      type: cloud-run
      registry: prod-gcp
```

#### Example 3: AWS ECR for Production

```yaml
registries:
  default: aws-ecr
  definitions:
    aws-ecr:
      type: aws-ecr
      url: 123456789012.dkr.ecr.us-east-1.amazonaws.com
      repository: bitbrat

executionContexts:
  prod:
    deployment:
      type: cloud-run
      registry: aws-ecr
```

---

## Security Considerations

### Authentication & Authorization

**Registry Authentication** is handled **externally** to BitBrat:

1. **Local Development**:
   - Developers run `docker login <registry-url>` manually
   - Credentials stored in `~/.docker/config.json`

2. **Cloud Build (GCP)**:
   - Uses Cloud Build service account
   - Must grant `roles/artifactregistry.writer` (GCP Artifact Registry)
   - Must configure credentials helper for external registries (ECR, ACR, Docker Hub)

3. **Cloud Run (GCP)**:
   - Uses Cloud Run service account
   - Must grant `roles/artifactregistry.reader` for image pulls
   - External registries require credentials helper or image pull secrets

4. **Docker Compose (Staging/Remote)**:
   - SSH user must have `docker login` credentials configured
   - Alternatively, configure Docker credential helpers

**BitBrat does NOT**:
- Store registry credentials in `architecture.yaml`
- Manage registry authentication
- Provide credential provisioning or rotation

**Recommendation**: Document registry authentication setup in `documentation/guides/custom-registry.md#authentication`.

### Secret Management

Registry URLs and namespaces are **NOT secrets** and can be committed to `architecture.yaml`.

**DO NOT** commit:
- Registry passwords
- Service account keys
- Docker auth tokens

**Use** environment variables for sensitive registry configuration:
```yaml
registries:
  definitions:
    private-registry:
      type: generic
      url: ${PRIVATE_REGISTRY_URL}  # Resolved from environment
      prefix: bitbrat
```

---

## Testing Strategy

### Unit Tests

1. **Registry URL Builder** (`tools/brat/src/util/registry.test.ts`):
   - Test each registry type pattern
   - Test variable substitution
   - Test edge cases (missing fields, invalid types)

2. **Registry Resolution** (`tools/brat/src/util/registry.test.ts`):
   - Test priority resolution (service > context > default > fallback)
   - Test missing registry definitions (error handling)
   - Test backward compatibility (no `registries` config)

### Integration Tests

1. **Deployment with Custom Registry**:
   ```bash
   # Setup test architecture.yaml with Docker Hub registry
   brat deploy service llm-bot --context local --dry-run
   # Verify: _IMAGE substitution uses docker.io/...
   ```

2. **Docker Compose Generation**:
   ```bash
   # Generate compose config with custom registry
   # Verify: image: field uses correct registry URL
   ```

3. **Multi-Context Registry**:
   ```bash
   # Deploy same service to local (Docker Hub) and staging (Harbor)
   brat deploy service llm-bot --context local
   brat deploy service llm-bot --context staging
   # Verify: Different registry URLs used
   ```

### Validation Script

Create `planning/sprint-370-custom-registry/validate_deliverable.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Sprint 370: Custom Registry Validation ==="

# 1. Schema validation
echo "[1/5] Validating architecture.yaml schema..."
npm run brat -- config validate

# 2. Registry URL builder tests
echo "[2/5] Running registry URL builder tests..."
npm test -- tools/brat/src/util/registry.test.ts

# 3. Dry-run deployment with custom registry
echo "[3/5] Testing deployment with Docker Hub registry..."
npm run brat -- deploy service llm-bot --context local --dry-run | grep "docker.io/bitbratplatform"

# 4. Docker Compose generation
echo "[4/5] Testing Docker Compose generation..."
# TODO: Add compose generation test

# 5. Backward compatibility
echo "[5/5] Testing backward compatibility (no registry config)..."
# Remove registries section, verify fallback to GCP
# TODO: Add backward compatibility test

echo "✅ All validation checks passed"
```

---

## Documentation Updates

### New Documentation Files

1. **`documentation/guides/custom-registry.md`**:
   - Registry configuration reference
   - Authentication setup per registry type
   - Migration examples (Docker Hub, ECR, ACR, Harbor, GitHub CR)
   - Troubleshooting common issues

2. **`documentation/reference/registry-types.md`**:
   - Complete reference of supported registry types
   - URL pattern specifications
   - Field requirements per type

### Updated Documentation Files

1. **`CLAUDE.md`**:
   - Add custom registry configuration section
   - Update deployment examples with registry config
   - Update Docker Compose patterns

2. **`README.md`**:
   - Brief mention of custom registry support
   - Link to detailed guide

3. **`architecture.yaml` comments**:
   - Add inline documentation for `registries` section
   - Provide example configurations

---

## Performance & Scalability

### Image Pull Performance

**No Performance Impact**:
- Registry URL resolution happens at build/deploy time (not runtime)
- Image pull performance depends on registry proximity and bandwidth
- No additional network calls introduced by BitBrat

**Recommendations for Production**:
- Use region-local registries (e.g., GCP Artifact Registry in `us-central1` for Cloud Run in `us-central1`)
- Configure registry mirrors/pull-through caches for remote registries
- Use registry-native CDN capabilities (Docker Hub CDN, GCP multi-region replication)

### Build Performance

**Cloud Build**:
- No change to build performance
- Registry push latency depends on registry location and bandwidth

**Docker Compose**:
- Local builds: No change (images built locally)
- Remote builds (staging): Pull performance depends on registry proximity

---

## Rollout Plan

### Sprint 370 Deliverables

**Week 1: Core Implementation**
- [ ] Registry schema and validation
- [ ] Registry URL builder utility
- [ ] Registry resolution logic
- [ ] Unit tests

**Week 2: Deployment Integration**
- [ ] Update `brat deploy service` command
- [ ] Update Cloud Build config generation
- [ ] Integration tests
- [ ] Backward compatibility tests

**Week 3: Docker Compose Integration**
- [ ] Update Docker Compose generation
- [ ] Update `brat context create` prompts
- [ ] End-to-end tests

**Week 4: Documentation & Migration**
- [ ] Write custom registry guide
- [ ] Write registry types reference
- [ ] Update CLAUDE.md and README.md
- [ ] Create validation script
- [ ] Migration testing with real registries

### Post-Sprint Enhancements (Future)

- **Sprint 371**: Registry health checks and diagnostics (`brat registry test`)
- **Sprint 372**: Automated registry authentication helpers (`brat registry login`)
- **Sprint 373**: Image mirroring and multi-registry sync (`brat registry sync`)
- **Sprint 374**: Registry analytics and cost optimization (`brat registry analyze`)

---

## Risk Assessment

### High Risk

**Risk**: Breaking existing deployments
**Mitigation**: Robust backward compatibility fallback to GCP Artifact Registry

**Risk**: Authentication failures with external registries
**Mitigation**: Clear documentation on authentication setup; validation during `brat deploy --dry-run`

### Medium Risk

**Risk**: Incorrect registry URL patterns causing image pull failures
**Mitigation**: Comprehensive unit tests for all registry types; validation script

**Risk**: Performance degradation with slow/distant registries
**Mitigation**: Documentation on registry proximity best practices; no code changes needed

### Low Risk

**Risk**: Schema complexity confusing users
**Mitigation**: Provide clear examples and migration guide; sensible defaults

---

## Success Criteria

### Functional Requirements

- ✅ Support 7 registry types: GCP, Docker Hub, GitHub CR, AWS ECR, Azure ACR, Harbor, Generic
- ✅ Allow registry override at platform, context, and service levels
- ✅ Maintain backward compatibility (no `registries` config = GCP Artifact Registry)
- ✅ Support variable substitution in registry URLs (`${PROJECT_ID}`)
- ✅ Generate correct image URLs for Cloud Build and Docker Compose

### Non-Functional Requirements

- ✅ No performance degradation for existing deployments
- ✅ No breaking changes to existing `architecture.yaml` files
- ✅ Clear, comprehensive documentation
- ✅ 100% unit test coverage for registry utilities
- ✅ Validation script passes all checks

### User Experience

- ✅ Configuration is simple and intuitive
- ✅ Error messages are actionable (e.g., "Registry 'xyz' not found in registries.definitions")
- ✅ Dry-run mode shows resolved registry URLs for verification
- ✅ Migration guide makes switching registries straightforward

---

## Appendix A: Registry Type Specifications

### GCP Artifact Registry

```yaml
type: gcp-artifact-registry
url: us-central1-docker.pkg.dev
project: ${PROJECT_ID}  # Required
repository: bitbrat-services  # Required
```

**Pattern**: `{url}/{project}/{repository}/{service}:{tag}`
**Example**: `us-central1-docker.pkg.dev/twitch-452523/bitbrat-services/llm-bot:v0.18.3`

### Docker Hub

```yaml
type: docker-hub
url: docker.io
namespace: bitbratplatform  # Required
```

**Pattern**: `{url}/{namespace}/{service}:{tag}`
**Example**: `docker.io/bitbratplatform/llm-bot:v0.18.3`

### GitHub Container Registry

```yaml
type: github-cr
url: ghcr.io
namespace: yourorg  # Required (GitHub org or user)
```

**Pattern**: `{url}/{namespace}/{service}:{tag}`
**Example**: `ghcr.io/yourorg/llm-bot:v0.18.3`

### AWS Elastic Container Registry

```yaml
type: aws-ecr
url: 123456789012.dkr.ecr.us-east-1.amazonaws.com
repository: bitbrat  # Required
```

**Pattern**: `{url}/{repository}/{service}:{tag}`
**Example**: `123456789012.dkr.ecr.us-east-1.amazonaws.com/bitbrat/llm-bot:v0.18.3`

### Azure Container Registry

```yaml
type: azure-acr
url: bitbratregistry.azurecr.io
```

**Pattern**: `{url}/{service}:{tag}`
**Example**: `bitbratregistry.azurecr.io/llm-bot:v0.18.3`

### Harbor

```yaml
type: harbor
url: harbor.bitbrat.lan
project: bitbrat  # Required
```

**Pattern**: `{url}/{project}/{service}:{tag}`
**Example**: `harbor.bitbrat.lan/bitbrat/llm-bot:v0.18.3`

### Generic Registry

```yaml
type: generic
url: registry.example.com:5000
prefix: bitbrat/services  # Optional
```

**Pattern**: `{url}/{prefix}/{service}:{tag}` (if prefix) OR `{url}/{service}:{tag}` (no prefix)
**Example**: `registry.example.com:5000/bitbrat/services/llm-bot:v0.18.3`

---

## Appendix B: Example Migration Scenarios

### Scenario 1: Migrate GCP Project to Docker Hub

**Before** (implicit GCP):
```yaml
# No registries config, uses default GCP behavior
```

**After**:
```yaml
registries:
  default: docker-hub
  definitions:
    docker-hub:
      type: docker-hub
      url: docker.io
      namespace: bitbratplatform
```

**Migration Steps**:
1. Add `registries` section to `architecture.yaml`
2. Push existing images to Docker Hub: `docker tag <old-image> docker.io/bitbratplatform/<service>:<tag> && docker push`
3. Deploy: `brat deploy services --all`

### Scenario 2: Use Different Registries per Environment

**Before**:
```yaml
# All environments use GCP
```

**After**:
```yaml
registries:
  default: gcp-artifact-registry
  definitions:
    local-registry:
      type: generic
      url: localhost:5000
      prefix: bitbrat

    prod-gcp:
      type: gcp-artifact-registry
      url: us-central1-docker.pkg.dev
      project: ${PROJECT_ID}
      repository: bitbrat-prod

executionContexts:
  local:
    deployment:
      registry: local-registry

  prod:
    deployment:
      registry: prod-gcp
```

**Migration Steps**:
1. Set up local registry: `docker run -d -p 5000:5000 registry:2`
2. Add `registries` and update `executionContexts`
3. Local development uses localhost:5000, production uses GCP

### Scenario 3: Migrate to AWS ECR

**Before**:
```yaml
# GCP Artifact Registry
```

**After**:
```yaml
registries:
  default: aws-ecr
  definitions:
    aws-ecr:
      type: aws-ecr
      url: 123456789012.dkr.ecr.us-east-1.amazonaws.com
      repository: bitbrat
```

**Migration Steps**:
1. Create ECR repository: `aws ecr create-repository --repository-name bitbrat`
2. Configure Cloud Build to authenticate with ECR (credential helper)
3. Add `registries` section
4. Deploy: `brat deploy services --all`

---

## Appendix C: Open Questions

1. **Q**: Should we support multiple registries for the same service (e.g., push to both GCP and Docker Hub)?
   **A**: Out of scope for Sprint 370. Future enhancement.

2. **Q**: Should we validate registry connectivity during `brat deploy --dry-run`?
   **A**: Out of scope for Sprint 370. Add in Sprint 371 (registry diagnostics).

3. **Q**: Should we support registry-specific authentication in `architecture.yaml`?
   **A**: No. Security risk. Use external credential management.

4. **Q**: Should we support image name transformations (e.g., `llm-bot` → `bitbrat-llm-bot`)?
   **A**: Out of scope. Use `prefix` field in generic registry type if needed.

5. **Q**: Should we support OCI artifact registries (for storing non-container artifacts)?
   **A**: Out of scope. Future consideration.
