# Implementation Plan – Sprint 331

**Sprint ID**: 331-d4a8f2
**Title**: Modernize Bit creation with brat bit create command
**Role**: Lead Implementor
**Date**: 2026-07-03
**Status**: PLANNING (awaiting approval)

---

## Executive Summary

This implementation plan details the step-by-step execution strategy for replacing the legacy `brat service bootstrap` command with a modern `brat bit create` command. The plan follows the Technical Architecture document and breaks the work into 4 phases with 27 trackable tasks.

**Estimated Effort**: 2-3 days
**Risk Level**: Medium (YAML manipulation, comprehensive cleanup)
**Dependencies**: None (self-contained sprint)

---

## Prerequisites

Before starting implementation:

### Environment Setup
- [x] Sprint branch created: `feature/sprint-331-d4a8f2-brat-bit-create`
- [ ] Dependencies installed: `npm install`
- [ ] Build succeeds: `npm run build`
- [ ] Test suite passes: `npm test`
- [ ] Local environment verified: `npm run brat -- doctor`

### Knowledge Requirements
- Understanding of brat CLI architecture (tools/brat/src/cli/)
- Familiarity with architecture.yaml structure
- Knowledge of Bit model (profile, exposure, kind)
- Experience with js-yaml library for YAML manipulation
- Understanding of Jest testing framework

### Reference Materials
- Technical Architecture: `planning/sprint-331-d4a8f2/technical-architecture.md`
- Existing fleet command pattern: `tools/brat/src/cli/fleet.ts`
- Current bootstrap implementation: `tools/brat/src/cli/bootstrap.ts`
- Architecture schema: `documentation/schemas/architecture.v1.json`

---

## Implementation Phases

### Phase 1: Core Implementation (BL-331-101 to BL-331-107)

**Goal**: Implement the complete `brat bit create` command with all functionality.

**Duration**: 1 day

**Tasks**:

1. **BL-331-101: Create module structure** (30 min)
   - Create `tools/brat/src/cli/bit/` directory
   - Create stub files: `create.ts`, `templates.ts`, `validation.ts`, `registry.ts`
   - Export structure from index files
   - **Verification**: Directory structure exists, files compile

2. **BL-331-102: Implement validation logic** (2 hours)
   - Implement `validateBitName()` - kebab-case validation
   - Implement `validateProfileExposure()` - profile ↔ exposure contract
   - Implement `validateBitDoesNotExist()` - uniqueness check
   - **Verification**: Unit tests pass for all validation scenarios

3. **BL-331-103: Implement template generators** (3 hours)
   - Port and enhance `generateAppSource()` from bootstrap.ts
   - Profile-aware scaffolding (core, gateway, llm, mcp-domain)
   - Exposure-aware constructor arguments
   - Kind-aware structure (pipeline-service, gateway, mcp-server)
   - Implement `generateTest()`, `generateDockerfile()`, `generateCompose()`
   - **Verification**: Templates generate for all profile/exposure/kind combinations

4. **BL-331-104: Implement architecture.yaml registration** (2 hours)
   - Implement `registerBitInArchitecture()` function
   - Load YAML with js-yaml
   - Validate uniqueness
   - Insert service entry with correct structure
   - Write back preserving formatting
   - **Verification**: YAML registration works without corruption

5. **BL-331-105: Implement command logic** (2 hours)
   - Implement `cmdBitCreate()` main function
   - Argument parsing and validation
   - File generation orchestration
   - Optional architecture.yaml registration
   - Error handling and user feedback
   - **Verification**: Command executes end-to-end successfully

6. **BL-331-106: Create command group entry point** (1 hour)
   - Implement `tools/brat/src/cli/bit.ts`
   - Route subcommands (only `create` for now)
   - Help text for command group
   - **Verification**: `brat bit --help` displays correctly

