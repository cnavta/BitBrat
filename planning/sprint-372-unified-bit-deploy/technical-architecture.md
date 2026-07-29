# Sprint 372: Unified Bit Deployment - Technical Architecture

**Role:** Architect
**Created:** 2026-07-28
**Updated:** 2026-07-28 - Removed backward compatibility requirement
**Sprint Goal:** Unify bit deployment under a single `brat bit deploy` command that uses BEC framework to determine deployment strategy

> **NOTE:** This sprint will replace all legacy deployment commands (`brat deploy`, `brat docker up`) with the unified `brat bit deploy` command. No backward compatibility or deprecation period - clean removal.

---

## Executive Summary

Currently, deploying bits requires understanding multiple deployment paths:
- `brat deploy services --all` → Cloud Run (GCP-specific, uses Cloud Build)
- `brat deploy service <name>` → Cloud Run (single service)
- `brat docker up` → Docker Compose (local/remote via SSH)
- Different approaches for different deployment targets

This sprint consolidates all deployment approaches under `brat bit deploy <service-name>` with automatic deployment strategy selection based on the BitBrat Execution Context (BEC) framework.

**Key Benefits:**
- ✅ Single command interface: `brat bit deploy <service>` and `brat bit deploy --all`
- ✅ Context-aware deployment: BEC determines HOW to deploy
- ✅ Consistent UX across all deployment targets (docker-compose, cloud-run, k8s)
- ✅ Eliminates cognitive overhead of choosing correct deploy command
- ✅ Future-proof: New deployment types integrate via BEC without new commands

---

## Current State Analysis

### Existing Deployment Commands

| Command | Deployment Target | Mechanism | Notes |
|---------|------------------|-----------|-------|
| `brat deploy service <name>` | GCP Cloud Run | Cloud Build + gcloud | Single service, GCP-specific |
| `brat deploy services --all` | GCP Cloud Run | Cloud Build + gcloud | All active services, GCP-specific |
| `brat docker up` | Docker Compose | docker-compose CLI | Local or remote via SSH |
| `brat docker up --service <name>` | Docker Compose | docker-compose CLI | Single service |

### Current Deployment Flow (Cloud Run)

```
brat deploy service <name>
  ├─ resolveConfig() → Load architecture.yaml
  ├─ selectDeployableServices() → Filter active services
  ├─ assertVpcPreconditions() → VPC connector check
  ├─ loadEnvKv() → Load env/{context}/{service}.yaml
  ├─ synthesizeSecretMapping() → Secret Manager references
  ├─ resolveSecretMappingToNumeric() → Latest secret versions
  ├─ computeDeploySubstitutions() → Build substitutions
  └─ submitBuild() → Cloud Build → Cloud Run
```

**Files:**
- `tools/brat/src/oclif-commands/deploy/service.ts` (240 LOC)
- `tools/brat/src/oclif-commands/deploy/services.ts` (274 LOC)
- `tools/brat/src/providers/gcp/cloudbuild.ts` (Cloud Build integration)
- `tools/brat/src/providers/gcp/preflight.ts` (VPC validation)

### Current Docker Deployment Flow

```
brat docker up --service <name>
  ├─ DockerOrchestrator.up()
  │   ├─ prepare() → Resolve context, env, target
  │   ├─ writeEnvFile() → .env file generation
  │   ├─ getComposeFiles() → Service-specific compose files
  │   ├─ ensureRemoteSynced() → rsync (if remote)
  │   ├─ ensureNetworkExists() → docker network create
  │   ├─ docker compose build → Build images
  │   └─ docker compose up → Start containers
```

**Files:**
- `tools/brat/src/oclif-commands/docker/up.ts` (simple delegation)
- `tools/brat/src/orchestration/docker/orchestrator.ts` (core logic)
- `tools/brat/src/orchestration/docker/compose-factory.ts` (compose file generation)
- `tools/brat/src/orchestration/docker/environment-resolver.ts` (env vars)

### BitBrat Execution Context (BEC) Framework

**Sprint 349**: BEC unifies environment/target/context concepts into `executionContexts` in `architecture.yaml`.

