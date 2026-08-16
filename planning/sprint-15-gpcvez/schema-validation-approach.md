# Schema Validation Approach (BL-004)

**Sprint**: sprint-15-gpcvez
**Task**: BL-004 - Validate architecture.yaml execution context schema approach
**Date**: 2026-08-16

---

## Current Schema Structure

### File: `tools/brat/src/config/execution-context-schema.ts`

**Schema Library**: Zod (lines 1)

**Current Deployment Schema** (lines 49-71):
```typescript
export const DeploymentSchema = z.object({
  type: z.enum(['docker-compose', 'cloud-run', 'k8s']),
  docker: DockerDeploymentSchema.optional(),
  gcp: GcpDeploymentSchema.optional(),
  k8s: K8sDeploymentSchema.optional(),
}).refine(/* validation for type-specific sub-config */);
```

**Current Docker Deployment Schema** (lines 21-25):
```typescript
export const DockerDeploymentSchema = z.object({
  host: z.string(),
  remoteDir: z.string().optional(),
  maxConcurrent: z.number().int().positive().optional(),
});
```

---

## Hook Schema Design

### Approach: Additive Schema Extension

**Principle**: Add new optional fields to existing schemas without breaking backward compatibility.

### 1. DeploymentHooks Schema (NEW)

**Location**: Add after line 43 (before DeploymentSchema)

```typescript
/**
 * Deployment lifecycle hooks
 * Sprint 15: Enables project-specific authentication and validation logic
 */
export const DeploymentHooksSchema = z.object({
  'pre-deploy': z.string().optional().describe('Hook executed before deployment (local)'),
  'post-deploy': z.string().optional().describe('Hook executed after containers start'),
  'pre-build': z.string().optional().describe('Hook executed before build step'),
  'post-build': z.string().optional().describe('Hook executed after build step'),
}).optional().refine(
  (hooks) => {
    if (!hooks) return true; // Hooks are optional

    // Validate hook paths are relative (not absolute)
    for (const [hookType, hookPath] of Object.entries(hooks)) {
      if (!hookPath) continue; // Optional hook not defined

      if (path.isAbsolute(hookPath)) {
        throw new Error(
          `Hook path must be relative (not absolute): ${hookType}=${hookPath}\n` +
          `Expected: .brat/hooks/staging/pre-deploy.sh\n` +
          `Received: ${hookPath}`
        );
      }

      // Validate file extension
      const validExtensions = ['.sh', '.bash', '.ts', '.js'];
      const ext = path.extname(hookPath);
      if (!validExtensions.includes(ext)) {
        throw new Error(
          `Hook must have valid extension (.sh, .bash, .ts, .js): ${hookType}=${hookPath}\n` +
          `Received: ${ext || '(no extension)'}`
        );
      }
    }

    return true;
  },
  {
    message: 'Hook paths must be relative with valid extensions',
  }
);
```

### 2. AdditionalSyncPaths Schema (NEW)

**Location**: Add in DockerDeploymentSchema (update lines 21-25)

```typescript
export const DockerDeploymentSchema = z.object({
  host: z.string(),
  remoteDir: z.string().optional(),
  maxConcurrent: z.number().int().positive().optional(),

  // Sprint 15: Additional file sync paths for remote deployments
  additionalSyncPaths: z.array(z.string()).optional().refine(
    (paths) => {
      if (!paths) return true; // Optional

      for (const syncPath of paths) {
        // Validate path is relative
        if (path.isAbsolute(syncPath)) {
          throw new Error(
            `additionalSyncPaths must be relative (not absolute): ${syncPath}`
          );
        }

        // Validate path doesn't escape repo (no ../)
        // Note: This is a basic check. Full validation happens at runtime in orchestrator.
        if (syncPath.startsWith('../') || syncPath.includes('/../')) {
          throw new Error(
            `additionalSyncPaths must not escape repository: ${syncPath}\n` +
            `Paths outside repo are rejected for security.`
          );
        }
      }

      return true;
    },
    {
      message: 'Additional sync paths must be relative and within repository',
    }
  ),
});
```