7. **BL-331-107: Integrate into brat CLI** (1 hour)
   - Add command handler in `tools/brat/src/cli/index.ts`
   - Update main help text
   - Test integration with existing commands
   - **Verification**: `brat bit create` accessible from main CLI

**Phase 1 Acceptance Criteria**:
- [ ] `npm run brat -- bit create test-bit` generates 4 files
- [ ] `npm run brat -- bit create test-bit --register` updates architecture.yaml
- [ ] All profile/exposure/kind combinations work
- [ ] Validation errors are clear and actionable
- [ ] Help text is comprehensive

---

### Phase 2: Testing (BL-331-201 to BL-331-206)

**Goal**: Achieve comprehensive test coverage (≥80%) for all new code.

**Duration**: 0.5 days

**Tasks**:

1. **BL-331-201: Unit tests for validation** (1 hour)
   - Test `validateBitName()` with valid/invalid names
   - Test `validateProfileExposure()` with all combinations
   - Test `validateBitDoesNotExist()` with existing/new services
   - **Verification**: All validation edge cases covered

2. **BL-331-202: Unit tests for templates** (2 hours)
   - Test template generation for each profile
   - Test exposure variations
   - Test kind variations
   - Verify generated code structure
   - **Verification**: Template output matches expectations

3. **BL-331-203: Unit tests for registry** (1.5 hours)
   - Test architecture.yaml parsing
   - Test service insertion
   - Test YAML formatting preservation
   - Test duplicate detection
   - Test error handling (malformed YAML)
   - **Verification**: Registry operations work correctly

4. **BL-331-204: Unit tests for command logic** (1.5 hours)
   - Test argument parsing
   - Test file generation orchestration
   - Test error handling
   - Mock file system operations
   - **Verification**: Command logic thoroughly tested

5. **BL-331-205: Integration test** (2 hours)
   - Create temp directory
   - Run `brat bit create` end-to-end
   - Verify 4 files created
   - Verify generated code compiles
   - Verify generated test passes
   - Cleanup temp files
   - **Verification**: E2E flow works in isolated environment

6. **BL-331-206: Manual testing** (1 hour)
   - Execute manual testing checklist from technical architecture
   - Test each profile (core, gateway, llm, mcp-domain)
   - Test each exposure (platform-only, platform+domain, none)
   - Test each kind (pipeline-service, gateway, mcp-server)
   - Test `--register` flag
   - Test `--force` flag
   - Verify validation errors
   - **Verification**: All manual test cases pass

**Phase 2 Acceptance Criteria**:
- [ ] Test coverage ≥ 80% for new code
- [ ] All unit tests pass
- [ ] Integration test passes
- [ ] Manual testing checklist completed
- [ ] No regressions in existing test suite

---

### Phase 3: Documentation (BL-331-301 to BL-331-305)

**Goal**: Update all documentation to reflect the new command.

**Duration**: 0.5 days

**Tasks**:

1. **BL-331-301: Update CLAUDE.md** (30 min)
   - Update "Creating a New Bit" section
   - Replace `brat service bootstrap` examples with `brat bit create`
   - Add command options reference
   - Update common development patterns
   - **Verification**: CLAUDE.md accurately reflects new command

2. **BL-331-302: Update README.md** (20 min)
   - Update service management section
   - Add `brat bit create` to command reference
   - Update examples
   - **Verification**: README examples work as documented

3. **BL-331-303: Update architecture.yaml** (15 min)
   - Update `extension_points.add_service`
   - Change CLI example to `brat bit create`
   - Update steps to reflect new command
   - **Verification**: extension_points section accurate

4. **BL-331-304: Update/create brat tooling docs** (30 min)
   - Check if `documentation/tools/brat.md` exists
   - Create or update with `brat bit` command group section
   - Document all options with examples
   - Add profile/exposure/kind reference table
   - **Verification**: Documentation comprehensive and accurate

5. **BL-331-305: Create Bit creation guide (optional)** (1 hour)
   - Create `documentation/guides/creating-bits.md`
   - Comprehensive walkthrough
   - Examples for common scenarios
   - Troubleshooting section
   - **Verification**: Guide is helpful for new developers

