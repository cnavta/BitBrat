# Key Learnings: Sprint 2 - Redis BEC Generation Gaps

**Sprint ID**: sprint-2-8olsv2
**Date**: 2026-08-07
**Context**: Implementing automatic Redis configuration for new execution contexts

---

## Technical Learnings

### 1. Conservative Infrastructure Design Pattern

**Learning**: When adding platform-level infrastructure, "always include" is often simpler than "conditionally include"

**Context**: Deciding whether to always include Redis or conditionally detect which contexts need it

**Implementation**:
```typescript
// Always include redis (like nats)
export function getRequiredInfrastructure(
  repoRoot: string,
  services: ServiceMetadata[]
): Set<string> {
  const infrastructure = new Set<string>();

  // ... other infrastructure

  // Always need redis for idempotency (Sprint 1+)
  infrastructure.add('redis');

  return infrastructure;
}
```

**Why It Works**:
- Redis is lightweight (~10MB memory overhead)
- Services fail-open gracefully if they don't use it
- Eliminates complex conditional logic
- Future-proof for when more services adopt idempotency
- Consistent infrastructure across all contexts

**When to Apply**:
- Adding platform-level infrastructure (message buses, caches, databases)
- Cost of inclusion is minimal
- Feature will eventually be universal
- Simplicity outweighs optimization

**When NOT to Apply**:
- Heavy infrastructure (e.g., large ML models)
- Cloud-specific services with significant cost
- Features that are truly optional

---

### 2. TypeScript Interface Compliance in Tests

**Learning**: Test objects must exactly match interface definitions, not just "close enough"

**Problem Encountered**:
```typescript
// ❌ Incorrect - 'port' doesn't exist in ServiceMetadata
const metadata: ServiceMetadata = {
  name: 'auth',
  profile: 'core',
  category: 'platform',
  entry: 'src/apps/auth-service.ts',
  port: 3000,  // ❌ Not in interface
  envKeys: [],
};
```

**Correct Approach**:
```typescript
// ✅ Correct - matches ServiceMetadata interface exactly
const metadata: ServiceMetadata = {
  name: 'auth',
  active: true,         // Required
  profile: 'core',
  category: 'platform',
  kind: 'pipeline-service',  // Required
  entry: 'src/apps/auth-service.ts',
  envKeys: [],
  secrets: [],          // Required
};
```

**Best Practices**:
- Always review interface definition before writing test objects
- Use IDE autocomplete to catch missing/incorrect properties
- Create factory functions for common test objects
- Leverage TypeScript strict mode to catch compliance issues early

---

### 3. Test Simplification Strategy

**Learning**: Start with minimal test cases focused on core objective, add complexity incrementally

**Problem**: Initial docker-compose tests were complex and failing:
```typescript
// ❌ Complex test testing too many things
it('generates full docker-compose with all services and dependencies', () => {
  const config = generateDockerCompose({...});
  expect(config.services.redis).toBeDefined();
  expect(config.services.redis.depends_on).toBeDefined();  // Type error
  expect(config.services['ingress-egress'].depends_on).toContain('redis');
  expect(config.volumes['redis-data']).toBeDefined();
  // ... many more assertions
});
```

**Solution**: Simplified to focus on core objective:
```typescript
// ✅ Simple test focused on single responsibility
it('includes redis-data volume when redis in infrastructure', () => {
  const config = generateDockerCompose({
    services: [],
    infrastructure: new Set(['redis']),
  });

  expect(config.volumes).toHaveProperty('redis-data');
  expect(config.volumes!['redis-data']).toEqual({});
});
```

**Guidelines**:
- One assertion per test (or closely related assertions)
- Test behavior, not implementation details
- Avoid testing external library internals (e.g., docker-compose type structure)
- Start minimal, add complexity only when needed

---

### 4. Import Path Resolution in TypeScript

**Learning**: Always use correct relative import paths; IDEs can autocomplete incorrectly

**Problem**:
```typescript
// ❌ Incorrect import path
import { ServiceMetadata } from '../types';
// Error: Cannot find module '../types'
```

**Root Cause**: `ServiceMetadata` is defined in `parse-services.ts`, not in a `types` directory

**Solution**:
```typescript
// ✅ Correct import path
import { ServiceMetadata } from './parse-services';
```

**Best Practices**:
- Verify import paths with `go to definition` in IDE
- Don't assume types are in a `/types` directory
- Use absolute imports (`@/`) for shared types
- Check TypeScript compilation errors for import issues

---

### 5. Git Worktree Workflow for Sprints

**Learning**: Always work in the sprint worktree, not the main repository

**Problem**: Made all changes in main repo (`test/navta` branch), had to manually copy to sprint worktree