### 3. Update DeploymentSchema (MODIFY)

**Location**: Update line 49-71

```typescript
export const DeploymentSchema = z.object({
  type: z.enum(['docker-compose', 'cloud-run', 'k8s']),
  docker: DockerDeploymentSchema.optional(),
  gcp: GcpDeploymentSchema.optional(),
  k8s: K8sDeploymentSchema.optional(),

  // Sprint 15: Deployment lifecycle hooks
  hooks: DeploymentHooksSchema,
}).refine(/* existing type validation */);
```

---

## Schema Validation Strategy

### Level 1: Schema-level validation (Zod)
- Path format validation (relative vs absolute)
- File extension validation (.sh, .bash, .ts, .js)
- Type checking (string, array, object)

### Level 2: Runtime validation (HookExecutor)
- File existence check
- Execute permissions check (Unix only)
- Security validation (path traversal prevention)

### Level 3: Deployment validation (DockerComposeStrategy)
- Hook execution success/failure
- Remote SSH connectivity
- Hook output logging

---

## Backward Compatibility

**Guarantee**: 100% backward compatible

**Evidence**:
1. **hooks** is optional (new field, no breaking change)
2. **additionalSyncPaths** is optional (new field, no breaking change)
3. Existing contexts without hooks continue to work unchanged
4. No changes to required fields
5. No changes to existing field types or semantics

**Migration**: None required (additive changes only)

---

## Example: Updated architecture.yaml

```yaml
executionContexts:
  staging:
    description: Remote Docker staging environment
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/bitbrat-staging
        additionalSyncPaths:  # NEW (Sprint 15)
          - .brat/hooks
          - custom-scripts
      hooks:  # NEW (Sprint 15)
        pre-deploy: .brat/hooks/staging/pre-deploy-gcp-auth.sh
        post-deploy: .brat/hooks/staging/post-deploy-health-check.sh
    runtime:
      gateway:
        url: http://bitbrat.lan:3017
      persistence:
        driver: postgres
        connection:
          host: bitbrat.lan
          port: 5432
          database: bitbrat
          username: bitbrat
          password: ${BITBRAT_DB_PASSWORD}
```

---

## Schema Validation Testing

### Test Cases

1. **Valid hook paths**:
   - ✅ `.brat/hooks/pre-deploy.sh`
   - ✅ `custom/scripts/auth.bash`
   - ✅ `.brat/hooks/deploy.ts`

2. **Invalid hook paths**:
   - ❌ `/usr/bin/auth.sh` (absolute path)
   - ❌ `.brat/hooks/script` (no extension)
   - ❌ `.brat/hooks/script.py` (invalid extension)

3. **Valid additionalSyncPaths**:
   - ✅ `.brat/hooks`
   - ✅ `custom-scripts`
   - ✅ `vendor/lib`

4. **Invalid additionalSyncPaths**:
   - ❌ `/etc/secrets` (absolute path)
   - ❌ `../../etc/passwd` (escapes repo)

5. **Backward compatibility**:
   - ✅ Contexts without hooks field (omitted)
   - ✅ Contexts without additionalSyncPaths field (omitted)

---

## Implementation Checklist

- [ ] Add `DeploymentHooksSchema` to execution-context-schema.ts
- [ ] Update `DockerDeploymentSchema` with `additionalSyncPaths`
- [ ] Update `DeploymentSchema` with `hooks` field
- [ ] Add `path` import for validation
- [ ] Write unit tests for schema validation
- [ ] Update TypeScript types in `config/types.ts` to match schemas

---

## Acceptance Criteria

✅ **Schema Approach Confirmed**: Zod schemas with refinement validation
✅ **Backward Compatible**: All new fields are optional
✅ **Validation Strategy**: 3-level validation (schema, runtime, deployment)
✅ **Hook Configuration**: Supports all 4 hook types with path validation
✅ **Sync Paths**: Supports array of relative paths with security checks

---

**Status**: ✅ Complete (BL-004)
**Evidence**: Schema structure documented, validation approach defined
**Next**: Begin Phase 1 implementation (create HookExecutor class)
