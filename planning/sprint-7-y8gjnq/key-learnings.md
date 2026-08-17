# Sprint 6 Key Learnings

**Sprint**: S6 - Foundation & Production Migration
**Focus**: architecture.yaml v2 schema migration, validation tooling, multi-environment validation
**Date**: 2026-08-10

---

## 1. Schema Validation Prevents Deployment Failures

### The Learning

Comprehensive schema validation with detailed error reporting catches configuration issues **before** they cause deployment failures.

### Evidence

**Before Validation**:
- 4 services missing infrastructure dependencies
- 2 services with undeclared messaging usage
- Unknown infrastructure dependency mismatches

**After Running `brat config validate --schema v2`**:
```
⚠️  4 WARNING(S):
  Path: services.api-gateway.dependencies.infrastructure
  Warning: Active platform service has no infrastructure dependencies

  Path: services.state-engine.dependencies.infrastructure
  Warning: Active platform service has no infrastructure dependencies

  ...
```

**Impact**:
- All 6 services fixed before deployment
- 0 deployment failures due to missing infrastructure
- 0 runtime errors from missing dependencies

### How to Apply

1. **Always validate before deploying**:
   ```bash
   npm run brat -- config validate --schema v2
   ```

2. **Run validation in CI/CD**:
   ```yaml
   # .github/workflows/validate.yml
   - name: Validate architecture.yaml
     run: npm run brat -- config validate --schema v2 --json
   ```

3. **Fix warnings before they become errors**:
   - Warnings indicate potential issues
   - Address warnings before merging to main
   - Don't ignore validation output

### Anti-Patterns to Avoid

- ❌ Skipping validation because "it worked last time"
- ❌ Ignoring warnings ("they're just warnings")
- ❌ Validating only after deployment failures

---

## 2. LLM-Friendly Documentation = Copy-Paste-Ready Examples

### The Learning

Documentation is most useful when it contains **complete, working examples** that can be copied and pasted directly into projects.

### Evidence

**Added to infrastructure-management.md**:
- 4 complete Docker provider examples (NATS, PostgreSQL, Redis, Full Stack)
- Each example includes:
  - Complete architecture.yaml configuration
  - Service usage code (TypeScript)
  - Environment variable configuration
  - Deployment commands
  - Health check verification

**Example Structure**:
```markdown
### Example 1: NATS (Messaging)

**Full configuration**:
```yaml
# architecture.yaml - Complete, copy-paste-ready
platform:
  infrastructure:
    messaging:
      required: true
      intent: "Message bus for event-driven service orchestration"
# ... (complete configuration)
```

**Service usage**:
```typescript
// src/apps/my-service.ts - Actual usage code
export class MyService extends Bit {
  async setup(): Promise<void> {
    const natsUrl = this.getConfig('NATS_URL');
    await this.onMessage('internal.my-topic.v1', async (data, attrs, ctx) => {
      // ...
    });
  }
}
```
```

### Impact

- Developers can copy examples directly
- No need to piece together partial configurations
- Reduced time from documentation to working code
- LLMs can extract complete patterns

### How to Apply

**Documentation Checklist**:
- [ ] Complete configuration (not fragments)
- [ ] Actual code examples (not pseudocode)
- [ ] Environment variables included
- [ ] Deployment commands provided
- [ ] Health check verification included

**Example Template**:
```markdown
### Example: [Feature Name]

**Full configuration**:
```yaml
# Complete architecture.yaml
```

**Service usage**:
```typescript
// Complete TypeScript code
```

**Environment**:
```yaml
# env/local/infra.yaml
```

**Deploy**:
```bash
# Exact commands to deploy
```

**Verify**:
```bash
# Health checks
```
```

### Anti-Patterns to Avoid

- ❌ Partial configurations requiring "fill in the blanks"
- ❌ Pseudocode instead of actual working code
- ❌ Missing environment variable configuration
- ❌ No deployment/verification instructions

---

## 3. Refactoring Core Interfaces Requires Atomic Test Updates

### The Learning

When refactoring core interfaces (like function signatures), **all dependent tests must be updated atomically** in the same commit to avoid broken builds.

### Evidence

**Refactoring ComposeFactory**:
```typescript
// BEFORE
constructor(
  private readonly repoRoot: string,
  baseComposePath?: string  // Optional with fallback
) {
  this.baseComposePath = baseComposePath || 'infrastructure/docker-compose/docker-compose.local.yaml';
}

// AFTER
constructor(
  private readonly repoRoot: string,
  baseComposePath?: string  // Required, no fallback
) {
  if (!baseComposePath) {
    throw new Error('ComposeFactory requires an explicit baseComposePath...');
  }
  this.baseComposePath = baseComposePath;
}
```