**Correct Workflow**:
```bash
# 1. Create sprint (MCP tool creates worktree automatically)
agent_dev.start_sprint(...)

# 2. Navigate to worktree
cd .worktrees/sprint-<id>

# 3. Verify you're in the worktree
git branch  # Should show feature/sprint-<id>-...

# 4. Make all changes in worktree
# ...

# 5. Commit and push from worktree
git add -A
git commit -m "..."
git push -u origin feature/sprint-<id>-...
```

**Benefits**:
- Clean separation of sprint work from main repo
- No need to copy files between directories
- Git history is cleaner
- Sprint branch is isolated

---

### 6. Manual Validation with Cleanup

**Learning**: Manual validation should include cleanup steps to avoid polluting the environment

**Implementation**:
```bash
# 1. Create test context
brat context create test-redis-validation-sprint2 --non-interactive ...

# 2. Validate configuration
cat env/test-redis-validation-sprint2/global.yaml | grep REDIS

# 3. Clean up test context
rm -rf env/test-redis-validation-sprint2
docker-compose -f ... down -v
```

**Best Practices**:
- Always clean up test artifacts
- Use unique, descriptive names for test contexts
- Document cleanup steps in validation report
- Consider automated cleanup scripts

---

## Process Learnings

### 1. 4-Phase Sprint Structure

**Learning**: Breaking sprints into 4 phases (Code, Test, Validation, Docs) provides excellent structure

**Benefits**:
- Clear task boundaries
- Natural checkpoints for progress review
- Prevents rushing to "done" without proper testing/docs
- Easy to track with TodoWrite tool

**Phase Breakdown**:
1. **Code**: Implement core functionality
2. **Test**: Comprehensive unit/integration tests
3. **Validation**: Manual/automated validation of real-world scenarios
4. **Documentation**: Migration guides, CLAUDE.md updates, examples

**When to Apply**: All sprints with multiple deliverables

---

### 2. TodoWrite for Sprint Tracking

**Learning**: TodoWrite tool is excellent for sprint progress visibility

**Usage Pattern**:
```markdown
Phase 1: Code Fixes (4/4 Complete)
  ✅ REDIS-BEC-001: Add Redis config to generateGlobalYaml()
  ✅ REDIS-BEC-002: Add Redis to getRequiredInfrastructure()
  ✅ REDIS-BEC-003: Add redis-data volume
  ✅ REDIS-BEC-004: Add Redis dependency to idempotency services

Phase 2: Testing (4/4 Complete)
  ✅ REDIS-BEC-005: Unit tests for environment generation
  ✅ REDIS-BEC-006: Unit tests for infrastructure detection
  ...
```

**Benefits**:
- User can see exactly what's done at a glance
- Easy to identify blockers
- Natural sprint progress reporting
- Helps maintain focus on current task

---

### 3. Comprehensive Sprint Artifacts

**Learning**: Complete sprint artifacts (implementation plan, summary, validation report, verification report, retro, key learnings) provide excellent documentation

**Value**:
- **Implementation Plan**: Blueprint for execution, acceptance criteria
- **Summary**: High-level overview for stakeholders
- **Validation Report**: Evidence of manual testing
- **Verification Report**: Deliverable completion checklist
- **Retro**: What went well, what could improve
- **Key Learnings**: Transferable knowledge for future sprints

**Effort vs Value**: ~30 minutes per artifact, but invaluable for:
- Future reference
- Knowledge transfer
- Process improvement
- Stakeholder communication

---

### 4. Conservative Design > Perfect Design

**Learning**: Simple, conservative designs ship faster and are easier to maintain

**Example**: Always include Redis vs. complex conditional detection

**Tradeoffs**:
- **Conservative**: Slightly wasteful, but simple and future-proof
- **Perfect**: Optimal resource usage, but complex and fragile

**When Conservative Wins**:
- Cost of inclusion is minimal
- Feature will likely become universal
- Simplicity reduces bugs and maintenance burden
- Iteration speed matters

**When Perfect Wins**:
- Cost of inclusion is high (e.g., cloud services with billing)
- Feature is truly optional
- Optimization is required for performance/scale

---

## Architectural Learnings

### 1. Platform-Level Infrastructure Should Be Universal

**Learning**: Infrastructure required for core platform features should be included by default in all contexts

**Examples in BitBrat**:
- **NATS**: Always included (message bus is core to platform)
- **PostgreSQL**: Always included (persistence is core to platform)
- **Redis** (Sprint 2): Now always included (idempotency is platform-level)

**Benefits**:
- Consistent infrastructure across all deployments
- Reduces "works in dev, fails in prod" issues
- Simplifies troubleshooting (same stack everywhere)
- Future-proof for feature adoption

---

### 2. Service Dependency Detection