**Key Fields:**
```yaml
executionContexts:
  <context-name>:
    description: string
    deployment:
      type: docker-compose | cloud-run | k8s
      docker:                      # docker-compose specific
        host: string               # unix:// or ssh://
        remoteDir: string          # remote deployment root
        maxConcurrent: number
      gcp:                         # cloud-run specific
        project: string
        region: string
        serviceAccount: string
      k8s:                         # k8s specific
        cluster: string
        namespace: string
    runtime:
      gateway: { ... }
      persistence: { ... }
      envOverlay: { ... }
    tags: string[]
```

**Resolution Priority:**
1. `--context <name>` flag (highest)
2. `BITBRAT_CONTEXT` env var
3. `~/.bratrc` current_context
4. Default: `local`

**Current Contexts:**
- `local`: docker-compose, unix socket
- `staging`: docker-compose, ssh://root@bitbrat.lan
- `prod`: (not yet defined, likely cloud-run)

---

## Proposed Architecture

### Design Principles

1. **Single Entry Point**: `brat bit deploy` is the ONLY deployment command users need to know
2. **Context-Driven Strategy**: BEC `deployment.type` determines deployment mechanism
3. **Consistent Interface**: Same flags work across all deployment types
4. **Incremental Adoption**: Existing `brat deploy` commands deprecated but functional (with warnings)
5. **Extensibility**: New deployment types (AWS ECS, Azure Container Apps) integrate via BEC

### Unified Command Structure

```
brat bit deploy <service-name>     # Deploy single service
brat bit deploy --all              # Deploy all active services
brat bit deploy --all --context staging
brat bit deploy llm-bot --dry-run
brat bit deploy --all --concurrency 3
```

### Command Flags

| Flag | Type | Description | Applies To |
|------|------|-------------|------------|
| `--context` | string | Execution context (default: from ~/.bratrc) | All |
| `--all` | boolean | Deploy all active services | All |
| `--dry-run` | boolean | Preview without executing | All |
| `--concurrency` | number | Max concurrent deployments | All (default: from BEC or arch) |
| `--force-recreate` | boolean | Force recreate containers | docker-compose |
| `--no-cache` | boolean | Build without cache | docker-compose |
| `--image-tag` | string | Docker image tag | cloud-run |
| `--allow-no-vpc` | boolean | Skip VPC preflight | cloud-run |

### Deployment Strategy Selection

```typescript
interface DeploymentStrategy {
  prepare(service: Service, context: ResolvedContext): Promise<DeploymentPlan>;
  execute(plan: DeploymentPlan, options: DeployOptions): Promise<DeploymentResult>;
  validate(plan: DeploymentPlan): Promise<ValidationResult>;
}

class StrategyFactory {
  static create(deploymentType: string): DeploymentStrategy {
    switch (deploymentType) {
      case 'docker-compose':
        return new DockerComposeStrategy();
      case 'cloud-run':
        return new CloudRunStrategy();
      case 'k8s':
        return new KubernetesStrategy();
      default:
        throw new Error(`Unsupported deployment type: ${deploymentType}`);
    }
  }
}
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                   brat bit deploy <service>                      │
│                    (oclif-commands/bit/deploy.ts)                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────▼────────────┐
                │   ContextResolver       │
                │   (context-resolver.ts) │
                │                         │
                │  Resolves:              │
                │  - Context name         │
                │  - deployment.type      │
                │  - Gateway URL          │
                │  - Persistence driver   │
                └────────────┬────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌────────────┐   ┌─────────────┐   ┌────────────┐
    │  docker-   │   │  cloud-run  │   │    k8s     │
    │  compose   │   │             │   │            │
    └──────┬─────┘   └──────┬──────┘   └──────┬─────┘
           │                │                  │
           ▼                ▼                  ▼
    ┌────────────┐   ┌─────────────┐   ┌────────────┐
    │ Docker     │   │ CloudRun    │   │ Kubernetes │
    │ Compose    │   │ Strategy    │   │ Strategy   │
    │ Strategy   │   │             │   │            │
    └──────┬─────┘   └──────┬──────┘   └──────┬─────┘
           │                │                  │
           ▼                ▼                  ▼
    ┌────────────┐   ┌─────────────┐   ┌────────────┐
    │ DockerOrch │   │ GCP Cloud   │   │  kubectl   │
    │ estrator   │   │ Build API   │   │    API     │
    └────────────┘   └─────────────┘   └────────────┘
```

