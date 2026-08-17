# Key Learnings: sprint-17-btnxhl

**Sprint**: obs-mcp Deployment Fix
**Date**: 2026-08-17

## Critical Insights

### 1. Docker Compose Handles Build vs Image Natively

**Learning**: Docker Compose automatically distinguishes between services that need building (`build:` section) and services that need pulling (`image:` only). The platform doesn't need to filter - Docker Compose does it automatically.

**Impact**: Removing unnecessary filtering logic simplifies code and prevents bugs.

**Application**: Trust existing tools to do what they're designed to do. Don't add layers of abstraction unless necessary.

### 2. Variable Names Must Match Semantics

**Learning**: The variable `buildableServices` was semantically incorrect. Not all services that need to start require building. Renaming to `servicesToStart` improved code clarity.

**Impact**: Future developers will better understand the code's intent.

**Application**: During code review, check that variable names accurately describe their purpose.

### 3. Image-Only Services Are a Valid Pattern

**Learning**: Pre-built images from container registries (like Google Artifact Registry) are a legitimate deployment pattern. obs-mcp uses this pattern successfully.

**Impact**: Platform can support heterogeneous service deployment strategies.

**Application**: Document this pattern in extending-bitbrat.md for future service development.

## Technical Patterns

### Deployment Orchestration Best Practices

**Pattern**: Include ALL services from merged compose file, let Docker Compose handle specifics

**Anti-Pattern**: Filter services based on build section (excludes valid image-only services)

**Code Location**: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:1180-1214`

### Service Configuration Flexibility

**Pattern**: Support both locally-built services (`entry:` + `build:`) and pre-built services (`image:`)

**Example**:
```yaml
# Locally built service
llm-bot:
  entry: src/apps/llm-bot-service.ts
  # Build Dockerfile.service with SERVICE_NAME=llm-bot

# Pre-built service
obs-mcp:
  image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
  # Pull from registry, no local build
```

## Process Improvements

### 1. Sprint Artifact Naming

**Learning**: Sprint completion validation expects specific file names: `retro.md`, `key-learnings.md`

**Action**: Follow naming conventions to avoid completion issues

### 2. Test Artifact Cleanup

**Learning**: Legacy test hooks from previous sprints can block deployment testing

**Action**: Add cleanup phase to sprint protocol for test artifacts

### 3. Documentation-First Approach

**Learning**: Writing implementation plan before coding clarified thinking and improved solution quality

**Action**: Continue this practice for all non-trivial fixes

## Code Quality Insights

### Minimal Changes Are Best

**Metric**: Only 27 lines changed across 2 files
**Result**: Low risk, easy to review, simple to understand

**Lesson**: Resist the temptation to refactor unrelated code. Stay focused on the specific issue.

### Comments Add Value

**Before**: Limited comments explaining filtering logic
**After**: Detailed comments explaining:
- What the fix does
- Why it was needed
- What the old behavior was
- How Docker Compose handles the distinction

**Lesson**: Inline documentation helps future developers (including yourself) understand non-obvious decisions.

## Deployment Architecture

### Compose File Merging

**Learning**: The platform merges multiple compose files:
1. Base infrastructure (docker-compose.local.yaml)
2. Service-specific files (services/*.compose.yaml)
3. Secure files injected via volume mounts

**Impact**: Service-specific compose files can define image-only services without build sections.

**Application**: This pattern enables external/third-party service integration.

## Future Considerations

### 1. Integration Testing Gap

**Observation**: No automated tests verify image-only service deployments work correctly

**Risk**: Future refactoring could reintroduce this bug

**Recommendation**: Add integration test that:
- Defines a minimal image-only service
- Runs `brat bit deploy --all`
- Verifies service appears in started containers

### 2. Service Pattern Documentation

**Observation**: Pre-built image pattern not documented in extending-bitbrat.md

**Risk**: Developers may not know this pattern is supported

**Recommendation**: Document pattern with examples:
- When to use pre-built images vs local builds
- How to configure image-only services
- Registry authentication and image pulling

### 3. Deployment Validation

**Observation**: Deployment config issues only discovered at deployment time

**Opportunity**: Create `brat bit validate` command to catch issues earlier

**Features**:
- Validate all services have required fields
- Check image URLs are accessible
- Verify build contexts exist
- Validate service dependencies

## Metrics

| Metric | Value | Insight |
|--------|-------|---------|
| Time to diagnose | 15 min | Clear logs enabled fast diagnosis |
| Time to fix | 15 min | Minimal, focused change |
| Time to document | 30 min | Comprehensive documentation |
| Risk level | Low | Backward-compatible, trusted tool |
| Lines changed | 27 | Simple, targeted fix |
| Files modified | 2 | Minimal scope |

## Conclusion

The key learning from Sprint 17 is: **trust existing tools and remove unnecessary abstraction**. Docker Compose already knows how to handle both build and image services. By removing the filtering logic and letting Docker Compose do its job, we fixed the bug and simplified the codebase.

**Most Valuable Insight**: Variable names matter. `buildableServices` implied "services that need building," but the actual purpose was "services to start." This semantic mismatch created the bug. Precise naming prevents bugs.

**Actionable Takeaway**: When encountering complex filtering logic, ask: "Is this necessary, or is the underlying tool (Docker Compose, orchestrator, etc.) already handling this?"

---

**Key Learnings compiled**: 2026-08-17
**Sprint**: sprint-17-btnxhl
**Implementor**: Claude Code