**Phase 3 Acceptance Criteria**:
- [ ] All documentation updated
- [ ] Examples tested and verified working
- [ ] No references to old command in active docs
- [ ] Documentation review completed

---

### Phase 4: Cleanup & Removal (BL-331-401 to BL-331-407)

**Goal**: Remove all legacy bootstrap implementations.

**Duration**: 0.5 days

**Tasks**:

1. **BL-331-401: Remove brat service bootstrap command** (30 min)
   - Remove command handlers from `tools/brat/src/cli/index.ts` (lines ~723-742)
   - Remove from help text
   - Remove import of bootstrap module
   - **Verification**: `brat service bootstrap` command no longer available

2. **BL-331-402: Delete tools/brat/src/cli/bootstrap.ts** (5 min)
   - Delete file
   - **Verification**: File no longer exists

3. **BL-331-403: Delete infrastructure/scripts/bootstrap-service.js** (5 min)
   - Delete file
   - **Verification**: File no longer exists

4. **BL-331-404: Delete infrastructure/scripts/bootstrap-service.test.js** (5 min)
   - Delete file
   - **Verification**: File no longer exists

5. **BL-331-405: Update CI/CD scripts** (30 min)
   - Search for references to old command in CI configs
   - Update GitHub workflows if any
   - Update deployment scripts if any
   - **Verification**: No CI failures due to missing command

6. **BL-331-406: Update sprint templates** (20 min)
   - Check planning/ directory for sprint templates
   - Update any references to service bootstrap
   - **Verification**: Sprint templates reference new command

7. **BL-331-407: Update CHANGELOG.md** (20 min)
   - Add breaking change notice
   - Document removal of `brat service bootstrap`
   - Document removal of `infrastructure/scripts/bootstrap-service.js`
   - Document new `brat bit create` command
   - **Verification**: CHANGELOG accurately reflects changes

**Phase 4 Acceptance Criteria**:
- [ ] All legacy bootstrap code removed
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (no references to removed code)
- [ ] CHANGELOG.md updated
- [ ] No CI/CD failures

---

## Testing Strategy

### Unit Testing

**Framework**: Jest
**Location**: `tools/brat/src/cli/bit/__tests__/`

**Coverage Targets**:
- Validation logic: 100%
- Template generation: 90%
- Registry operations: 90%
- Command logic: 85%
- Overall: ≥80%

**Test Structure**:
```
tools/brat/src/cli/bit/__tests__/
  validation.test.ts
  templates.test.ts
  registry.test.ts
  create.test.ts
```

**Mocking Strategy**:
- Mock `fs` for file operations
- Mock `loadArchitecture` for architecture.yaml
- Mock `Logger` for logging

### Integration Testing

**Location**: `tools/brat/src/cli/__tests__/bit-create.integration.test.ts`

**Scenarios**:
1. Create Bit with default options
2. Create Bit with all options specified
3. Create Bit with `--register` flag
4. Create Bit with `--force` flag
5. Error handling (invalid name, duplicate service, etc.)

**Cleanup**: All tests must clean up temp files/directories

### Manual Testing

**Checklist** (from technical architecture):
- [ ] Create Bit with each profile (core, gateway, llm, mcp-domain)
- [ ] Create Bit with each exposure (platform-only, platform+domain, none)
- [ ] Create Bit with each kind (pipeline-service, gateway, mcp-server)
- [ ] Verify generated code compiles (`npm run build`)
- [ ] Verify generated test passes (`npm test -- <test-file>`)
- [ ] Verify Docker build works (`docker build -f Dockerfile.<name> .`)
- [ ] Verify `--register` updates architecture.yaml correctly
- [ ] Verify `--force` overwrites existing files
- [ ] Verify validation errors for invalid profile/exposure combinations
- [ ] Verify help text (`brat bit create --help`)

