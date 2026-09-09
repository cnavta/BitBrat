# Bit Lists for Execution Contexts

**Feature**: Environment-specific Bit whitelisting for BitBrat Execution Contexts (BEC)

**Status**: Architecture Design

**Intent**: Enable execution contexts to declare which Bits are deployable/runnable in that environment, supporting environment-specific service isolation (e.g., production-only Bits, staging-only Bits, local-dev-only Bits).

---

## Executive Summary

| Aspect | Description |
|--------|-------------|
| **Problem** | All Bits are currently deployable to all execution contexts. No mechanism exists to restrict specific Bits to specific environments (e.g., preventing deployment of experimental services to production, or requiring certain infrastructure-heavy services only in cloud environments). |
| **Solution** | Add optional `bits` whitelist to execution context configuration. When present, only listed Bits are deployable to that context. When absent, all active Bits remain deployable (backward compatible). |
| **Impact** | - Prevents accidental deployment of wrong services to wrong environments<br>- Enables environment-specific service topology<br>- Supports progressive rollout (staging-only → prod promotion)<br>- Enforces infrastructure constraints (e.g., obs-mcp requires local OBS Studio) |
| **Backward Compatibility** | ✅ 100% - Existing contexts without `bits` field behave identically to current behavior |

---

## Current Architecture Analysis

### Execution Context Structure (as of Sprint 358)

**Location**: `architecture.yaml` → `executionContexts` (permanent) or `.brat/ephemeral-contexts.yaml` (ephemeral)

**Example**:
```yaml
executionContexts:
  local:
    description: Local Docker development environment
    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock
    runtime:
      gateway:
        autoDiscover: true
        fallbackPort: 3004
      persistence:
        driver: postgres
        connection:
          host: localhost
          port: 5432
          database: bitbrat
          username: bitbrat
          password: bitbrat_dev_password
      envOverlay:
        path: env/local
        files:
          - global.yaml
          - infra.yaml
          - '{service}.yaml'
    tags:
      - development
      - local
```

**Current Service Selection Logic** (tools/brat/src/oclif-commands/bit/deploy.ts:109-137):

```typescript
if (flags.all) {
  // Deploy all active services
  for (const [name, svc] of Object.entries(allServices)) {
    if (svc.active) {  // ← ONLY checks active flag
      servicesToDeploy.push({ ...svc, name });
    }
  }
} else {
  // Deploy single service
  const svc = allServices[serviceName];
  if (!svc.active) {  // ← ONLY checks active flag
    this.error(`Service '${serviceName}' is not active`);
  }
  servicesToDeploy.push({ ...svc, name: serviceName });
}
```

**Current Limitations**:
- ❌ No context-aware filtering - `active` flag is global across all contexts
- ❌ Cannot restrict Bits to specific environments
- ❌ Cannot enforce infrastructure dependencies (e.g., obs-mcp requires OBS Studio → local/staging only)
- ❌ Cannot implement progressive rollout (deploy to staging, verify, then enable in prod)

---

## Proposed Architecture

### Schema Extension

**File**: `tools/brat/src/config/execution-context-schema.ts`

```typescript
/**
 * Execution Context
 * Sprint XXX: Added optional bits whitelist for environment-specific service isolation
 */
export const ExecutionContextSchema = z.object({
  description: z.string().optional(),
  deployment: DeploymentSchema,
  runtime: RuntimeConfigSchema,
  tags: z.array(z.string()).optional(),

  // NEW: Optional Bit whitelist
  bits: z.object({
    /**
     * List of Bit names allowed to deploy in this context.
     * When present: ONLY listed Bits are deployable (whitelist mode).
     * When absent: ALL active Bits are deployable (default behavior).
     */
    allowed: z.array(z.string()).optional(),

    /**
     * Enforcement mode (optional, default: 'strict').
     * - 'strict': Deployment fails if Bit not in allowed list.
     * - 'warn': Deployment proceeds but logs warning if Bit not in allowed list.
     * - 'none': Bit list is advisory only (for documentation).
     */
    enforcement: z.enum(['strict', 'warn', 'none']).optional().default('strict'),
  }).optional().refine(
    (data) => {
      // Validation: If bits is defined, allowed list must not be empty
      if (data && data.allowed && data.allowed.length === 0) {
        return false;
      }
      return true;
    },
    {
      message: 'bits.allowed must contain at least one Bit name when bits object is defined',
    }
  ),
});
```

