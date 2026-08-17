# Sprint 374: Secure File Deployment - Technical Architecture

**Status**: Draft
**Author**: Architect (Claude Code)
**Date**: 2026-07-29
**Sprint**: 374

## Executive Summary

This document defines a platform-agnostic approach to deploying secure files (GCP credentials, certificates, API keys) alongside Bits. The solution extends the existing deployment architecture (`brat bit deploy`) to support per-Bit secure file mounting while maintaining BitBrat's multi-platform philosophy (Docker Compose, Cloud Run, self-hosted).

**Core Principle**: Secure files are **declaratively defined in architecture.yaml**, **validated at deploy-time**, and **mounted platform-appropriately** without requiring code changes to services.

---

## Problem Statement

### Current State
- **GCP credentials** for image-gen-mcp currently referenced as `GOOGLE_APPLICATION_CREDENTIALS` environment variable pointing to a file path
- **No standardized mechanism** to deploy secure files (service account keys, certificates, etc.) alongside Bits
- **Manual intervention required** to copy credential files to remote Docker hosts
- **Platform-specific workarounds** (Docker volume mounts, GCS secret manager, manual scp)

### Requirements
1. **Declarative**: Secure files defined in `architecture.yaml` per-Bit
2. **Platform-Agnostic**: Works identically on Docker Compose (local/remote) and Cloud Run
3. **Deployment-Integrated**: Handled automatically by `brat bit deploy`
4. **Secure**: Files never committed to git, encrypted in transit, restricted permissions
5. **Backward Compatible**: Existing deployments continue to work
6. **Auditable**: Deployment logs show which files were mounted where

---

## Architecture Overview

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. DEFINE (architecture.yaml)                                       │
│    services:                                                         │
│      image-gen-mcp:                                                  │
│        secureFiles:                                                  │
│          - local: .secure.local/gcp-credentials.json               │
│            target: /var/secrets/gcp-credentials.json                │
│            env: GOOGLE_APPLICATION_CREDENTIALS                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. VALIDATE (brat bit deploy --validate)                            │
│    - File exists at local path                                      │
│    - Not tracked by git (.gitignore check)                          │
│    - Permissions check (readable, not world-readable)                │
│    - Target path validation (inside /var/secrets or /run/secrets)   │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. PREPARE (Strategy Pattern)                                       │
│    ┌──────────────────┬──────────────────────────────────────────┐ │
│    │ Docker Compose   │ Cloud Run                                │ │
│    ├──────────────────┼──────────────────────────────────────────┤ │
│    │ - Add volume     │ - Upload to Secret Manager               │ │
│    │   mount to       │ - Create secret version                  │ │
│    │   compose file   │ - Mount as file (not env var)            │ │
│    │ - Set env var    │ - Set env var                            │ │
│    │   to target path │   to target path                         │ │
│    └──────────────────┴──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. DEPLOY (Platform-Specific)                                       │
│    ┌──────────────────┬──────────────────────────────────────────┐ │
│    │ Local Docker     │ Remote Docker (SSH)                      │ │
│    ├──────────────────┼──────────────────────────────────────────┤ │
│    │ - Volume mount   │ - scp file to remote                     │ │
│    │   from host path │ - chmod 400 on remote                    │ │
│    │                  │ - Volume mount from remote path          │ │
│    └──────────────────┴──────────────────────────────────────────┘ │
│    ┌──────────────────────────────────────────────────────────────┐ │
│    │ Cloud Run                                                    │ │
│    ├──────────────────────────────────────────────────────────────┤ │
│    │ - gcloud run services update --set-secrets=FILE=/secrets/... │ │
│    │ - Mounted at target path automatically                       │ │
│    └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. VERIFY (Post-Deploy)                                             │
│    - Bit health check passes                                        │
│    - File exists at target path (docker exec check)                 │
│    - Env var set correctly                                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Design

### 1. Schema Definition (architecture.yaml)

#### New `secureFiles` Property

```yaml
services:
  image-gen-mcp:
    # ... existing properties ...
    secureFiles:
      - local: .secure.local/gcp-credentials.json   # Required: source path (relative to repo root)
        target: /var/secrets/gcp-credentials.json  # Required: destination path inside container
        env: GOOGLE_APPLICATION_CREDENTIALS        # Optional: env var to set to target path
        permissions: "0400"                         # Optional: file permissions (default: 0400)
        required: true                              # Optional: fail deploy if missing (default: true)

      - local: .secure.staging/api-key.txt
        target: /run/secrets/api-key.txt
        env: API_KEY_FILE
        context: staging                            # Optional: only deploy in this context
```