### File Structure

```
tools/brat/src/
├── oclif-commands/
│   ├── bit/
│   │   ├── create.ts                      # Existing
│   │   └── deploy.ts                      # NEW: Unified deployment command
│   └── deploy/                            # DEPRECATED (retain for backward compat)
│       ├── service.ts                     # Emit deprecation warning
│       └── services.ts                    # Emit deprecation warning
├── orchestration/
│   └── deployment/                        # NEW: Deployment strategy framework
│       ├── strategy.ts                    # Base interface
│       ├── docker-compose-strategy.ts     # Docker Compose implementation
│       ├── cloud-run-strategy.ts          # Cloud Run implementation
│       └── kubernetes-strategy.ts         # K8s implementation (future)
├── providers/                             # Existing (no changes)
│   ├── gcp/
│   │   ├── cloudbuild.ts
│   │   └── cloudrun.ts
│   └── docker/
│       └── orchestrator.ts                # Existing (refactor to strategy)
└── context/
    └── context-resolver.ts                # Existing (no changes)
```

---

## Implementation Plan

### Phase 1: Strategy Abstraction (Sprint 372 - Week 1)

**Goal:** Create deployment strategy framework without breaking existing commands

**Deliverables:**
1. **Base Strategy Interface** (`orchestration/deployment/strategy.ts`)
   ```typescript
   export interface DeploymentPlan {
     service: Service;
     context: ResolvedContext;
     target: DeploymentTarget;
     envVars: Record<string, string>;
     secrets: SecretMapping;
     buildArgs?: Record<string, string>;
   }

   export interface DeploymentResult {
     service: string;
     status: 'success' | 'failed' | 'skipped';
     durationMs: number;
     error?: string;
     url?: string;  // Service URL (if applicable)
   }

   export interface DeploymentStrategy {
     name: string;
     prepare(service: Service, context: ResolvedContext, options: DeployOptions): Promise<DeploymentPlan>;
     validate(plan: DeploymentPlan): Promise<ValidationResult>;
     execute(plan: DeploymentPlan): Promise<DeploymentResult>;
   }
   ```

2. **Docker Compose Strategy** (`orchestration/deployment/docker-compose-strategy.ts`)
   - Extract logic from `DockerOrchestrator.up()`
   - Implement `DeploymentStrategy` interface
   - Maintain backward compatibility with `brat docker up`

3. **Cloud Run Strategy** (`orchestration/deployment/cloud-run-strategy.ts`)
   - Extract logic from `deploy/service.ts` and `deploy/services.ts`
   - Implement `DeploymentStrategy` interface
   - Reuse existing GCP provider modules (`cloudbuild.ts`, `preflight.ts`)

4. **Strategy Factory** (`orchestration/deployment/strategy.ts`)
   - `StrategyFactory.create(deploymentType)`
   - Validates deployment type
   - Returns strategy instance

**Tests:**
- Unit tests for each strategy
- Integration tests with mocked providers
- Ensure existing commands still work

### Phase 2: Unified Command (Sprint 372 - Week 2)

**Goal:** Implement `brat bit deploy` command with strategy delegation