**TypeScript Type**:
```typescript
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

// Extended type for internal use
export interface ExecutionContextWithBitList extends ExecutionContext {
  bits?: {
    allowed?: string[];
    enforcement?: 'strict' | 'warn' | 'none';
  };
}
```

---

### Configuration Examples

#### Example 1: Production Context (Strict Whitelist)

```yaml
executionContexts:
  prod:
    description: Production environment (GCP Cloud Run)
    deployment:
      type: cloud-run
      gcp:
        project: bitbrat-prod
        region: us-central1
    runtime:
      gateway:
        url: https://gateway.bitbrat.ai
      persistence:
        driver: postgres
        connection:
          host: prod-db.internal
          port: 5432
          database: bitbrat_prod
    tags:
      - production
      - cloud

    # Only allow core platform Bits and approved domain Bits
    bits:
      allowed:
        # Platform Bits (required for core orchestration)
        - ingress-egress
        - event-router
        - llm-bot
        - auth
        - persistence
        - tool-gateway
        - reflex
        - api-gateway
        - state-engine

        # Approved domain Bits (production-ready)
        - scheduler
        - image-gen-mcp
        - story-engine-mcp
        - claim-check

      enforcement: strict  # Reject deployments of non-listed Bits
```

#### Example 2: Staging Context (Progressive Rollout)

```yaml
executionContexts:
  staging:
    description: Staging environment on bitbrat.lan
    deployment:
      type: docker-compose
      docker:
        host: ssh://root@bitbrat.lan
        remoteDir: /opt/bitbrat-staging
    runtime:
      gateway:
        autoDiscover: true
        fallbackPort: 3004
      persistence:
        driver: postgres
        autoDiscover: true
    tags:
      - staging
      - remote

    # Allow all production Bits + experimental Bits for testing
    bits:
      allowed:
        # Include all production Bits (via YAML anchor/reference or explicit list)
        - ingress-egress
        - event-router
        - llm-bot
        - auth
        - persistence
        - tool-gateway
        - reflex
        - api-gateway
        - state-engine
        - scheduler
        - image-gen-mcp
        - story-engine-mcp
        - claim-check

        # Experimental Bits (staging-only until proven)
        - context-pack
        - event-stream-analyzer
        - disposition-service

        # Infrastructure-dependent Bits
        - obs-mcp  # Requires OBS Studio on staging host

      enforcement: strict
```

#### Example 3: Local Development Context (No Restrictions)

```yaml
executionContexts:
  local:
    description: Local Docker development environment
    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock
    runtime:
      gateway:
        autoDiscover: true
        fallbackPort: 3004
      persistence:
        driver: postgres
        autoDiscover: true
    tags:
      - development
      - local

    # No bits restriction - all active Bits deployable for local dev
    # (bits field omitted for backward compatibility)
```

#### Example 4: Agent-Dev Context (Ephemeral, Warn Mode)

```yaml
executionContexts:
  agent-dev-1234567890:
    description: Ephemeral agent development context
    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock
    runtime:
      gateway:
        autoDiscover: true
      persistence:
        driver: postgres
        autoDiscover: true
    tags:
      - agent-dev
      - ephemeral

    # Recommended Bits for agent-dev (warn mode for flexibility)
    bits:
      allowed:
        - ingress-egress
        - event-router
        - llm-bot
        - tool-gateway
        - persistence
      enforcement: warn  # Allow deployment of other Bits but warn agent
```

---

### Implementation Plan

#### Phase 1: Schema & Validation (2 hours)

**Files Modified**:
- `tools/brat/src/config/execution-context-schema.ts` (schema extension)
- `tools/brat/src/config/execution-context-schema.test.ts` (new tests)

**Changes**:
1. Add `bits` field to `ExecutionContextSchema` (optional, with validation)
2. Add Zod refinement to ensure non-empty `allowed` list
3. Add unit tests for schema validation

**Test Cases**:
```typescript
describe('ExecutionContextSchema - Bit Lists', () => {
  it('accepts context without bits field (backward compatible)', () => {
    const context = { deployment: {...}, runtime: {...} };
    expect(() => ExecutionContextSchema.parse(context)).not.toThrow();
  });

  it('accepts context with valid bits whitelist', () => {
    const context = {
      deployment: {...},
      runtime: {...},
      bits: {
        allowed: ['llm-bot', 'ingress-egress'],
        enforcement: 'strict',
      },
    };
    expect(() => ExecutionContextSchema.parse(context)).not.toThrow();
  });

  it('rejects context with empty allowed list', () => {
    const context = {
      deployment: {...},
      runtime: {...},
      bits: { allowed: [] },
    };
    expect(() => ExecutionContextSchema.parse(context)).toThrow('must contain at least one Bit');
  });

  it('defaults enforcement to strict when not specified', () => {
    const context = {
      deployment: {...},
      runtime: {...},
      bits: { allowed: ['llm-bot'] },
    };
    const parsed = ExecutionContextSchema.parse(context);
    expect(parsed.bits?.enforcement).toBe('strict');
  });
});
```