#### Schema Validation

**TypeScript Interface** (tools/brat/src/config/types.ts):
```typescript
export interface SecureFile {
  /** Source path relative to repository root (must not be git-tracked) */
  local: string;

  /** Destination path inside container (must be under /var/secrets or /run/secrets) */
  target: string;

  /** Optional environment variable to set to target path */
  env?: string;

  /** File permissions (octal string, default: "0400") */
  permissions?: string;

  /** Fail deployment if file missing (default: true) */
  required?: boolean;

  /** Only deploy in specific execution context (optional) */
  context?: string;
}

export interface ServiceDefinition {
  // ... existing properties ...

  /** Secure files to mount into container */
  secureFiles?: SecureFile[];
}
```

---

### 2. Validation Layer

**Location**: `tools/brat/src/orchestration/deployment/secure-files-validator.ts`

```typescript
export interface SecureFileValidationResult {
  file: SecureFile;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class SecureFilesValidator {
  /**
   * Validate all secure files for a service before deployment.
   *
   * Checks:
   * - File exists at local path
   * - Not tracked by git (.gitignore validation)
   * - Readable permissions
   * - Not world-readable (security check)
   * - Target path inside allowed directories
   * - No path traversal attacks
   */
  async validate(
    files: SecureFile[],
    context: ResolvedContext,
    repoRoot: string
  ): Promise<SecureFileValidationResult[]>;

  /**
   * Check if file is ignored by git.
   * Uses: git check-ignore --quiet <file>
   */
  private async isGitIgnored(filePath: string): Promise<boolean>;

  /**
   * Validate target path is secure.
   * Allowed prefixes: /var/secrets/, /run/secrets/, /etc/secrets/
   */
  private validateTargetPath(target: string): { valid: boolean; error?: string };

  /**
   * Check file permissions (must be owner-readable, not world-readable).
   */
  private async validatePermissions(filePath: string): Promise<{ valid: boolean; error?: string }>;
}
```

**Security Rules**:
1. **Local path**: Must be relative, must exist, must be git-ignored
2. **Target path**: Must be absolute, must be under `/var/secrets/`, `/run/secrets/`, or `/etc/secrets/`
3. **Permissions**: Default `0400` (owner read-only), never `0777`, never world-readable
4. **Git safety**: Auto-check `.gitignore` to prevent accidental commits
5. **Path traversal**: Reject paths with `../`, `~`, symlinks

---

### 3. Deployment Strategy Extensions

#### Docker Compose Strategy

**File**: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`

```typescript
export class DockerComposeStrategy implements DeploymentStrategy {
  async prepare(service: ServiceWithName, context: ResolvedContext, options: DeployOptions): Promise<DeploymentPlan> {
    // ... existing code ...

    // Process secure files
    const secureFiles = service.secureFiles || [];
    const processedFiles = await this.processSecureFiles(secureFiles, context, options.repoRoot);

    // Add to plan metadata
    const metadata: DeploymentPlan['metadata'] = {
      // ... existing metadata ...
      secureFiles: processedFiles,
    };

    return { service, context, envVars, secrets: {}, metadata };
  }

  /**
   * Process secure files for Docker Compose deployment.
   *
   * For local Docker:
   * - Add volume mounts: `<local-path>:<target-path>:ro`
   * - Add env vars if specified
   *
   * For remote Docker (SSH):
   * - scp file to remote host
   * - chmod 400 on remote
   * - Add volume mount from remote path
   */
  private async processSecureFiles(
    files: SecureFile[],
    context: ResolvedContext,
    repoRoot: string
  ): Promise<ProcessedSecureFile[]> {
    const isRemote = context.deployment.docker?.host?.startsWith('ssh://');

    return Promise.all(files.map(async (file) => {
      const localPath = path.resolve(repoRoot, file.local);

      if (isRemote) {
        // Transfer file to remote host
        const remoteDir = context.deployment.docker!.remoteDir!;
        const remotePath = `${remoteDir}/.secure/${path.basename(file.local)}`;

        await this.transferToRemote(localPath, remotePath, context.deployment.docker!.host!);

        return {
          ...file,
          volumeMount: `${remotePath}:${file.target}:ro`,
          remotePath,
        };
      } else {
        // Local Docker: mount directly from host
        return {
          ...file,
          volumeMount: `${localPath}:${file.target}:ro`,
        };
      }
    }));
  }