---

## Risk Management

### High-Risk Areas

| Risk | Mitigation Strategy | Contingency Plan |
|------|---------------------|------------------|
| YAML formatting corruption | Extensive testing with real architecture.yaml; preserve formatting options in js-yaml | Manual YAML repair guide; git revert capability |
| Profile/exposure validation bugs | Comprehensive unit tests covering all combinations; reference table validation | Clear error messages guide users to fix issues |
| Breaking existing workflows | Thorough testing of all command scenarios; CI validation | Document migration steps in CHANGELOG |
| Template generation errors | Unit tests verify compilation; integration tests run generated code | Template fix process documented |
| Missing legacy script references | Codebase-wide search before deletion | Keep backlog item to scan for remaining references |

### Risk Mitigation Checkpoints

**After Phase 1**:
- [ ] Verify command integration doesn't break existing brat commands
- [ ] Verify architecture.yaml registration doesn't corrupt file

**After Phase 2**:
- [ ] Verify test coverage meets 80% threshold
- [ ] Verify no test regressions

**After Phase 3**:
- [ ] Verify all documentation examples work
- [ ] Verify no broken links

**After Phase 4**:
- [ ] Verify no references to removed code
- [ ] Verify CI/CD still works

---

## Dependencies & Blockers

### External Dependencies
- None (all dependencies already in package.json)

### Internal Dependencies
- None (no other active sprints)

### Potential Blockers
- None identified

---

## Acceptance Criteria (Sprint-Level)

### Functional Requirements
- [ ] `brat bit create <name>` generates 4 files with correct content
- [ ] All profile/exposure combinations validate correctly
- [ ] `--register` updates architecture.yaml without corruption
- [ ] Generated code compiles and tests pass
- [ ] Help text is clear and comprehensive
- [ ] Error messages are actionable

### Non-Functional Requirements
- [ ] Command executes in < 2 seconds (file generation only)
- [ ] Test coverage ≥ 80% for new code
- [ ] All existing tests continue to pass
- [ ] YAML formatting preserved (manual inspection)
- [ ] Documentation updated and reviewed

### Quality Gates
- [ ] Code review passed (self-review + user approval)
- [ ] All unit tests pass
- [ ] Integration test passes
- [ ] Manual testing checklist completed
- [ ] Documentation review completed
- [ ] No linting errors
- [ ] Build succeeds
- [ ] CHANGELOG updated

---

## Validation Checklist

### Pre-Implementation
- [ ] Technical architecture reviewed and approved
- [ ] Implementation plan approved by user
- [ ] Backlog created and prioritized
- [ ] Sprint ready to start

### Phase Completion Gates

**Phase 1 Complete When**:
- [ ] All core implementation tasks (BL-331-101 to BL-331-107) marked complete
- [ ] Command accessible via `brat bit create`
- [ ] Manual smoke test passes (create one Bit successfully)
- [ ] Code compiles without errors

**Phase 2 Complete When**:
- [ ] All testing tasks (BL-331-201 to BL-331-206) marked complete
- [ ] Test coverage ≥ 80%
- [ ] All tests green
- [ ] Integration test passes

**Phase 3 Complete When**:
- [ ] All documentation tasks (BL-331-301 to BL-331-305) marked complete
- [ ] Documentation reviewed
- [ ] Examples verified working

**Phase 4 Complete When**:
- [ ] All cleanup tasks (BL-331-401 to BL-331-407) marked complete
- [ ] Legacy code removed
- [ ] Build and tests still pass
- [ ] CHANGELOG updated

### Sprint Complete When
- [ ] All 4 phases complete
- [ ] All backlog items marked complete or deferred with justification
- [ ] Validation script passes
- [ ] User approves deliverable

---

## Rollback Plan

If critical issues are discovered during implementation:

### Rollback Triggers
- YAML corruption that cannot be fixed
- Breaking changes to existing brat commands
- Unrecoverable test failures
- User requests halt