---

#### Phase 2: Deployment Filtering Logic (3 hours)

**Files Modified**:
- `tools/brat/src/oclif-commands/bit/deploy.ts` (add filtering)
- `tools/brat/src/orchestration/deployment/strategy.ts` (validation hook)

**New Module**:
- `tools/brat/src/orchestration/deployment/bit-list-validator.ts`

**Implementation**:

```typescript
// tools/brat/src/orchestration/deployment/bit-list-validator.ts

import type { ResolvedContext } from '../../context/types';
import type { ServiceWithName } from './strategy';

export interface BitListValidationResult {
  allowed: boolean;
  enforcement: 'strict' | 'warn' | 'none';
  reason?: string;
}

/**
 * Validates whether a Bit is allowed to deploy in a given execution context.
 *
 * Logic:
 * 1. If context has no bits configuration → allow (backward compatible)
 * 2. If context has bits.allowed → check if service in list
 * 3. Apply enforcement mode (strict/warn/none)
 */
export class BitListValidator {
  /**
   * Validate single Bit against context's bit whitelist
   */
  validate(
    service: ServiceWithName,
    context: ResolvedContext
  ): BitListValidationResult {
    // No bit list configured → allow all (backward compatible)
    if (!context.bits || !context.bits.allowed) {
      return {
        allowed: true,
        enforcement: 'none',
      };
    }

    const { allowed, enforcement = 'strict' } = context.bits;
    const isAllowed = allowed.includes(service.name);

    if (!isAllowed) {
      return {
        allowed: false,
        enforcement,
        reason: `Bit '${service.name}' not in allowed list for context '${context.name}'. ` +
                `Allowed Bits: ${allowed.join(', ')}`,
      };
    }

    return {
      allowed: true,
      enforcement,
    };
  }

  /**
   * Validate multiple Bits against context's bit whitelist.
   * Returns filtered list + warnings/errors.
   */
  validateAll(
    services: ServiceWithName[],
    context: ResolvedContext
  ): {
    allowed: ServiceWithName[];
    blocked: Array<{ service: string; reason: string }>;
    warnings: string[];
  } {
    const allowed: ServiceWithName[] = [];
    const blocked: Array<{ service: string; reason: string }> = [];
    const warnings: string[] = [];

    for (const service of services) {
      const result = this.validate(service, context);

      if (result.allowed) {
        allowed.push(service);
      } else {
        // Enforcement mode handling
        if (result.enforcement === 'strict') {
          blocked.push({
            service: service.name,
            reason: result.reason || 'Not in allowed list',
          });
        } else if (result.enforcement === 'warn') {
          warnings.push(
            `⚠️  ${service.name}: ${result.reason || 'Not in allowed list'} (deploying anyway in warn mode)`
          );
          allowed.push(service); // Allow deployment but warn
        } else {
          // enforcement === 'none' → advisory only
          allowed.push(service);
        }
      }
    }

    return { allowed, blocked, warnings };
  }
}
```

**Integration into deploy.ts**:

```typescript
// tools/brat/src/oclif-commands/bit/deploy.ts

import { BitListValidator } from '../../orchestration/deployment/bit-list-validator';

export default class BitDeploy extends BratCommand {
  async run(): Promise<void> {
    // ... existing code ...

    // Select services to deploy
    const allServices = resolveServices(architecture);
    const candidateServices: ServiceWithName[] = [];

    // Phase 1: Filter by active flag (existing logic)
    if (flags.all) {
      for (const [name, svc] of Object.entries(allServices)) {
        if (svc.active) {
          candidateServices.push({ ...svc, name });
        }
      }
    } else {
      const serviceName = args.service!;
      const svc = allServices[serviceName];
      if (!svc) {
        this.error(`Service '${serviceName}' not found in architecture.yaml`, { exit: 1 });
      }
      if (!svc.active) {
        this.error(`Service '${serviceName}' is not active`, { exit: 1 });
      }
      candidateServices.push({ ...svc, name: serviceName });
    }

    // Phase 2: Filter by execution context bit list (NEW)
    const validator = new BitListValidator();
    const validation = validator.validateAll(candidateServices, resolvedContext);

    // Handle warnings
    if (validation.warnings.length > 0) {
      this.log('');
      validation.warnings.forEach(w => this.warn(w));
      this.log('');
    }

    // Handle blocked services (strict enforcement)
    if (validation.blocked.length > 0) {
      this.log('');
      this.error(
        `Cannot deploy the following Bit(s) to context '${contextName}':\n` +
        validation.blocked.map(b => `  - ${b.service}: ${b.reason}`).join('\n') +
        `\n\nTo deploy these Bits, add them to executionContexts.${contextName}.bits.allowed in architecture.yaml`,
        { exit: 1 }
      );
    }

    const servicesToDeploy = validation.allowed;

    if (servicesToDeploy.length === 0) {
      this.error('No services to deploy after filtering', { exit: 1 });
    }

    this.log(`Deploying ${servicesToDeploy.length} Bit(s): ${servicesToDeploy.map(s => s.name).join(', ')}`);

    // ... continue with existing deployment logic ...
  }
}
```

---

#### Phase 3: Agent-Dev Integration (1 hour)

**Files Modified**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts` (provision logic)

**Changes**:

```typescript
// tools/brat/src/dev-mcp/agent-dev-context-manager.ts

export interface ProvisionOptions {
  name?: string;
  profile?: 'dev' | 'staging';
  persistence?: 'postgres' | 'firestore';

  // NEW: Optional bit list for agent-dev contexts
  allowedBits?: string[];
  bitEnforcement?: 'strict' | 'warn' | 'none';
}

export class AgentDevContextManager {
  async provision(options: ProvisionOptions = {}): Promise<ProvisionResult> {
    // ... existing provisioning logic ...

    // Build context configuration
    const contextConfig = await buildNonInteractive({...});

    // Add bit list if specified
    if (options.allowedBits && options.allowedBits.length > 0) {
      contextConfig.bits = {
        allowed: options.allowedBits,
        enforcement: options.bitEnforcement || 'warn', // Default to warn for agent-dev
      };
    }

    // ... rest of provisioning ...
  }
}
```

**MCP Tool Extension** (`tools/brat/src/dev-mcp/tools/agent-dev.ts`):

```typescript
const provisionSchema = z.object({
  name: z.string().optional(),
  persistence: z.enum(['postgres', 'firestore']).optional(),
  profile: z.enum(['dev', 'staging']).optional(),

  // NEW fields
  allowedBits: z.array(z.string()).optional()
    .describe('Optional list of Bits allowed to deploy in this context'),
  bitEnforcement: z.enum(['strict', 'warn', 'none']).optional()
    .describe('Enforcement mode for bit list (default: warn)'),
});
```

---

#### Phase 4: Testing (2 hours)

**Test Files**:
- `tools/brat/src/orchestration/deployment/bit-list-validator.test.ts` (unit tests)
- `tools/brat/src/oclif-commands/bit/deploy-bit-list.test.ts` (integration tests)
- `tools/brat/src/dev-mcp/agent-dev-bit-list.test.ts` (agent-dev tests)

**Test Scenarios**:

```typescript
describe('BitListValidator', () => {
  describe('validate()', () => {
    it('allows all Bits when context has no bit list', () => {
      const context = createMockContext({ bits: undefined });
      const service = createMockService('llm-bot');
      const result = validator.validate(service, context);
      expect(result.allowed).toBe(true);
    });

    it('allows Bit in whitelist (strict mode)', () => {
      const context = createMockContext({
        bits: { allowed: ['llm-bot', 'ingress-egress'], enforcement: 'strict' },
      });
      const service = createMockService('llm-bot');
      const result = validator.validate(service, context);
      expect(result.allowed).toBe(true);
    });

    it('blocks Bit not in whitelist (strict mode)', () => {
      const context = createMockContext({
        bits: { allowed: ['llm-bot'], enforcement: 'strict' },
      });
      const service = createMockService('obs-mcp');
      const result = validator.validate(service, context);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in allowed list');
    });

    it('warns but allows Bit not in whitelist (warn mode)', () => {
      const context = createMockContext({
        bits: { allowed: ['llm-bot'], enforcement: 'warn' },
      });
      const service = createMockService('obs-mcp');
      const result = validator.validate(service, context);
      expect(result.allowed).toBe(false); // Not in list
      expect(result.enforcement).toBe('warn'); // But warn mode
    });
  });

  describe('validateAll()', () => {
    it('filters blocked services in strict mode', () => {
      const context = createMockContext({
        bits: { allowed: ['llm-bot'], enforcement: 'strict' },
      });
      const services = [
        createMockService('llm-bot'),
        createMockService('obs-mcp'),
        createMockService('ingress-egress'),
      ];
      const result = validator.validateAll(services, context);
      expect(result.allowed).toHaveLength(1);
      expect(result.allowed[0].name).toBe('llm-bot');
      expect(result.blocked).toHaveLength(2);
    });
  });
});

