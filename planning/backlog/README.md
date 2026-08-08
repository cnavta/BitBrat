# BitBrat Backlog

This directory contains provisional execution plans and prioritized task backlogs for future work identified during sprint execution.

## Current Backlogs

### Redis BEC Generation Gaps (Post-Sprint 1)

**Status**: Provisional
**Priority**: High
**Created**: 2026-08-07

**Documents**:
- **[Execution Plan](./redis-bec-generation-gaps-execution-plan.md)** - Comprehensive analysis, solution architecture, and implementation approach
- **[YAML Backlog](./redis-bec-generation-gaps-backlog.yaml)** - Prioritized, trackable tasks with dependencies and acceptance criteria

**Summary**:
Sprint 1 successfully implemented Redis-based distributed idempotency for existing contexts (local, staging). However, the BEC generation tooling does not automatically configure Redis when new contexts are created via `brat context create` or `agent_dev.provision()`.

**Impact**: New execution contexts will be missing Redis entirely, causing idempotency layer to fail-open (no duplicate detection).

**Estimated Effort**: 7-9.5 hours (1.5 days)

**Quick Start**:
```bash
# Review execution plan
cat planning/backlog/redis-bec-generation-gaps-execution-plan.md

# Review task breakdown
cat planning/backlog/redis-bec-generation-gaps-backlog.yaml

# Convert to sprint
# Option 1: Single sprint (all 13 tasks)
# Option 2: Two sprints (Code+Tests, then Validation+Docs)
```

---

## Backlog Format

Each backlog should include:

1. **Execution Plan** (Markdown)
   - Problem statement and impact analysis
   - Root cause analysis
   - Solution architecture
   - Implementation scope
   - Acceptance criteria
   - Risk assessment
   - Testing strategy
   - Timeline estimate

2. **Task Backlog** (YAML)
   - Prioritized, trackable tasks
   - Dependencies graph
   - Estimated effort per task
   - File locations and code changes
   - Acceptance criteria per task
   - Testing requirements
   - Phase organization

## Usage

### For Sprint Planning

1. Review execution plan for context
2. Import YAML backlog into sprint tracking
3. Adjust priorities based on current needs
4. Create sprint from selected tasks
5. Generate sprint artifacts (implementation-plan.md, etc.)

### For GitHub Issues

Use the GitHub issue template included in the YAML backlog:

```yaml
github_issue_template: |
  # Redis BEC Generation Gaps
  [Issue content...]
```

### For Task Tracking

YAML tasks include:
- Unique IDs (REDIS-BEC-001, etc.)
- Priority levels (critical, high, medium, low)
- Phase organization (1-4)
- Dependencies (prerequisite tasks)
- Estimated effort (minutes/hours)
- File locations
- Acceptance criteria
- Testing requirements

---

## Contributing

When adding new backlogs:

1. Create execution plan: `<name>-execution-plan.md`
2. Create YAML backlog: `<name>-backlog.yaml`
3. Update this README with summary
4. Link to related sprints/issues
5. Provide quick start instructions
