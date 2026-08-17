# Sprint 349: Environment Unification

**Status**: Planning Complete - Ready for Approval
**Start Date**: 2026-07-19
**Estimated Duration**: 12 days (2.4 weeks)
**Lead Implementor**: Claude Code

---

## Overview

This sprint implements the Environment Unification proposal (documentation/architecture/environment-unification-proposal.md), which addresses critical user experience and architectural issues in BitBrat's environment management.

### Core Problems Being Solved

1. **Flag Confusion**: `--env` vs `--target` inconsistency across commands
2. **Discovery Fragmentation**: Gateway URLs, ports, persistence config scattered across codebase
3. **Manual Environment Setup**: Error-prone YAML editing to add new environments
4. **Redundant Configuration**: `deploymentTargets.*.env` duplicates key names
5. **Inconsistent Resolution**: Each command implements its own environment discovery logic

### Solution: Execution Contexts

- **Single source of truth**: `architecture.yaml` → `executionContexts`
- **Unified CLI flag**: `--context` (replaces `--env` and `--target`)
- **Primary workflow**: `brat use <context>` sets current context in `~/.bratrc`
- **Auto-discovery**: Gateway URLs, ports, persistence automatically resolved
- **Self-service**: `brat context create` for new environments
- **Comprehensive validation**: `brat context validate/ping` for health checks

---

## Sprint Artifacts

### Planning Documents

- **[execution-plan.md](./execution-plan.md)** - Comprehensive execution plan with 5 phases
- **[backlog.yaml](./backlog.yaml)** - Trackable prioritized backlog (42 tasks, 103 hours)
- **[README.md](./README.md)** - This file (sprint summary)

### Deliverables Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| **Phase 1: Schema & Core** | 2 days | ExecutionContextSchema, migration tool, updated architecture.yaml |
| **Phase 2: ContextResolver** | 2 days | ContextResolver class, auto-discovery, ~/.bratrc support |
| **Phase 3: CLI Unification** | 3 days | All commands use --context, brat use/current implemented |
| **Phase 4: Context Management** | 3 days | brat context CRUD, validate/ping commands |
| **Phase 5: Documentation** | 2 days | CLAUDE.md, migration guide, tutorial, CHANGELOG |

---

## Task Breakdown

### By Priority

- **P0 (Critical)**: 25 tasks - Must complete for sprint success
- **P1 (Important)**: 16 tasks - Should complete (not blocking)
- **P2 (Nice-to-have)**: 1 task - Can defer to Sprint 350

### By Phase

- **Phase 1**: 5 tasks (11 hours)
- **Phase 2**: 7 tasks (25 hours)
- **Phase 3**: 10 tasks (24 hours)
- **Phase 4**: 6 tasks (18 hours)
- **Phase 5**: 9 tasks (16 hours)
- **Testing**: 3 tasks (8 hours)

**Total**: 42 tasks, 103 estimated hours (~13 days with buffer)

---

## Primary User Workflow (After Sprint 349)

### Before (Current State)

```bash
# Confusing: --env vs --target
brat deploy service llm-bot --env staging        # Uses --env
brat docker up --target staging                  # Uses --target
brat chat --env staging --message "!ping"        # Accepts both (confusing!)

# Manual environment setup
# 1. Edit architecture.yaml manually
# 2. Add deploymentTargets.new-env block
# 3. Copy/paste from existing environment
# 4. Hope you didn't make YAML errors
```

### After (Sprint 349)

```bash
# PRIMARY WORKFLOW: Set context once, all commands use it
brat use staging                      # Set current context (persists in ~/.bratrc)
brat deploy service llm-bot           # Uses staging (from ~/.bratrc)
brat docker up                        # Uses staging
brat chat --message "!ping"           # Uses staging
brat fleet list                       # Uses staging

# Check current context
brat current                          # → staging (from ~/.bratrc)

# Quick override without changing current
brat fleet list --context prod        # Temporarily use prod
brat current                          # → Still staging

# Self-service environment creation
brat context create llm-test \
  --type docker-compose \
  --docker-host ssh://root@llm-test.local \
  --gateway-url http://llm-test.local:3017 \
  --persistence postgres \
  --db-host llm-test.local

# Validate before deploying
brat context validate llm-test        # Check schema, secrets, connectivity
brat context ping llm-test            # Test Docker, gateway, database
```

---

## Key Technical Changes

### New Components

1. **ExecutionContext Schema** (Zod)
   - File: `tools/brat/src/config/execution-context-schema.ts`
   - Comprehensive schema for all deployment types (docker-compose, cloud-run, k8s)
   - Runtime config (gateway, persistence, envOverlay)