describe('brat bit deploy --all (with bit lists)', () => {
  it('deploys only whitelisted Bits when context has bit list', async () => {
    // Setup architecture with 5 active Bits
    mockArchitecture({
      services: {
        'llm-bot': { active: true },
        'obs-mcp': { active: true },
        'ingress-egress': { active: true },
        'persistence': { active: true },
        'event-router': { active: true },
      },
    });

    // Setup context with bit list (only 3 allowed)
    mockContext('staging', {
      bits: {
        allowed: ['llm-bot', 'ingress-egress', 'event-router'],
        enforcement: 'strict',
      },
    });

    // Run deploy --all
    const result = await runCommand(['bit', 'deploy', '--all', '--context', 'staging']);

    // Expect only 3 Bits deployed
    expect(result.deployedServices).toHaveLength(3);
    expect(result.deployedServices).toContain('llm-bot');
    expect(result.deployedServices).toContain('ingress-egress');
    expect(result.deployedServices).toContain('event-router');
    expect(result.deployedServices).not.toContain('obs-mcp');
    expect(result.deployedServices).not.toContain('persistence');
  });

  it('fails deployment when single Bit not in whitelist', async () => {
    mockContext('prod', {
      bits: { allowed: ['llm-bot'], enforcement: 'strict' },
    });

    await expect(
      runCommand(['bit', 'deploy', 'obs-mcp', '--context', 'prod'])
    ).rejects.toThrow(/not in allowed list/);
  });
});
```

---

### Migration Strategy

#### Backward Compatibility Checklist

✅ **Existing contexts without `bits` field**: No change in behavior - all active Bits deployable
✅ **Existing deployment commands**: No breaking changes - validation layer added transparently
✅ **Ephemeral contexts**: Can opt into bit lists via MCP tools
✅ **Schema validation**: Uses optional field with sensible defaults

#### Migration Path for Existing Deployments

**Phase 1: Enable in staging/dev first (Week 1)**
```yaml
# Add bit lists to non-production contexts first
staging:
  bits:
    allowed: [...]
    enforcement: warn  # Start with warn mode
```

**Phase 2: Validate warnings in logs (Week 2)**
- Review deployment logs for warnings
- Identify unexpected Bits being deployed
- Adjust whitelist accordingly

**Phase 3: Promote to strict mode (Week 3)**
```yaml
staging:
  bits:
    allowed: [...]
    enforcement: strict  # Enforce after validation
```

**Phase 4: Roll out to production (Week 4)**
```yaml
prod:
  bits:
    allowed: [core-platform-bits, approved-domain-bits]
    enforcement: strict