  /**
   * Transfer file to remote Docker host via scp.
   */
  private async transferToRemote(localPath: string, remotePath: string, sshHost: string): Promise<void> {
    // Extract user@host from ssh://user@host format
    const match = sshHost.match(/^ssh:\/\/(.+@.+?)(?::(\d+))?$/);
    if (!match) throw new Error(`Invalid SSH host: ${sshHost}`);

    const [, userHost, port] = match;
    const scpTarget = `${userHost}:${remotePath}`;

    // Create remote directory
    const remoteDir = path.dirname(remotePath);
    await execCmd('ssh', [userHost, `mkdir -p ${remoteDir}`]);

    // scp file
    const scpArgs = port ? ['-P', port] : [];
    await execCmd('scp', [...scpArgs, localPath, scpTarget]);

    // chmod 400
    await execCmd('ssh', [userHost, `chmod 400 ${remotePath}`]);
  }

  async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
    // ... existing code ...

    // Modify compose file to include volume mounts
    const processedFiles = plan.metadata.secureFiles as ProcessedSecureFile[];
    const composeFileContent = await this.injectVolumeMounts(
      plan.metadata.composeFilePath as string,
      plan.service.name,
      processedFiles
    );

    // Continue with existing deployment...
  }

  /**
   * Inject volume mounts into docker-compose file.
   */
  private async injectVolumeMounts(
    composeFilePath: string,
    serviceName: string,
    files: ProcessedSecureFile[]
  ): Promise<string> {
    const yaml = require('js-yaml');
    const compose = yaml.load(await fs.promises.readFile(composeFilePath, 'utf-8'));

    if (!compose.services[serviceName].volumes) {
      compose.services[serviceName].volumes = [];
    }

    // Add volume mounts
    for (const file of files) {
      compose.services[serviceName].volumes.push(file.volumeMount);

      // Add env var if specified
      if (file.env) {
        if (!compose.services[serviceName].environment) {
          compose.services[serviceName].environment = [];
        }
        compose.services[serviceName].environment.push(`${file.env}=${file.target}`);
      }
    }

    return yaml.dump(compose);
  }
}
```

#### Cloud Run Strategy

**File**: `tools/brat/src/orchestration/deployment/cloud-run-strategy.ts`

```typescript
export class CloudRunStrategy implements DeploymentStrategy {
  async prepare(service: ServiceWithName, context: ResolvedContext, options: DeployOptions): Promise<DeploymentPlan> {
    // ... existing code ...

    // Process secure files for Cloud Run
    const secureFiles = service.secureFiles || [];
    const secretRefs = await this.uploadToSecretManager(secureFiles, context, options.repoRoot);

    const metadata: DeploymentPlan['metadata'] = {
      // ... existing metadata ...
      secretRefs,
    };

    return { service, context, envVars, secrets: {}, metadata };
  }

  /**
   * Upload secure files to GCP Secret Manager and return secret references.
   */
  private async uploadToSecretManager(
    files: SecureFile[],
    context: ResolvedContext,
    repoRoot: string
  ): Promise<SecretReference[]> {
    const projectId = context.deployment.cloudRun?.projectId;
    if (!projectId) throw new Error('GCP project ID required for Cloud Run deployment');

    return Promise.all(files.map(async (file) => {
      const localPath = path.resolve(repoRoot, file.local);
      const fileContent = await fs.promises.readFile(localPath);

      // Secret name: bitbrat-<service>-<filename-without-ext>
      const secretName = `bitbrat-${context.name}-${path.basename(file.local, path.extname(file.local))}`;

      // Create or update secret
      await this.ensureSecret(projectId, secretName);
      await this.addSecretVersion(projectId, secretName, fileContent);

      return {
        secretName,
        targetPath: file.target,
        env: file.env,
      };
    }));
  }

  /**
   * Ensure secret exists in Secret Manager.
   */
  private async ensureSecret(projectId: string, secretName: string): Promise<void> {
    const { stdout } = await execCmd('gcloud', [
      'secrets', 'describe', secretName,
      '--project', projectId,
    ], { allowNonZeroExit: true });

    if (!stdout) {
      // Secret doesn't exist, create it
      await execCmd('gcloud', [
        'secrets', 'create', secretName,
        '--project', projectId,
        '--replication-policy', 'automatic',
      ]);
    }
  }

