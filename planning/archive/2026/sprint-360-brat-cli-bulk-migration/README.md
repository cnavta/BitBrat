# Sprint 360: Brat CLI Bulk Migration
## Context, Fleet, and Config Command Families

**Status**: 🏗️ Ready to Start
**Foundation Sprint**: [Sprint 359](../sprint-359-brat-cli-reorganization/) ✅ Complete
**Sprint Protocol**: v3
**Estimated Duration**: 3-4 days (25 hours)

---

## Quick Summary

Sprint 360 continues the oclif migration by completing **three entire command families**:

1. **Context Commands** (6 commands) - Execution context management
2. **Fleet Commands** (7 commands) - Complete fleet control plane
3. **Config Commands** (1 command) - Configuration validation

**Total**: 14 commands migrated with full test coverage.

---

## Foundation from Sprint 359

Sprint 359 successfully established:
- ✅ **BratCommand base class** - Logging, context resolution, dependency injection
- ✅ **5 PoC commands** - setup, doctor, fleet list, config show, release
- ✅ **All migration patterns** - 5 patterns documented and validated
- ✅ **Testing framework** - @oclif/test integration
- ✅ **Build system** - oclif configuration and compilation

**Sprint 359 Deliverables** (100% complete):
- 5 commands migrated
- 6 test files with 90 test cases
- 7 documentation files
- All patterns demonstrated

---

## Sprint 360 Objectives

### Primary Goals (P0)

| ID | Objective | Target |
|----|-----------|--------|
| OBJ-1 | Context family complete | 6/6 commands |
| OBJ-2 | Fleet family complete | 7/7 commands |
| OBJ-3 | Config validate migrated | 1/1 commands |
| OBJ-4 | Zero regressions | 100% tests pass |
| OBJ-5 | Help text polished | All commands have examples |

### Secondary Goals (P1)

- Test coverage ≥80%
- Performance validated (no regression)
- Documentation updated

---

## Phase Overview

### Phase 0: Planning & Setup (4 hours)
- Read all source implementations
- Identify shared business logic
- Validate BratCommand base class
- Review Sprint 359 lessons learned

### Phase 1: Context Commands (8 hours)
- [ ] `context list` - List all execution contexts
- [ ] `context show` - Display context configuration
- [ ] `context create` - Create new execution context
- [ ] `context validate` - Validate context configuration
- [ ] `use` - Switch to different context
- [ ] `current` - Show current context

### Phase 2: Fleet Commands (10 hours)
- [ ] `fleet info` - Get bit.info from Bits
- [ ] `fleet health` - Get bit.health from specific Bit
- [ ] `fleet config` - View effective config
- [ ] `fleet flags get` - Inspect feature flag
- [ ] `fleet flags set` - Toggle feature flag
- [ ] `fleet log` - Change runtime log level
- [ ] `fleet drain` - Graceful drain Bit
- [ ] `fleet shutdown` - Shutdown Bit

### Phase 3: Config Validate (1 hour)
- [ ] `config validate` - Validate architecture.yaml

### Phase 4: Testing & Validation (6 hours)
- Unit tests for all 14 commands
- Integration tests (context + fleet workflows)
- Performance benchmarking
- Regression testing

### Phase 5: Documentation & Review (2 hours)
- Update migration guide
- Update CLAUDE.md
- Polish help text
- Sprint retrospective

---

## Key Files

### Planning Documents
- **[execution-plan.md](./execution-plan.md)** - Detailed phase-by-phase plan
- **[backlog.yaml](./backlog.yaml)** - Prioritized task backlog with estimates
- **README.md** (this file) - Sprint overview

### Reference from Sprint 359
- [Sprint 359 Execution Plan](../sprint-359-brat-cli-reorganization/execution-plan.md)
- [oclif Migration Guide](../sprint-359-brat-cli-reorganization/oclif-migration-guide.md)
- [Framework Evaluation](../sprint-359-brat-cli-reorganization/framework-evaluation.md)
- [Verification Report](../sprint-359-brat-cli-reorganization/verification-report.md)

---

## Command Migration Status

### Completed (Sprint 359)
- [x] `setup` - Interactive platform setup
- [x] `doctor` - System diagnostics
- [x] `fleet list` - List all Bits
- [x] `config show` - Display configuration
- [x] `release` - Version management

### Sprint 360 Target (14 commands)

**Context Family** (6):
- [ ] context list
- [ ] context show
- [ ] context create
- [ ] context validate
- [ ] use
- [ ] current

**Fleet Family** (7):
- [ ] fleet info
- [ ] fleet health
- [ ] fleet config
- [ ] fleet flags get
- [ ] fleet flags set
- [ ] fleet log
- [ ] fleet drain
- [ ] fleet shutdown

**Config Family** (1):
- [ ] config validate

### Remaining (Future Sprints)
- Data/Migration commands (8 commands)
- Deploy commands (3 commands)
- Infra commands (5 commands)
- Dev commands (3 commands)
- Bit commands (1 command)
- Trigger commands (1 command)

**Total Remaining**: 21 commands

---

## Quick Start

### Prerequisites
1. Sprint 359 complete and verified
2. All Sprint 359 tests passing
3. Local development environment ready