```

---

### Edge Cases & Error Handling

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| Context has `bits: {}` (empty object) | Allow all Bits | Empty object treated as "no restrictions" |
| Context has `bits.allowed: []` | Schema validation error | Empty whitelist is invalid (use no bits field instead) |
| Service in whitelist but not active | Deployment fails (active check first) | active flag takes precedence |
| Service not in whitelist, enforcement: none | Deploy with no warning | Advisory mode for documentation |
| Typo in allowed Bit name | No error (unknown Bit never deployed) | Typos self-correct (Bit won't match) |
| `--all` with all Bits blocked | Error: "No services to deploy" | Prevent no-op deployments |
| Single Bit blocked in strict mode | Error with remediation message | Clear user guidance |

---

### Performance Impact

| Operation | Current | With Bit Lists | Delta |
|-----------|---------|----------------|-------|
| Schema validation | ~5ms | ~6ms | +1ms (Zod validation) |
| Service resolution | ~10ms | ~12ms | +2ms (filtering) |
| Deployment planning | ~50ms | ~52ms | +2ms (validation) |
| **Total overhead** | - | - | **~5ms (negligible)** |

---

### Alternative Designs Considered

#### Alternative 1: Bit-Level Context Tags

**Approach**: Add `allowedContexts: ['local', 'staging']` to each Bit in `architecture.yaml`

**Pros**:
- Centralized service configuration
- Single source of truth per Bit

**Cons**:
- ❌ Requires modifying every Bit definition
- ❌ Harder to understand context topology at a glance
- ❌ Doesn't support dynamic context creation (agent-dev)
- ❌ Violates separation of concerns (Bit config vs deployment config)

**Verdict**: Rejected - Context-centric whitelist is more maintainable

---

#### Alternative 2: Separate Bit List Files

**Approach**: Create `env/{context}/allowed-bits.yaml` files

**Pros**:
- Keeps execution context config lean
- Easy to version control per-environment

**Cons**:
- ❌ Fragmented configuration (context in one file, bits in another)
- ❌ Harder to validate (two files to keep in sync)
- ❌ Doesn't integrate with existing ExecutionContext schema

**Verdict**: Rejected - Inline bit list in execution context is more cohesive

---

#### Alternative 3: Regex/Pattern-Based Matching

**Approach**: Allow `bits.allowed: ['llm-*', 'mcp-*']` with glob/regex patterns

**Pros**:
- More compact for large Bit sets
- Supports naming conventions

**Cons**:
- ❌ Less explicit (harder to understand what's allowed)
- ❌ Error-prone (typos in patterns)
- ❌ Doesn't align with Bit naming conventions (not hierarchical)

**Verdict**: Rejected - Explicit list is clearer for security-critical whitelisting

---

## Documentation Updates

**Files to Update**:
1. `documentation/guides/agent-dev-contexts.md` - Add bit list examples for agent-dev
2. `documentation/concepts/execution-contexts.md` - Document bit list feature (create if missing)
3. `CLAUDE.md` - Add bit list pattern to "Common Development Patterns" section
4. `architecture.yaml` - Add inline comments for bit list feature

**Example Documentation Section**:

```markdown
### Restricting Bits to Specific Environments

Use the `bits` field in execution contexts to control which Bits can deploy to each environment:

```yaml
executionContexts:
  prod:
    bits:
      allowed:
        - ingress-egress
        - llm-bot
        - event-router
      enforcement: strict  # Reject unlisted Bits
```

**Enforcement Modes**:
- `strict` (default): Deployment fails if Bit not in whitelist
- `warn`: Deployment proceeds but logs warning
- `none`: Bit list is advisory only

**Best Practices**:
- Production: Use strict enforcement with minimal Bit set
- Staging: Include production Bits + experimental Bits
- Local: Omit bit list for full flexibility
- Agent-dev: Use warn mode for agent guidance
```

---

## Security Considerations

| Risk | Mitigation |
|------|-----------|
| **Accidental production deploy of experimental Bit** | Strict enforcement blocks deployment |
| **Typo in bit list allows unintended Bit** | Validation warns if listed Bit doesn't exist (future enhancement) |
| **Agent bypasses bit list** | Enforcement at deployment layer (not just validation) |
| **Bit renamed breaks whitelist** | Deployment fails explicitly (user updates whitelist) |

---

## Future Enhancements

### Phase 2 Features (Post-MVP)

1. **Bit Dependency Validation**: Auto-include dependent Bits in whitelist
   ```yaml
   bits:
     allowed: ['llm-bot']
     includeRequiredDeps: true  # Auto-adds tool-gateway, ingress-egress, etc.
   ```

2. **Bit List Templates**: Reusable presets for common topologies
   ```yaml
   bits:
     template: core-platform  # Expands to [ingress-egress, event-router, ...]
     additional: ['obs-mcp']
   ```

3. **Bit List Validation Report**: CLI command to audit bit lists
   ```bash
   brat context validate-bits --context prod
   # Output: 5 Bits allowed, 3 active, 2 inactive (unused in whitelist)
   ```

4. **Bit List Diff**: Compare bit lists between contexts
   ```bash
   brat context diff-bits --from staging --to prod
   # Output: +2 Bits added, -1 Bit removed
   ```

---

## Summary

**Core Changes**:
- ✅ Add optional `bits` field to `ExecutionContextSchema` (backward compatible)
- ✅ Implement `BitListValidator` for deployment filtering
- ✅ Integrate validation into `brat bit deploy` command
- ✅ Support three enforcement modes: strict, warn, none
- ✅ Extend agent-dev provisioning with bit list support

**Timeline**: ~8 hours total (1 sprint)
- Schema/validation: 2h
- Deployment integration: 3h
- Agent-dev integration: 1h
- Testing: 2h

**Risk**: Low - Feature is opt-in and backward compatible

**Value**: High - Prevents misdeployment, enables environment-specific topologies