  /**
   * Add new version to secret.
   */
  private async addSecretVersion(projectId: string, secretName: string, content: Buffer): Promise<void> {
    // Write to temp file
    const tmpFile = `/tmp/${secretName}-${Date.now()}`;
    await fs.promises.writeFile(tmpFile, content);

    try {
      await execCmd('gcloud', [
        'secrets', 'versions', 'add', secretName,
        '--project', projectId,
        '--data-file', tmpFile,
      ]);
    } finally {
      await fs.promises.unlink(tmpFile);
    }
  }

  async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
    // ... existing code ...

    // Add --set-secrets flags to gcloud run deploy command
    const secretRefs = plan.metadata.secretRefs as SecretReference[];
    const setSecretsFlags = secretRefs.map(ref =>
      `${ref.targetPath}=${ref.secretName}:latest`
    );

    const deployCmd = [
      'gcloud', 'run', 'deploy', plan.service.name,
      '--image', imageUrl,
      '--region', plan.context.deployment.cloudRun!.region,
      '--project', plan.context.deployment.cloudRun!.projectId,
      ...setSecretsFlags.flatMap(flag => ['--set-secrets', flag]),
      // ... other flags ...
    ];

    await execCmd(deployCmd[0], deployCmd.slice(1));

    // Set env vars if specified
    for (const ref of secretRefs) {
      if (ref.env) {
        await execCmd('gcloud', [
          'run', 'services', 'update', plan.service.name,
          '--region', plan.context.deployment.cloudRun!.region,
          '--project', plan.context.deployment.cloudRun!.projectId,
          '--set-env-vars', `${ref.env}=${ref.targetPath}`,
        ]);
      }
    }
  }
}
```

---

### 4. Security Considerations

#### File Storage

**Local Development**:
```
.secure.local/              # Gitignored directory for local secrets
├── gcp-credentials.json
├── api-key.txt
└── .gitkeep