**Deliverables:**
1. **`brat bit deploy` Command** (`oclif-commands/bit/deploy.ts`)
   ```typescript
   export default class BitDeploy extends BratCommand {
     static override args = {
       service: Args.string({
         description: 'Service name (omit with --all to deploy all active services)',
         required: false,
       }),
     };

     static override flags = {
       ...BratCommand.baseFlags,
       all: Flags.boolean({
         description: 'Deploy all active services',
         default: false,
       }),
       'dry-run': Flags.boolean({
         description: 'Preview deployment without executing',
         default: false,
       }),
       concurrency: Flags.integer({
         description: 'Max concurrent deployments (default: from context or arch)',
         default: undefined,
       }),
       'force-recreate': Flags.boolean({
         description: 'Force recreate containers (docker-compose only)',
         default: false,
       }),
       'no-cache': Flags.boolean({
         description: 'Build without cache (docker-compose only)',
         default: false,
       }),
       'image-tag': Flags.string({
         description: 'Docker image tag (cloud-run only)',
         required: false,
       }),
       'allow-no-vpc': Flags.boolean({
         description: 'Skip VPC preflight (cloud-run only)',
         default: undefined,
       }),
     };

     async run(): Promise<void> {
       const { args, flags } = await this.parse(BitDeploy);

       // Validate args
       if (!args.service && !flags.all) {
         throw new Error('Must specify service name or --all flag');
       }

       // Resolve context
       const context = this.context; // From BratCommand
       const deploymentType = context.deployment.type;

       // Select services
       const config = resolveConfig(this.repoRoot);
       const services = flags.all
         ? selectDeployableServices(Object.values(config.services))
         : selectDeployableServices(Object.values(config.services), args.service);

       // Create strategy
       const strategy = StrategyFactory.create(deploymentType);

       // Deploy services
       const results = await this.deployServices(services, strategy, flags);

       // Report results
       this.reportResults(results);
     }

     private async deployServices(
       services: Service[],
       strategy: DeploymentStrategy,
       flags: any
     ): Promise<DeploymentResult[]> {
       const concurrency = flags.concurrency || this.context.deployment.docker?.maxConcurrent || 1;
       const queue = new Queue(concurrency);

       const tasks = services.map(svc => async () => {
         const plan = await strategy.prepare(svc, this.context, flags);
         await strategy.validate(plan);
         return strategy.execute(plan);
       });

       return Promise.all(tasks.map(t => queue.add(t)));
     }
   }
   ```

2. **Deprecation Warnings**
   - Add warnings to `brat deploy service` and `brat deploy services`
   - Suggest `brat bit deploy` as replacement
   - Continue to work for 3-sprint deprecation period

3. **Documentation Updates**
   - Update CLAUDE.md with new deploy command
   - Add migration guide for existing users
   - Update examples in READMEs

**Tests:**
- E2E tests for `brat bit deploy`
- Test all flag combinations
- Verify deprecation warnings
- Test against local and staging contexts

### Phase 3: Deprecation & Cleanup (Sprint 373)

**Goal:** Remove deprecated commands after 3-sprint grace period

**Deliverables:**
1. Remove `brat deploy service` and `brat deploy services`
2. Remove `tools/brat/src/oclif-commands/deploy/` directory
3. Update all documentation and examples
4. Remove deprecated code paths from providers

---

## Technical Specifications

### Strategy Interface Design

```typescript
// orchestration/deployment/strategy.ts

export interface Service {
  name: string;
  active: boolean;
  port: number;
  entry: string;
  image?: string;
  region?: string;
  allowUnauth?: boolean;
  env?: string[];
  secrets?: string[];
  envKeys?: string[];
}

export interface DeploymentPlan {
  // Service metadata
  service: Service;
  context: ResolvedContext;

  // Build configuration
  dockerfile?: string;
  imageTag?: string;
  buildArgs?: Record<string, string>;

  // Runtime configuration
  envVars: Record<string, string>;
  secrets: SecretMapping;

  // Deployment-specific metadata
  metadata: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DeployOptions {
  dryRun?: boolean;
  forceRecreate?: boolean;
  noCache?: boolean;
  imageTag?: string;
  allowNoVpc?: boolean;
  concurrency?: number;
}

export interface DeploymentResult {
  service: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  url?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export abstract class DeploymentStrategy {
  constructor(
    protected readonly repoRoot: string,
    protected readonly logger: Logger
  ) {}

  abstract get name(): string;

  /**
   * Prepare deployment plan for a service
   */
  abstract prepare(
    service: Service,
    context: ResolvedContext,
    options: DeployOptions
  ): Promise<DeploymentPlan>;

  /**
   * Validate deployment plan (preflight checks)
   */
  abstract validate(plan: DeploymentPlan): Promise<ValidationResult>;

  /**
   * Execute deployment
   */
  abstract execute(plan: DeploymentPlan): Promise<DeploymentResult>;
}
```