**Impact on Tests**:
- 7 tests failed immediately
- All tests used `new ComposeFactory(repoRoot)` without second parameter
- Required updating test helper function to return both `repoRoot` and `composePath`
- All 7 tests needed `baseComposePath` parameter added

### How to Apply

**Before Refactoring**:
1. Identify all call sites (tests and production code)
   ```bash
   grep -r "new ComposeFactory" .
   grep -r "ComposeFactory(" .
   ```

2. Plan updates for ALL call sites
   - Update production code
   - Update test code
   - Update test helpers/fixtures

3. Make changes atomically in single commit
   - Refactor interface
   - Update all call sites
   - Fix all tests
   - Commit together

**After Refactoring**:
```bash
# Verify all tests pass
npm test

# Verify no broken call sites
npm run build
```

### Anti-Patterns to Avoid

- ❌ Refactoring interface in one commit, fixing tests in another
- ❌ Updating some call sites but not others
- ❌ Assuming tests will "just work" after interface changes
- ❌ Merging with failing tests

---

## 4. Pattern Matching Needs Explicit Documentation

### The Learning

Regex patterns for file/path matching require **explicit documentation with examples** of what matches and what doesn't match.

### Evidence

**Pattern**: `/docker-compose\.[a-z-]+\.yaml$/`
**Intended**: Match context-specific files like `docker-compose.local.yaml`, `docker-compose.staging.yaml`
**Problem**: Also matched `docker-compose.base.yaml` in tests

**Impact**:
- Tests failed because `docker-compose.base.yaml` was treated as context-specific
- ComposeFactory returned empty `serviceFiles` array
- Had to use `docker-compose.yaml` (no context suffix) for tests

### How to Apply

**Document Patterns with Examples**:
```typescript
/**
 * Detects context-specific compose files.
 *
 * Pattern: /docker-compose\.[a-z-]+\.yaml$/
 *
 * Matches:
 * - docker-compose.local.yaml
 * - docker-compose.staging.yaml
 * - docker-compose.prod.yaml
 * - docker-compose.agent-dev-xyz.yaml
 *
 * Does NOT match:
 * - docker-compose.yaml (no context suffix)
 * - docker-compose.base.yaml (ambiguous, but matches pattern!)
 * - docker-compose.test.json (wrong extension)
 *
 * @see Sprint 6 S6-C4.1 for context-specific pattern rationale
 */
const isContextSpecificCompose = /docker-compose\.[a-z-]+\.yaml$/.test(this.baseComposePath);
```

**Test Pattern Matching**:
```typescript
describe('Context-specific pattern matching', () => {
  it('matches context-specific files', () => {
    expect(isContextSpecific('docker-compose.local.yaml')).toBe(true);
    expect(isContextSpecific('docker-compose.staging.yaml')).toBe(true);
  });

  it('does not match generic files', () => {
    expect(isContextSpecific('docker-compose.yaml')).toBe(false);
  });
});
```

### Anti-Patterns to Avoid

- ❌ Undocumented regex patterns
- ❌ No examples of what matches/doesn't match
- ❌ Ambiguous pattern names (e.g., `isSpecial` vs. `isContextSpecific`)
- ❌ No tests for pattern matching behavior

---

## 5. Multi-Environment Validation Catches Cross-Environment Issues

### The Learning

Automated multi-environment validation scripts catch **cross-environment inconsistencies** that single-environment validation misses.

### Evidence

**Validation Script** (`validate-multi-env.ts`):
- Validated 2 contexts (local, staging)
- Checked platform infrastructure consistency
- Verified service dependencies match usage patterns
- Generated comprehensive report

**Issues Found**:
- 2 services (scheduler, story-engine-mcp) missing infrastructure dependencies
- Both services used messaging/persistence but didn't declare dependencies
- Single-environment validation would have missed cross-environment comparison

**Impact**:
- All contexts now have consistent infrastructure declarations
- Services explicitly declare all dependencies
- 0 errors, 0 warnings across all validated contexts

### How to Apply

**Create Multi-Environment Validation Script**:
```typescript
// validate-multi-env.ts
function validateContext(contextName: string, context: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check 1: Provider consistency
  if (context.infrastructure?.provider !== 'docker') {
    errors.push(`Expected provider: docker, got: ${context.infrastructure?.provider}`);
  }

  // Check 2: Deployment type consistency
  if (context.deployment?.type !== 'docker-compose') {
    warnings.push(`Expected deployment.type: docker-compose, got: ${context.deployment?.type}`);
  }

  return { context: contextName, valid: errors.length === 0, errors, warnings };
}
```