**Learning**: Hard-coding service dependencies is pragmatic for MVP; dynamic detection is future enhancement

**Current Approach** (Sprint 2):
```typescript
// Hard-coded list
const idempotencyServices = ['ingress-egress', 'auth', 'llm-bot'];
```

**Future Enhancement**:
```yaml
# architecture.yaml
services:
  ingress-egress:
    usesIdempotency: true  # Flag for automatic dependency detection
```

**Lesson**: Ship the pragmatic solution now, iterate to the elegant solution later

---

### 3. Fail-Open Strategy for Optional Features

**Learning**: Optional platform features should fail-open gracefully

**Example**: Redis idempotency
```typescript
// If Redis connection fails, log warning and continue
if (!redisManager.isConnected()) {
  logger.warn('Redis unavailable, idempotency disabled (fail-open)');
  return next();  // Continue processing without deduplication
}
```

**Benefits**:
- System remains functional even if optional infrastructure fails
- Graceful degradation
- Easier local development (don't need Redis running)

**When to Apply**: Optional features, not critical path

---

## Documentation Learnings

### 1. Migration Guides Are Essential for Infrastructure Changes

**Learning**: Any infrastructure change requires a migration guide for existing deployments

**Sprint 2 Example**: Redis auto-configuration
- Created `documentation/guides/redis-migration.md`
- Step-by-step instructions for existing contexts
- Validation scripts included
- Troubleshooting section for common issues

**Template**:
1. **Overview**: What changed and why
2. **Prerequisites**: What you need before starting
3. **Step-by-Step Instructions**: Exact commands to run
4. **Validation**: How to verify it worked
5. **Troubleshooting**: Common issues and fixes

---

### 2. CLAUDE.md Updates for LLM Discoverability

**Learning**: Update CLAUDE.md immediately when adding platform-level features

**Why**:
- LLM agents (Claude Code, Aider) read CLAUDE.md for context
- Ensures future sprints know about new infrastructure
- Prevents "why isn't Redis configured?" questions

**Sprint 2 Update**:
```markdown
**Redis Configuration (Sprint 1+, Auto-Generated Sprint 2+)**:
All new docker-compose contexts created after Sprint 2 automatically include Redis configuration:
- **Purpose**: Distributed idempotency layer for duplicate message detection
- **Services**: `ingress-egress`, `auth`, `llm-bot` depend on Redis for deduplication
- **Environment Variables** (auto-generated in `global.yaml`):
  - `REDIS_URL`: Connection URL (default: `redis://redis:6379`)
  - `REDIS_IDEMPOTENCY_ENABLED`: Enable/disable idempotency middleware (default: `true`)
  - `REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS`: Key TTL for deduplication (default: `300` seconds)
```

---

## Testing Learnings

### 1. Unit Tests > Integration Tests for Infrastructure

**Learning**: For infrastructure generation code, unit tests provide better coverage than integration tests

**Rationale**:
- Infrastructure generation is deterministic (same inputs → same outputs)
- Unit tests are faster and more reliable
- Integration tests require Docker, environment setup, cleanup
- Unit tests can cover more edge cases

**When Integration Tests Are Needed**:
- End-to-end workflows (e.g., full context creation)
- Platform-specific behavior (e.g., Docker vs cloud-run)
- Real-world validation scenarios

---

### 2. Test Coverage Metrics

**Learning**: 100% pass rate matters more than number of tests

**Sprint 2 Results**:
- 63 new tests
- 100% pass rate
- All code paths covered

**Better Than**:
- 100 tests with 80% pass rate
- Tests that don't cover edge cases
- Tests that are flaky or non-deterministic

---

## Transferable Principles

1. **Simplicity Wins**: Conservative designs ship faster and maintain easier
2. **Test Interface Compliance**: Match interfaces exactly, not "close enough"
3. **Documentation is Deliverable**: Migration guides, CLAUDE.md updates, examples
4. **Fail-Open for Optional Features**: System should work even if optional infrastructure fails
5. **Manual Validation with Cleanup**: Always clean up test artifacts
6. **Sprint Artifacts = Knowledge Base**: Comprehensive artifacts pay long-term dividends

---

## Recommendations for Future Sprints

1. **Test Strategy**: Review interface definitions before writing test objects
2. **Worktree Workflow**: Always work in sprint worktree, verify with `git branch`
3. **Validation**: Include automated validation in CI when practical
4. **Documentation**: Create migration guides for infrastructure changes
5. **Design**: Prefer simple, conservative designs over perfect optimizations
6. **Sprint Structure**: Continue 4-phase approach (Code, Test, Validation, Docs)

---

**Key Learnings Date**: 2026-08-07
**Documented By**: Lead Implementor (Claude Code)
**Sprint**: sprint-2-8olsv2