.secure.staging/            # Gitignored directory for staging secrets
├── gcp-credentials.json
└── api-key.txt
```

**`.gitignore` entries** (auto-added by `brat context create`):
```gitignore
# Secure files (Sprint 374)
.secure.*/
!.secure.*/.gitkeep
```

#### Permission Matrix

| Deployment Type | File Transfer | Storage | Permissions | Encryption |
|-----------------|---------------|---------|-------------|------------|
| Local Docker | Volume mount | Host filesystem | 0400 (owner read-only) | Host-level encryption |
| Remote Docker (SSH) | scp | Remote host filesystem | 0400 (owner read-only) | SSH encryption in transit |
| Cloud Run | gcloud secrets | Secret Manager | IAM-controlled | Google-managed encryption at rest |

#### Audit Trail

**Deployment logs** include:
```
[INFO] Validating secure files for image-gen-mcp
[INFO]   ✓ .secure.local/gcp-credentials.json exists, 432 bytes, git-ignored
[INFO]   ✓ Target path /var/secrets/gcp-credentials.json is secure
[INFO] Transferring secure files to remote host (ssh://root@bitbrat.lan)
[INFO]   ✓ Copied .secure.local/gcp-credentials.json → bitbrat.lan:/opt/BitBratPlatform/.secure/gcp-credentials.json
[INFO]   ✓ Set permissions to 0400
[INFO] Mounting secure files in docker-compose
[INFO]   ✓ Volume: /opt/BitBratPlatform/.secure/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro
[INFO]   ✓ Env: GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcp-credentials.json
[INFO] Deployment complete
```

---

### 5. Developer Experience

#### Workflow: Adding a Secure File

**Step 1**: Create secure directory for your context
```bash
mkdir -p .secure.local
echo "*" > .secure.local/.gitignore
```

**Step 2**: Add file to secure directory
```bash
cp ~/Downloads/gcp-service-account.json .secure.local/gcp-credentials.json
chmod 400 .secure.local/gcp-credentials.json
```

**Step 3**: Update architecture.yaml
```yaml
services:
  my-service:
    # ... existing config ...
    secureFiles:
      - local: .secure.local/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
```

**Step 4**: Validate and deploy
```bash
# Validate configuration
brat bit deploy my-service --dry-run

# Deploy
brat bit deploy my-service
```

#### Error Messages

**File not found**:
```
✗ Secure file validation failed for image-gen-mcp
  Error: .secure.local/gcp-credentials.json does not exist
  Hint: Create the file or set required: false in architecture.yaml
```

**Not git-ignored**:
```
✗ Secure file validation failed for image-gen-mcp
  Error: .secure.local/api-key.txt is tracked by git
  Hint: Add to .gitignore to prevent accidental commits
  Run: echo ".secure.local/" >> .gitignore
```

**Invalid target path**:
```
✗ Secure file validation failed for image-gen-mcp
  Error: Target path /opt/app/credentials.json is not secure
  Hint: Use /var/secrets/, /run/secrets/, or /etc/secrets/
```

**World-readable permissions**:
```
⚠ Warning: .secure.local/gcp-credentials.json has permissions 0644 (world-readable)
  Hint: Restrict permissions with: chmod 400 .secure.local/gcp-credentials.json
```

---

### 6. Migration Path

#### Phase 1: Add Support (Backward Compatible)

- Implement `secureFiles` schema in architecture.yaml
- Add validation layer
- Extend Docker Compose strategy
- Extend Cloud Run strategy
- **No breaking changes**: Existing services continue to work

#### Phase 2: Migrate image-gen-mcp

**Before** (architecture.yaml):
```yaml
image-gen-mcp:
  secrets:
    - GOOGLE_APPLICATION_CREDENTIALS  # Path to file, manually managed
```

**After** (architecture.yaml):
```yaml
image-gen-mcp:
  secrets:
    - OPENAI_API_KEY
  secureFiles:
    - local: .secure.local/gcp-credentials.json
      target: /var/secrets/gcp-credentials.json
      env: GOOGLE_APPLICATION_CREDENTIALS
```

**Code changes**: None required (service reads `process.env.GOOGLE_APPLICATION_CREDENTIALS` which now points to `/var/secrets/gcp-credentials.json`)

#### Phase 3: Documentation

- Update deployment guides
- Add secure file examples to CLAUDE.md
- Document per-platform behavior

---

### 7. Testing Strategy

#### Unit Tests

**`secure-files-validator.test.ts`**:
- File exists validation
- Git-ignore validation
- Permission validation
- Target path validation
- Path traversal rejection

**`docker-compose-strategy.test.ts`**:
- Volume mount injection
- Remote file transfer (mocked scp)
- Env var injection
- Compose file modification

**`cloud-run-strategy.test.ts`**:
- Secret Manager upload (mocked gcloud)
- Secret version creation
- --set-secrets flag generation

#### Integration Tests

**Local Docker**:
```typescript
it('deploys service with secure file mounted', async () => {
  // Given: service with secureFiles defined
  // When: brat bit deploy
  // Then: docker exec shows file at target path with correct permissions
});
```

**Remote Docker (SSH)**:
```typescript
it('transfers secure file to remote host', async () => {
  // Given: service with secureFiles and remote docker host
  // When: brat bit deploy
  // Then: ssh <host> cat <remote-path> returns file content
});
```

**Cloud Run**:
```typescript
it('uploads secure file to Secret Manager', async () => {
  // Given: service with secureFiles
  // When: brat bit deploy --context prod
  // Then: gcloud secrets describe shows latest version
});
```

---

### 8. Performance Considerations

#### File Transfer Optimization

**For remote Docker**:
- **Incremental sync**: Only transfer file if changed (compare checksums)
- **Compression**: Use `scp -C` for large files
- **Parallel transfer**: Transfer multiple files concurrently
- **Caching**: Store remote path metadata to avoid redundant transfers

**For Cloud Run**:
- **Secret version reuse**: Don't create new version if content unchanged
- **Batch operations**: Upload all secrets before deployment command

#### Deployment Time Impact

| Deployment Type | Baseline | With 1 Secure File | With 5 Secure Files |
|-----------------|----------|-------------------|---------------------|
| Local Docker | 5s | +0.5s | +1s |
| Remote Docker (SSH) | 30s | +3s | +10s |
| Cloud Run | 60s | +5s | +15s |

**Mitigation**: Parallel processing of secure files during prepare() phase.

---

## Implementation Checklist

### Phase 1: Foundation (Days 1-2)
- [ ] Define `SecureFile` TypeScript interface
- [ ] Add `secureFiles` to service schema in architecture.yaml
- [ ] Implement `SecureFilesValidator` class
- [ ] Add validator unit tests
- [ ] Update architecture.yaml JSON schema

### Phase 2: Docker Compose Integration (Days 3-4)
- [ ] Extend `DockerComposeStrategy.prepare()` to process secure files
- [ ] Implement local volume mount logic
- [ ] Implement remote scp transfer logic
- [ ] Inject volume mounts into compose file
- [ ] Add integration tests (local + remote)

### Phase 3: Cloud Run Integration (Day 5)
- [ ] Extend `CloudRunStrategy.prepare()` for Secret Manager
- [ ] Implement `uploadToSecretManager()` method
- [ ] Add `--set-secrets` flags to deploy command
- [ ] Add integration tests (mocked gcloud)

### Phase 4: Migration & Documentation (Day 6)
- [ ] Migrate image-gen-mcp to use secureFiles
- [ ] Update CLAUDE.md with secure file examples
- [ ] Update deployment guide
- [ ] Create .secure.local/.gitkeep template

### Phase 5: Validation & Polish (Day 7)
- [ ] End-to-end testing on all platforms
- [ ] Performance benchmarking
- [ ] Error message improvements
- [ ] Audit logging enhancements

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Accidental git commit of secrets | High | Medium | Auto-check .gitignore + pre-commit hook |
| File permissions too permissive | High | Low | Enforce 0400 default + validation |
| Remote transfer failures | Medium | Medium | Retry logic + detailed error messages |
| Secret Manager quota limits | Medium | Low | Batch operations + version reuse |
| Breaking existing deployments | High | Low | Backward compatible design |

---

## Alternatives Considered

### Alternative 1: Environment Variables Only
**Rejected**: Many services require file paths (GCP ADC, TLS certificates). Encoding large files as base64 env vars is anti-pattern.

### Alternative 2: Encrypted Git Storage (git-crypt)
**Rejected**: Adds complexity, requires key management, doesn't solve remote deployment problem.

### Alternative 3: Secrets-as-a-Service (HashiCorp Vault)
**Rejected**: Over-engineered for current scale, adds infrastructure dependency, violates platform-agnostic principle.

### Alternative 4: Manual Pre-Deployment Step
**Rejected**: Requires human intervention, error-prone, doesn't scale.

---

## Success Metrics

1. **Developer Experience**: Zero manual file transfers required for deployment
2. **Security**: Zero accidental secret commits in first 30 days
3. **Reliability**: 100% of deployments succeed with secure files on first try
4. **Performance**: Deployment time increase < 10% when using secure files
5. **Adoption**: image-gen-mcp migrated and working in all contexts within 1 sprint

---

## References

- [Sprint 372: Unified Bit Deploy](../sprint-372-unified-bit-deploy/technical-architecture.md)
- [Sprint 373: Storage Abstraction](../sprint-373-storage-abstraction/technical-architecture.md)
- [Docker Secrets Documentation](https://docs.docker.com/engine/swarm/secrets/)
- [GCP Secret Manager - Mounting as Files](https://cloud.google.com/run/docs/configuring/secrets#mounting_secrets_as_files)
- [12-Factor App: Config](https://12factor.net/config)

---

## Appendix A: Example Configurations

### Example 1: GCP Credentials

```yaml
image-gen-mcp:
  secureFiles:
    - local: .secure.local/gcp-credentials.json
      target: /var/secrets/gcp-credentials.json
      env: GOOGLE_APPLICATION_CREDENTIALS
      permissions: "0400"
```

### Example 2: TLS Certificate

```yaml
api-gateway:
  secureFiles:
    - local: .secure.staging/tls-cert.pem
      target: /etc/secrets/tls-cert.pem
      required: true
      context: staging

    - local: .secure.staging/tls-key.pem
      target: /etc/secrets/tls-key.pem
      permissions: "0400"
      context: staging
```

### Example 3: API Key File

```yaml
external-api-connector:
  secureFiles:
    - local: .secure.prod/api-key.txt
      target: /run/secrets/api-key.txt
      env: API_KEY_FILE
      required: true
      context: prod
```

---

## Appendix B: Platform Comparison Matrix

| Feature | Docker Compose (Local) | Docker Compose (Remote) | Cloud Run |
|---------|------------------------|-------------------------|-----------|
| File transfer | Volume mount | scp + volume mount | Secret Manager API |
| Encryption at rest | Host-level | Host-level | Google-managed |
| Encryption in transit | N/A | SSH | TLS |
| Permission control | Filesystem | Filesystem | IAM |
| Rotation support | Manual file replace | Manual file replace | Automatic versioning |
| Audit logging | None | SSH logs | Secret Manager audit logs |
| Cost | Free | Free | $0.06/10k accesses |