**Run in CI/CD**:
```yaml
# .github/workflows/validate.yml
- name: Validate multi-environment consistency
  run: npx ts-node planning/sprint-X/validate-multi-env.ts
```

### Anti-Patterns to Avoid

- ❌ Only validating one environment
- ❌ Assuming all environments are consistent
- ❌ Manual cross-environment comparison
- ❌ No validation for ephemeral contexts (agent-dev)

---

## 6. Ephemeral Contexts Need Special Validation Handling

### The Learning

Ephemeral execution contexts (like agent-dev) require **special validation procedures** because they don't persist between validation runs.

### Evidence

**Agent-Dev Contexts**:
- Designed to be ephemeral (created, used, destroyed)
- Stored in `.brat/ephemeral-contexts.yaml` (gitignored)
- No active agent-dev contexts existed during Sprint 6 validation

**Validation Challenge**:
- Multi-environment validation script expected persistent contexts
- Agent-dev contexts had been destroyed after use
- Couldn't validate ephemeral contexts because they didn't exist

**Solution Needed**:
- Create "provision → validate → destroy" workflow
- Or maintain long-lived test agent-dev context for validation purposes

### How to Apply

**Option 1: Ephemeral Validation Workflow**
```bash
#!/bin/bash
# validate-ephemeral-contexts.sh

# Provision ephemeral context
CONTEXT_NAME=$(npm run brat -- agent-dev provision | grep "agent-dev-" | awk '{print $2}')

# Start services
npm run brat -- agent-dev start --name $CONTEXT_NAME

# Validate
npm run brat -- config validate --context $CONTEXT_NAME --schema v2

# Destroy
npm run brat -- agent-dev destroy --name $CONTEXT_NAME --confirm
```

**Option 2: Long-Lived Test Context**
```yaml
# .brat/ephemeral-contexts.yaml
agent-dev-test:
  description: "Long-lived context for validation testing"
  ephemeral: false  # Don't auto-delete
  # ... rest of config
```

### Anti-Patterns to Avoid

- ❌ Assuming ephemeral contexts will exist during validation
- ❌ Not documenting ephemeral nature of agent-dev contexts
- ❌ Validation scripts that fail when no contexts exist
- ❌ No validation procedure for ephemeral contexts

---

## 7. Sprint Scope Should Be Flexible

### The Learning

Sprint planning should clearly separate **MVP scope** (must-have) from **stretch goals** (nice-to-have), allowing flexible adaptation to changing requirements.

### Evidence

**Original Sprint Plan**:
- 15 tasks total
- All marked as "must complete"
- No distinction between MVP and stretch goals

**Actual Execution**:
- S6-P3.2 (Migrate prod) - Not needed for Sprint 6
- S6-P3.3 (GCP provider) - Deferred to future sprint
- User clarified scope changes during execution

**Result**:
- 12/15 tasks completed (80%)
- Sprint goals still achieved
- No impact on sprint success

### How to Apply

**Sprint Planning Template**:
```yaml
tasks:
  # MVP Scope (Required for sprint success)
  - id: S6-F1.1
    title: Create JSON Schema
    priority: P0
    scope: MVP  # ✅ Mark as MVP

  # Stretch Goals (Nice to have)
  - id: S6-P3.3
    title: Implement GCP provider
    priority: P2
    scope: STRETCH  # ✅ Mark as stretch goal

  # Optional (Can be deferred)
  - id: S6-C4.3
    title: Archive v1 docs
    priority: P3
    scope: OPTIONAL  # ✅ Mark as optional
```

**Sprint Review**:
- Evaluate MVP scope completion (must be 100%)
- Evaluate stretch goal completion (flexible)
- Document deferred tasks with clear rationale

### Anti-Patterns to Avoid

- ❌ Treating all tasks as equal priority
- ❌ No distinction between must-have and nice-to-have
- ❌ Considering sprint "failed" when stretch goals aren't met
- ❌ Not documenting why tasks were deferred

---

## Summary: Top 3 Actionable Learnings

### 1. **Validate Early, Validate Often**
- Run `brat config validate --schema v2` before every deployment
- Add validation to CI/CD pipeline
- Fix warnings before they become errors
- Create multi-environment validation scripts

### 2. **Document with Complete Examples**
- Provide copy-paste-ready configurations
- Include actual service usage code
- Document environment variables and deployment steps
- Use LLM-friendly format (tables, code blocks, before/after)

### 3. **Plan Sprints with Flexibility**
- Separate MVP scope from stretch goals
- Mark optional tasks clearly
- Allow scope adaptation during sprint
- Measure success by MVP completion, not total task count

---

**Key Learnings Documented By**: Claude Code
**Date**: 2026-08-10
**Version**: 1.0