### Validation
```bash
# Verify Sprint 359 foundation
npm run build
npm test -- tools/brat/src/oclif-commands

# Test Sprint 359 commands
./node dist/tools/brat/src/oclif-entry.js setup --help
./node dist/tools/brat/src/oclif-entry.js doctor
./node dist/tools/brat/src/oclif-entry.js fleet list
./node dist/tools/brat/src/oclif-entry.js config show
./node dist/tools/brat/src/oclif-entry.js release --help
```

### Start Sprint 360
```bash
# Read planning documents
cat planning/sprint-360-brat-cli-bulk-migration/execution-plan.md
cat planning/sprint-360-brat-cli-bulk-migration/backlog.yaml

# Review Sprint 359 lessons learned
cat planning/sprint-359-brat-cli-reorganization/retro.md
cat planning/sprint-359-brat-cli-reorganization/key-learnings.md

# Begin Phase 0: Planning
# See execution-plan.md for detailed tasks
```

---

## Success Criteria

### Code
- [ ] All 14 commands migrated to oclif
- [ ] All commands follow BratCommand patterns
- [ ] All commands have help text with examples
- [ ] Zero regressions (all existing tests pass)
- [ ] New tests written (≥80% coverage)

### Documentation
- [ ] Migration guide updated with bulk migration learnings
- [ ] CLAUDE.md updated with new command examples
- [ ] Help text polished for all commands

### Validation
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual E2E testing successful
- [ ] Performance benchmarks met (startup < 200ms, help < 50ms)
- [ ] Code reviewed

### Process
- [ ] Sprint retrospective completed
- [ ] Learnings documented
- [ ] Backlog updated for Sprint 361

---

## Time Estimates

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| Phase 0: Planning | 6 tasks | 4 hours |
| Phase 1: Context | 6 commands | 8 hours |
| Phase 2: Fleet | 7 commands + 2 subcommands | 10 hours |
| Phase 3: Config | 1 command | 1 hour |
| Phase 4: Testing | 7 tasks | 6 hours |
| Phase 5: Documentation | 4 tasks | 2 hours |
| **Total** | **31 tasks** | **25 hours** |

**Duration**: 3-4 days at 6-8 hours/day

---

## Migration Patterns (from Sprint 359)

### Pattern 1: Simple Validation
**Examples**: doctor, context validate, config validate
```typescript
export default class Validate extends BratCommand {
  static args = {}
  static flags = { json: Flags.boolean() }

  async run(): Promise<void> {
    // Validation logic
    // Exit code 0 on success, 1 on failure
  }
}
```

### Pattern 2: Config Display with Smart Redaction
**Examples**: config show, context show
```typescript
export default class Show extends BratCommand {
  static flags = { raw: Flags.boolean() }

  async run(): Promise<void> {
    // Load config
    // Apply smart redaction (unless --raw)
    // Output YAML/JSON
  }
}
```

### Pattern 3: Fleet with Dependency Injection
**Examples**: fleet list, fleet info, fleet health, fleet config
```typescript
export default class FleetCommand extends BratCommand {
  private fleetDeps?: FleetDeps

  protected getFleetDeps(overrides?: Partial<FleetDeps>): FleetDeps {
    if (overrides) this.fleetDeps = { ...this.fleetDeps, ...overrides }
    return this.fleetDeps || this.createDefaultDeps()
  }

  async run(): Promise<void> {
    const deps = this.getFleetDeps()
    const client = new FleetClient(deps)
    // Use client
  }
}
```

### Pattern 4: Complex Orchestration
**Examples**: release, context create
```typescript
export default class Orchestrate extends BratCommand {
  async run(): Promise<void> {
    // Multi-step workflow
    // Validation → Execution → Confirmation
    // Transaction-like semantics
  }
}
```

### Pattern 5: Interactive Wizard
**Examples**: setup, context create
```typescript
export default class Interactive extends BratCommand {
  static flags = {
    'non-interactive': Flags.boolean(),
    // ... other flags
  }

  async run(): Promise<void> {
    if (flags['non-interactive']) {
      // Use flags
    } else {
      // Use inquirer prompts
    }
  }
}
```

---

## Next Sprint Preview (Sprint 361)

Sprint 361 will migrate:
1. **Data/Migration Commands** (8 commands)
   - data backup list/export/import
   - data migrate collection/all/tokens/api-tokens
   - data seed
   - data validate

2. **Deploy Commands** (3 commands)
   - deploy services/service
   - deploy docker up/down/logs/ps

3. **Infra Commands** (5 commands)
   - infra plan/apply
   - apis enable
   - cloud-run shutdown
   - lb urlmap render/import

**Estimated**: 16 commands (~2 sprints)

---

## Resources

### Documentation
- [oclif Documentation](https://oclif.io/docs/introduction)
- [Sprint Protocol v3](../../AGENTS.md)
- [BitBrat Architecture](../../architecture.yaml)
- [CLAUDE.md Guidance](../../CLAUDE.md)

### Tools
- **@oclif/core** - Framework foundation
- **@oclif/test** - Testing utilities
- **inquirer** - Interactive prompts
- **pino** - Structured logging
- **js-yaml** - YAML parsing

---

**Sprint 360**: Ready to Start 🚀

**Lead Implementor**: AI Agent
**Created**: 2026-07-24
**Last Updated**: 2026-07-24