### Docker Compose Strategy

```typescript
// orchestration/deployment/docker-compose-strategy.ts

export class DockerComposeStrategy extends DeploymentStrategy {
  get name(): string {
    return 'docker-compose';
  }

  async prepare(
    service: Service,
    context: ResolvedContext,
    options: DeployOptions
  ): Promise<DeploymentPlan> {
    // Load environment variables
    const envVars = loadEnvKv(context.name, service.name);

    // Resolve secrets (if applicable)
    const secrets = {};

    // Determine dockerfile
    const dockerfile = `Dockerfile.${service.name}`;

    return {
      service,
      context,
      dockerfile,
      envVars,
      secrets,
      metadata: {
        composeFiles: this.getComposeFiles(service.name),
        projectName: `bitbrat-${context.name}`,
        dockerHost: context.deployment.docker?.host,
        remoteDir: context.deployment.docker?.remoteDir,
      },
    };
  }

  async validate(plan: DeploymentPlan): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check dockerfile exists
    const dockerfilePath = path.join(this.repoRoot, plan.dockerfile || '');
    if (plan.dockerfile && !fs.existsSync(dockerfilePath)) {
      errors.push(`Dockerfile not found: ${plan.dockerfile}`);
    }

    // Check compose files exist
    const composeFiles = plan.metadata.composeFiles || [];
    for (const file of composeFiles) {
      const fullPath = path.join(this.repoRoot, file);
      if (!fs.existsSync(fullPath)) {
        errors.push(`Compose file not found: ${file}`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      // Delegate to DockerOrchestrator
      const orchestrator = new DockerOrchestrator({
        repoRoot: this.repoRoot,
        context: plan.context.name,
        service: plan.service.name,
        forceRecreate: plan.metadata.forceRecreate,
        noCache: plan.metadata.noCache,
      });

      await orchestrator.up();

      return {
        service: plan.service.name,
        status: 'success',
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        service: plan.service.name,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: error.message || String(error),
      };
    }
  }

  private getComposeFiles(serviceName: string): string[] {
    // Use ComposeFactory logic
    const factory = new ComposeFactory(this.repoRoot);
    const fileSet = factory.getComposeFiles(serviceName, [], false);
    return [fileSet.base, ...fileSet.serviceFiles];
  }
}
```

### Cloud Run Strategy

