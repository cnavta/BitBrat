# Sprint 359: Brat CLI Reorganization - oclif Migration Foundation

**Status**: Planning Complete
**Start Date**: TBD
**Duration**: 7 working days (1 sprint)
**Goal**: Establish oclif foundation with working PoC of 5 commands, preserving critical patterns

## Overview

This sprint addresses the chaotic organization of the brat CLI tool by migrating it to the [oclif (Open CLI Framework)](https://oclif.io/) framework. The current implementation has 30+ commands with no coherent organization, inconsistent help text, and manual argument parsing. The oclif migration will provide:

- **Domain-driven command organization** (infra, deploy, data, fleet, dev)
- **Auto-generated help text** from command metadata
- **Type-safe flag validation** with oclif decorators
- **Plugin architecture** for future extensibility
- **Backward compatibility** via deprecation hooks

This sprint focuses on establishing the **foundation** — infrastructure setup, base command pattern, and proof-of-concept migration of 5 representative commands. Full migration of all 30+ commands will occur in subsequent sprints.

## Sprint Documents

### 1. [Technical Architecture](./technical-architecture.md)
**Role**: Architect
**Purpose**: Comprehensive analysis of current CLI state and proposed reorganization

**Key Findings**:
- 1,234-line monolithic index.ts with no coherent organization
- Manual argument parsing with error-prone if/else chains
- Inconsistent help text across commands
- No systematic command discovery

**Proposed Solution**:
- Domain-driven taxonomy: infra, deploy, data, fleet, dev, context
- Help registry pattern for auto-generated documentation
- Standardized flags across all commands
- 7-sprint phased implementation plan

### 2. [Framework Evaluation](./framework-evaluation.md)
**Role**: Architect
**Purpose**: Evaluate CLI frameworks (oclif vs Commander.js vs yargs vs custom)

**Decision**: **oclif** (Score: 43/45)
- Enterprise-grade framework (Salesforce, Heroku)
- Auto-generated help and documentation
- Plugin system for extensibility
- TypeScript-first with decorator support
- 2-3 sprint migration effort vs 3-4 sprints for custom solution

**Alternatives Considered**:
- Commander.js (27/45) - Simple but limited
- yargs (30/45) - Feature-rich but complex API
- Custom implementation (27/45) - Full control but high maintenance

### 3. [oclif Migration Guide](./oclif-migration-guide.md)
**Role**: Architect
**Purpose**: Architectural patterns and techniques for implementing the oclif migration

**Key Content**:
- Current architecture analysis (6 key patterns identified)
- oclif core concepts with TypeScript examples
- 6 migration patterns by command type
- Critical patterns to preserve (DI, pino logging, context resolution)
- Common pitfalls and solutions
- Complete reference example for `fleet list` command

**Critical Patterns to Preserve**:
1. **Pino logging** - Structured JSON logging with metadata
2. **Context resolution** - Support for local, staging, prod contexts
3. **Dependency injection** - Testability via FleetDeps, OrchestratorDeps

### 4. [Execution Plan](./execution-plan.md)
**Role**: Lead Implementor
**Purpose**: Detailed sprint breakdown with day-by-day timeline

**Phases**:
- **Phase 0**: Infrastructure Setup (Days 1-2)
  - Install oclif dependencies
  - Create directory structure
  - Configure TypeScript and package.json
  - Create oclif entry point

- **Phase 1**: Base Command Pattern (Days 2-3)
  - Create BratCommand base class
  - Integrate pino logger, context resolver, DI
  - Establish shared utilities

- **Phase 2**: Proof of Concept - 5 Commands (Days 3-6)
  - Migrate: setup, doctor, fleet list, config show, release
  - Implement backward compatibility layer
  - Add deprecation warnings

- **Phase 3**: Testing & Validation (Days 6-7)
  - Integration test suite
  - End-to-end validation script
  - Manual testing and bug fixing
  - Performance benchmarking

**Success Metrics**:
- All 5 PoC commands work via oclif
- Backward compatibility preserved (old commands still work)
- validate_deliverable.sh passes
- No regression in existing functionality

### 5. [Backlog (YAML)](./backlog.yaml)
**Role**: Lead Implementor
**Purpose**: Trackable, prioritized task list for project management

**Statistics**:
- **Total Tasks**: 29 (23 in-scope, 6 future work)
- **Story Points**: 71 total
  - Phase 0: 8 points
  - Phase 1: 16 points
  - Phase 2: 26 points
  - Phase 3: 16 points
  - Documentation: 5 points
- **Priority Distribution**: 17 P0 (critical), 9 P1 (high), 2 P2 (medium)

**Task Categories**:
- Infrastructure Setup (INFRA-001 to INFRA-005)
- Base Command Pattern (BASE-001 to BASE-005)
- PoC Commands (POC-001 to POC-006)
- Testing & Validation (TEST-001 to TEST-004)
- Documentation (DOC-001 to DOC-003)
- Future Work (FUTURE-001 to FUTURE-004)

### 6. [Validation Script](./validate_deliverable.sh)
**Purpose**: Automated end-to-end validation of all sprint deliverables

**Usage**:
```bash
chmod +x planning/sprint-359-brat-cli-reorganization/validate_deliverable.sh
bash planning/sprint-359-brat-cli-reorganization/validate_deliverable.sh
```

**Validation Checks**:
1. **Phase 0**: Dependencies installed, directory structure created
2. **Phase 1**: BratCommand base class with logger, context, DI
3. **Phase 2**: PoC commands migrated, backward compatibility preserved
4. **Build**: TypeScript compilation successful
5. **Help Text**: Auto-generated help works for all commands
6. **Tests**: All test suites passing
7. **Documentation**: Planning docs and user guides exist
8. **Critical Patterns**: Pino logging, context resolution, DI preserved

**Exit Codes**:
- `0` - All critical validations passed
- `1` - One or more validations failed

## Proof of Concept Commands

These 5 commands represent the primary command patterns in the brat CLI:

| Command | Pattern | Complexity | Story Points |
|---------|---------|------------|--------------|
| `brat setup` | Interactive setup with prompts | Medium | 5 |
| `brat doctor` | Simple validation with structured output | Low | 3 |
| `brat fleet list` | Fleet command with DI and MCP client | High | 5 |
| `brat config show` | Config display with redaction | Medium | 3 |
| `brat release` | Complex orchestration with multiple steps | High | 5 |

Once these 5 commands are successfully migrated, the patterns can be applied to the remaining 25+ commands in subsequent sprints.

## Future Work (Out of Scope)

The following tasks are identified for future sprints:

- **Sprint 360-361**: Migrate remaining 25+ commands to oclif
- **Sprint 362**: Implement plugin system for extensions
- **Sprint 363**: Remove legacy CLI router (after 3-sprint deprecation window)
- **Sprint 364**: Cloud deployment integration and CI/CD documentation

## Success Criteria

Sprint 359 is considered successful when:

1. ✅ All P0 (critical) tasks completed (17 tasks)
2. ✅ All 5 PoC commands work via oclif entry point
3. ✅ Backward compatibility preserved (old commands still work with deprecation warnings)
4. ✅ `validate_deliverable.sh` passes with 0 critical failures
5. ✅ No regression in existing functionality
6. ✅ BratCommand base class demonstrates all critical patterns (logging, context, DI)
7. ✅ Documentation complete (planning docs, migration guide, user guide)
8. ✅ Test coverage >80% for PoC commands

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| oclif learning curve | Medium | Medium | Reference implementation from migration guide |
| Breaking backward compatibility | High | High | Keep legacy router, add deprecation warnings |
| Dependency injection complexity | Medium | Medium | Preserve existing FleetDeps patterns |
| Test migration effort | Medium | Low | Use @oclif/test utilities |
| Performance regression | Low | Medium | Benchmark startup time, limit overhead to <100ms |

## Getting Started

When starting this sprint:

1. **Read all planning documents** in order:
   - technical-architecture.md
   - framework-evaluation.md
   - oclif-migration-guide.md
   - execution-plan.md
   - backlog.yaml

2. **Set up development environment**:
   ```bash
   npm install @oclif/core @oclif/plugin-help
   npm install --save-dev @oclif/test
   ```

3. **Follow the execution plan** phase by phase

4. **Validate frequently** using the validation script

5. **Track progress** using the YAML backlog

## References

- **oclif Documentation**: https://oclif.io/
- **oclif GitHub**: https://github.com/oclif/oclif
- **oclif Examples**: https://github.com/oclif/example-multi-ts
- **BitBrat CLAUDE.md**: Critical patterns and development standards
- **BitBrat AGENTS.md**: Sprint protocol and LLM collaboration workflow

## Notes for LLM Agents

If you are an LLM agent (Claude Code, Aider, Continue, etc.) working on this sprint:

1. **Start with Phase 0** - Don't skip infrastructure setup
2. **Follow the migration patterns** in oclif-migration-guide.md exactly
3. **Preserve critical patterns** - Logging, context resolution, DI are non-negotiable
4. **Test frequently** - Run validate_deliverable.sh after each phase
5. **Ask questions** - Use AskUserQuestion if design decisions are ambiguous
6. **Document as you go** - Update CLAUDE.md with oclif patterns as you discover them
7. **Backward compatibility is critical** - Never break existing users

## Sprint Completion Checklist

- [ ] All INFRA tasks completed (INFRA-001 to INFRA-005)
- [ ] All BASE tasks completed (BASE-001 to BASE-005)
- [ ] All POC tasks completed (POC-001 to POC-006)
- [ ] All TEST tasks completed (TEST-001 to TEST-004)
- [ ] All DOC tasks completed (DOC-001 to DOC-003)
- [ ] validate_deliverable.sh passes with 0 critical failures
- [ ] All tests passing (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Help text works for all PoC commands
- [ ] Backward compatibility validated
- [ ] Performance benchmarks acceptable (<100ms overhead)
- [ ] Documentation published
- [ ] User migration guide created
- [ ] CLAUDE.md updated with oclif patterns
- [ ] Sprint retrospective completed (retro.md)
- [ ] Key learnings documented (key-learnings.md)

---

**Created**: 2026-07-24
**Roles**: Architect, Lead Implementor
**Sprint Protocol**: AGENTS.md v3