2. **ContextResolver** (Centralized Resolution)
   - File: `tools/brat/src/context/context-resolver.ts`
   - Single resolution point for all commands
   - Auto-discovery: gateway URLs, persistence config
   - Environment overlay merging
   - Context name resolution priority: `--context` > `$BITBRAT_CONTEXT` > `~/.bratrc` > 'local'

3. **~/.bratrc Support** (User Config)
   - Stores current context (set by `brat use`)
   - Preferences, history
   - Per-user file (works on multi-user systems)

4. **Context Management Commands**
   - `brat use <context>` - Set current context (PRIMARY WORKFLOW)
   - `brat current` - Show current context
   - `brat context list` - List all contexts
   - `brat context show <name>` - Display context config
   - `brat context create <name>` - Create new context
   - `brat context delete <name>` - Delete context
   - `brat context validate <name>` - Validate config
   - `brat context ping <name>` - Test connectivity

### Updated Components

- **All CLI commands**: Use `ContextResolver` instead of custom discovery logic
- **architecture.yaml**: Add `executionContexts` section (deprecate `deploymentTargets`)
- **Global flags**: Add `--context` (deprecate `--env` and `--target`)

---

## Backward Compatibility

### Deprecation Timeline

- **Sprint 349** (this sprint): Both `executionContexts` and `deploymentTargets` work
- **Sprint 350-352**: Deprecation warnings increase, encourage migration
- **Sprint 353**: Remove `deploymentTargets`, `--env`, `--target` flags

### Migration Path

1. **Automatic migration tool**: `brat migrate-contexts`
   - Converts `deploymentTargets` → `executionContexts`
   - Preserves original config (commented)
   - Dry-run mode for validation

2. **Backward compatibility layer**
   - `--env <name>` → `--context <name>` (warn)
   - `--target <name>` → `--context <name>` (warn)
   - Warning: "⚠️  --env is deprecated and will be removed in Sprint 353. Use --context or 'brat use <context>'"

---

## Success Metrics

### Sprint 349 Completion Criteria (Must Have)

- ✅ ExecutionContextSchema validated by architecture.yaml parser
- ✅ ContextResolver.resolve() working for all contexts
- ✅ `brat use` and `brat current` implemented
- ✅ All existing commands use ContextResolver (no custom discovery)
- ✅ `brat context list/show/create` working
- ✅ Backward compatibility layer active (deploymentTargets still works)
- ✅ Migration tool: `brat migrate-contexts` functional
- ✅ Documentation: CLAUDE.md, migration guide, tutorial
- ✅ All tests passing (unit + integration)

### Adoption Metrics (Sprint 350+)

- 90%+ of team using `brat use` workflow by Sprint 353
- 0 usage of `--env`/`--target` flags by Sprint 353
- 3+ custom contexts created (llm-test, demo, etc.)
- Zero confusion-related support tickets

---

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking existing deployments | High | Medium | Backward compatibility (3-sprint deprecation), migration tool, testing |
| Auto-discovery edge cases | Medium | Medium | Explicit URL overrides, fallback logic, clear errors |
| Performance regression | Low | Low | Cache resolved contexts per invocation |
| Migration tool bugs | High | Medium | Dry-run mode, preserve original config, rollback plan |
| User adoption resistance | Medium | Medium | Documentation, migration guide, demo video |

**Rollback Plan**: Keep `deploymentTargets` commented in architecture.yaml. If critical issues, uncomment and rollback code.

---

## Dependencies

- **External**: None - All changes internal to BitBrat
- **Internal**: EnvironmentResolver (reuse for env overlays, already exists)
- **Blocked By**: None - Can start immediately
- **Blocks**: None - Other work can proceed in parallel

---

## Next Steps

1. **Review execution plan and backlog** with team/user
2. **Approve for implementation** or request changes
3. **Start Phase 1** (Schema & Core Infrastructure)
4. **Create request-log.md** to track all prompts/actions during implementation
5. **Create validation script** to verify deliverables

---

## Questions for User

Before starting implementation:

1. **Approve sprint scope?** Is the 5-phase plan acceptable?
2. **Approve timeline?** 12 days (2.4 weeks) reasonable?
3. **Approve backward compatibility approach?** 3-sprint deprecation period acceptable?
4. **Any additional requirements?** Features not covered in proposal?
5. **Ready to start?** Should I begin Phase 1 implementation?

---

## Contact

- **Lead Implementor**: Claude Code (Lead Implementor role)
- **Sprint Protocol**: AGENTS.md (rigorous sprint workflow)
- **Reference**: documentation/architecture/environment-unification-proposal.md

---

**Status**: ✅ Planning Complete - Awaiting Approval