```typescript
// orchestration/deployment/cloud-run-strategy.ts

export class CloudRunStrategy extends DeploymentStrategy {
  get name(): string {
    return 'cloud-run';
  }

  async prepare(
    service: Service,
    context: ResolvedContext,
    options: DeployOptions
  ): Promise<DeploymentPlan> {
    const gcpConfig = context.deployment.gcp;
    if (!gcpConfig) {
      throw new Error('GCP configuration required for cloud-run deployment');
    }

    // Load environment variables
    const envKv = loadEnvKv(context.name, service.name);

    // Resolve secrets to numeric versions
    let secretMap = synthesizeSecretMapping(service.secrets);
    if (secretMap) {
      secretMap = await resolveSecretMappingToNumeric(secretMap, gcpConfig.project);
    }

    // Filter env vars against secrets
    const envFiltered = filterEnvKvAgainstSecrets(envKv, secretMap);

    // Determine dockerfile
    const dockerfile = service.image
      ? undefined
      : `Dockerfile.${service.name}`;

    // Compute image tag
    const imageTag = options.imageTag || deriveTag();

    return {
      service,
      context,
      dockerfile,
      imageTag,
      envVars: this.parseEnvKv(envFiltered),
      secrets: secretMap || {},
      metadata: {
        projectId: gcpConfig.project,
        region: gcpConfig.region || service.region,
        allowNoVpc: options.allowNoVpc,
        externalImage: !!service.image,
      },
    };
  }

  async validate(plan: DeploymentPlan): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // VPC preflight check
    if (!plan.metadata.allowNoVpc) {
      try {
        await assertVpcPreconditions({
          projectId: plan.metadata.projectId,
          region: plan.metadata.region,
          env: plan.context.name,
          allowNoVpc: false,
        });
      } catch (error: any) {
        errors.push(`VPC preflight failed: ${error.message}`);
      }
    }

    // Check dockerfile exists (if not external image)
    if (plan.dockerfile) {
      const dockerfilePath = path.join(this.repoRoot, plan.dockerfile);
      if (!fs.existsSync(dockerfilePath)) {
        errors.push(`Dockerfile not found: ${plan.dockerfile}`);
      }
    }

    // Validate required env keys
    if (plan.service.envKeys && plan.service.envKeys.length) {
      const runtimeProvided = new Set(['K_REVISION']);
      const present = new Set(Object.keys(plan.envVars));
      const missing = plan.service.envKeys
        .filter(k => !runtimeProvided.has(k))
        .filter(k => !present.has(k));

      if (missing.length) {
        errors.push(`Missing required env keys: ${missing.join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      // Determine Cloud Build config
      const configPath = plan.metadata.externalImage
        ? path.join(this.repoRoot, 'cloudbuild.deploy-only.yaml')
        : path.join(this.repoRoot, 'cloudbuild.oauth-flow.yaml');

      // Write env vars to file
      const envVarsFile = await this.writeEnvVarsFile(plan);

      // Compute substitutions
      const substitutions = computeDeploySubstitutions({
        svc: plan.service,
        repoName: 'bitbrat-services',
        region: plan.metadata.region,
        tag: plan.imageTag!,
        allowUnauth: plan.service.allowUnauth || false,
        dockerfile: plan.dockerfile || '',
        envVarsArg: '',
        envVarsFile,
        secretSetArg: plan.secrets,
        ingressPolicy: 'internal-and-cloud-load-balancing',
        vpcConnectorName: `brat-conn-${plan.metadata.region}-${plan.context.name}`,
        image: plan.service.image,
      });

      // Submit Cloud Build
      const result = await submitBuild({
        projectId: plan.metadata.projectId,
        configPath,
        substitutions,
        cwd: this.repoRoot,
        dryRun: false,
      });

      if (result.code !== 0) {
        throw new Error(`Cloud Build failed: ${result.stderr || result.stdout}`);
      }

      return {
        service: plan.service.name,
        status: 'success',
        durationMs: Date.now() - startTime,
        url: `https://${plan.service.name}-${plan.metadata.projectId}.run.app`,
      };
    } catch (error: any) {
      return {
        service: plan.service.name,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: error.message || String(error),
      };
    }
  }

  private async writeEnvVarsFile(plan: DeploymentPlan): Promise<string> {
    const cbDir = path.join(this.repoRoot, '.cloudbuild');
    if (!fs.existsSync(cbDir)) {
      fs.mkdirSync(cbDir, { recursive: true });
    }

    const safeName = plan.service.name.replace(/[^A-Za-z0-9_.-]+/g, '-');
    const envVarsFileRel = path.join('.cloudbuild', `env.${safeName}.kv`);
    const envKv = Object.entries(plan.envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join(';');

    fs.writeFileSync(path.join(this.repoRoot, envVarsFileRel), envKv, 'utf8');

    return envVarsFileRel;
  }

  private parseEnvKv(envKv: string): Record<string, string> {
    const result: Record<string, string> = {};
    envKv.split(';').filter(Boolean).forEach(pair => {
      const [key, ...rest] = pair.split('=');
      result[key] = rest.join('=');
    });
    return result;
  }
}
```

---

## Migration Strategy

### Backward Compatibility

**3-Sprint Deprecation Period (Sprints 372-374):**

1. **Sprint 372**: Introduce `brat bit deploy` alongside existing commands
   - `brat deploy service` → Emit deprecation warning
   - `brat deploy services` → Emit deprecation warning
   - Commands continue to work

2. **Sprint 373**: Update documentation and examples
   - All docs reference `brat bit deploy`
   - Migration guide published
   - CI/CD updated to use new command

3. **Sprint 374**: Remove deprecated commands
   - Delete `tools/brat/src/oclif-commands/deploy/`
   - Remove from oclif topics

### Deprecation Warning Example

```typescript
// tools/brat/src/oclif-commands/deploy/service.ts