### Rollback Procedure
1. Commit all work in progress to feature branch
2. Document issue in request-log.md
3. Create rollback backlog item
4. Revert to main branch
5. Discuss with user before proceeding

### Partial Rollback
- Phases 1-3 can be completed without Phase 4 (cleanup)
- If Phase 4 causes issues, legacy commands can be restored temporarily

---

## Timeline

**Total Estimated Duration**: 2-3 days

### Day 1
- Morning: Phase 1 (Core Implementation) - Tasks BL-331-101 to BL-331-107
- Afternoon: Phase 2 Start (Testing) - Tasks BL-331-201 to BL-331-203

### Day 2
- Morning: Phase 2 Complete (Testing) - Tasks BL-331-204 to BL-331-206
- Afternoon: Phase 3 (Documentation) - Tasks BL-331-301 to BL-331-305

### Day 3
- Morning: Phase 4 (Cleanup & Removal) - Tasks BL-331-401 to BL-331-407
- Afternoon: Final validation, verification report, PR creation

**Note**: Timeline assumes full-time focus. Adjust based on availability.

---

## Success Metrics

### Quantitative
- [ ] 27 backlog items completed
- [ ] ~700 lines of legacy code removed
- [ ] ~600 lines of new code added
- [ ] Test coverage: 80%+ for new code
- [ ] 0 regressions in existing test suite
- [ ] 0 YAML corruption incidents
- [ ] Command execution time: < 2 seconds

### Qualitative
- [ ] Developer experience improved (clearer command structure)
- [ ] Validation errors are actionable
- [ ] Documentation is comprehensive
- [ ] Code is maintainable and extensible
- [ ] User satisfaction with new command

---

## Next Steps

1. **Await User Approval**: Present this plan and backlog for approval
2. **User says "Start sprint"**: Begin Phase 1 implementation
3. **Execute Phases**: Work through backlog in priority order
4. **Continuous Validation**: Mark tasks complete and validate after each phase
5. **Sprint Completion**: Verification report, PR creation, retro

---

## Appendix A: Command Examples for Testing

### Basic Usage
```bash
# Default (core, platform-only, pipeline-service)
npm run brat -- bit create my-service

# Gateway with domain tools
npm run brat -- bit create api-gateway --profile gateway --exposure platform+domain --kind gateway

# MCP tool server
npm run brat -- bit create custom-tools --profile mcp-domain --kind mcp-server

# With registration
npm run brat -- bit create my-service --register --active

# Force overwrite
npm run brat -- bit create my-service --force
```

### Validation Test Cases
```bash
# Should succeed
npm run brat -- bit create test-service --profile core --exposure platform-only

# Should fail (mcp-domain requires platform+domain)
npm run brat -- bit create test-mcp --profile mcp-domain --exposure platform-only

# Should fail (invalid name)
npm run brat -- bit create TestService

# Should fail (duplicate)
npm run brat -- bit create oauth-flow
```

---

## Appendix B: File Generation Examples

### Profile: core, Exposure: platform-only
```typescript
import { Bit } from '../common/base-server';

export class MyServiceServer extends Bit {
  constructor() {
    super({ mcpExposure: 'platform-only' });
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await super.close(reason);
  }
}
```

### Profile: mcp-domain, Exposure: platform+domain
```typescript
import { Bit } from '../common/base-server';
import { z } from 'zod';

export class CustomToolsServer extends Bit {
  constructor() {
    super({ mcpExposure: 'platform+domain' });
    this.registerDomainTools();
  }

  private registerDomainTools() {
    this.registerTool(
      'echo',
      'Echoes back the input',
      z.object({ message: z.string() }),
      async (args) => ({ content: [{ type: 'text', text: args.message }] })
    );
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await super.close(reason);
  }
}
```

---

## End of Implementation Plan

**Status**: Ready for User Approval
**Next Action**: Present to user and await "Start sprint" command