export default class DeployService extends BratCommand {
  async run(): Promise<void> {
    // Emit deprecation warning
    this.logger.warn({
      deprecated: true,
      replacement: 'brat bit deploy',
      removalVersion: '0.20.0',
    }, 'WARNING: `brat deploy service` is deprecated. Use `brat bit deploy <service>` instead.');

    console.warn(chalk.yellow(`
⚠️  DEPRECATION WARNING

   The command 'brat deploy service' is deprecated and will be removed in v0.20.0.

   Please use: brat bit deploy <service> instead

   Learn more: https://docs.bitbrat.dev/commands/bit-deploy
`));

    // Continue with existing logic...
  }
}
```

---

## Testing Strategy

### Unit Tests

1. **Strategy Tests**
   - `docker-compose-strategy.test.ts`: Test prepare/validate/execute
   - `cloud-run-strategy.test.ts`: Test prepare/validate/execute
   - Mock external dependencies (DockerOrchestrator, submitBuild)

2. **Factory Tests**
   - `strategy-factory.test.ts`: Test strategy selection
   - Test unknown deployment types throw errors

3. **Command Tests**
   - `bit-deploy.test.ts`: Test arg parsing, service selection, result reporting

### Integration Tests

1. **Local Deployment**
   - `brat bit deploy llm-bot --context local --dry-run`
   - Verify DockerComposeStrategy used
   - Verify correct compose files selected

2. **Staging Deployment (Remote Docker)**
   - `brat bit deploy api-gateway --context staging --dry-run`
   - Verify SSH target correctly configured
   - Verify remote sync and network creation

3. **Cloud Run Deployment**
   - `brat bit deploy --all --context prod --dry-run`
   - Verify CloudRunStrategy used
   - Verify Cloud Build substitutions

### E2E Tests

1. **Smoke Tests**
   - Deploy single service to local
   - Deploy all services to staging
   - Verify services are running

2. **Concurrency Tests**
   - Deploy 5 services with concurrency=2
   - Verify queue behavior
   - Verify all services deployed

3. **Error Handling**
   - Missing dockerfile
   - Invalid context
   - VPC preflight failure
   - Cloud Build failure

---

## Success Metrics

### Functional Metrics

- ✅ `brat bit deploy <service>` deploys to docker-compose contexts
- ✅ `brat bit deploy <service>` deploys to cloud-run contexts
- ✅ `brat bit deploy --all` deploys all active services
- ✅ Deployment type automatically determined from BEC
- ✅ All flags work consistently across deployment types
- ✅ Dry-run mode works for all strategies

### Performance Metrics

- ⏱️ Docker Compose deployment time: ≤ existing `brat docker up`
- ⏱️ Cloud Run deployment time: ≤ existing `brat deploy service`
- ⏱️ Concurrency respected (no more than N concurrent deploys)

### UX Metrics

- 📖 Zero-conf deployment: Users don't need to know deployment type
- 📖 Clear error messages for validation failures
- 📖 Progress indicators for multi-service deployments
- 📖 Deprecation warnings guide users to new command

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking existing CI/CD pipelines | High | Medium | 3-sprint deprecation period, backward compat |
| Docker/Cloud Run strategy divergence | Medium | Low | Shared DeploymentPlan interface enforces consistency |
| Performance regression | Medium | Low | Reuse existing orchestrators, add perf tests |
| Confusion during migration | Medium | Medium | Clear deprecation warnings, migration guide |
| New deployment types (k8s) delayed | Low | Low | Strategy pattern allows independent implementation |

---

## Future Enhancements

### Sprint 373+: Additional Deployment Types

1. **Kubernetes Strategy**
   - `deployment.type: k8s`
   - kubectl/helm integration
   - Namespace isolation
   - ConfigMaps and Secrets

2. **AWS ECS Strategy**
   - `deployment.type: ecs`
   - Task definitions
   - Service discovery
   - Secrets Manager integration

3. **Azure Container Apps Strategy**
   - `deployment.type: azure-container-apps`
   - Azure CLI integration
   - Key Vault secrets

### Advanced Features

1. **Deployment Verification**
   - Health check polling after deployment
   - Rollback on failure
   - Blue/green deployments

2. **Deployment Hooks**
   - Pre-deploy validation scripts
   - Post-deploy smoke tests
   - Notification integrations (Slack, PagerDuty)

3. **Multi-Region Deployments**
   - Deploy to multiple regions concurrently
   - Cross-region load balancing
   - Region-specific configurations

---

## Appendices

### Appendix A: Command Comparison

| Task | Current (Sprint 371) | Proposed (Sprint 372+) |
|------|---------------------|------------------------|
| Deploy single service to local | `brat docker up --service llm-bot` | `brat bit deploy llm-bot` |
| Deploy all services to local | `brat docker up` | `brat bit deploy --all` |
| Deploy single service to staging | `brat docker up --service llm-bot --context staging` | `brat bit deploy llm-bot --context staging` |
| Deploy all services to staging | `brat docker up --context staging` | `brat bit deploy --all --context staging` |
| Deploy single service to cloud | `brat deploy service llm-bot` | `brat bit deploy llm-bot --context prod` |
| Deploy all services to cloud | `brat deploy services --all` | `brat bit deploy --all --context prod` |

### Appendix B: File Impact Analysis

**New Files:**
```
tools/brat/src/orchestration/deployment/
├── strategy.ts                        # Base interface (200 LOC)
├── docker-compose-strategy.ts         # Docker Compose implementation (300 LOC)
├── cloud-run-strategy.ts              # Cloud Run implementation (400 LOC)
└── kubernetes-strategy.ts             # K8s implementation (future)

tools/brat/src/oclif-commands/bit/
└── deploy.ts                          # Unified deploy command (250 LOC)
```

**Modified Files:**
```
tools/brat/src/oclif-commands/deploy/
├── service.ts                         # Add deprecation warning (5 LOC)
└── services.ts                        # Add deprecation warning (5 LOC)
```

**Deleted Files (Sprint 374):**
```
tools/brat/src/oclif-commands/deploy/
├── service.ts
├── services.ts
├── service.test.ts
└── services.test.ts
```

**Total LOC Impact:**
- New code: ~1,150 LOC
- Modified code: ~10 LOC
- Deleted code (eventual): ~650 LOC
- Net impact: +500 LOC (strategy framework investment)

### Appendix C: Dependencies

**No new external dependencies required**

Existing dependencies leveraged:
- `@oclif/core` (CLI framework)
- `js-yaml` (YAML parsing)
- Docker CLI (via exec)
- gcloud CLI (via exec)
- GCP Cloud Build API

---

## Open Questions

1. **Q:** Should `brat bit deploy` support mixed deployments (some services to docker, some to cloud-run)?
   **A:** No. Deployment type is context-wide. Users can deploy to multiple contexts sequentially.

2. **Q:** Should we support `brat bit deploy --all --context local,staging,prod`?
   **A:** Not in Sprint 372. This is a future enhancement for multi-context deployments.

3. **Q:** How do we handle services with `active: false`?
   **A:** Same as current behavior: inactive services are filtered out by `selectDeployableServices()`.

4. **Q:** Should `--dry-run` actually build images or just validate plans?
   **A:** Validate plans only. No builds, no network calls. Fast feedback loop.

5. **Q:** What happens if a service has no Dockerfile and no `image` field?
   **A:** Validation fails with clear error: "Service '<name>' has no Dockerfile or external image configured."

---

**End of Technical Architecture Document**

Generated: 2026-07-28
Sprint: 372
Document Version: 1.0
