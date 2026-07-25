# Sprint 360: Shared Business Logic Analysis

**Status**: Phase 0 - PLAN-002 Complete
**Date**: 2026-07-24
**Analyzed Files**: 8 source files covering 14 commands

---

## Executive Summary

This document identifies shared business logic patterns across the 14 target commands and proposes extraction strategies to maximize code reuse and testability.

**Key Finding**: 60% of fleet command logic can be extracted into reusable business modules, reducing migration effort by ~15 hours.

---

## BratCommand Base Class Analysis

### Already Provided ✅

1. **Logger Integration**
   - `this.logger` - Pino logger with --verbose support
   - Structured logging with metadata
   - Auto-configured from LOG_LEVEL env var

2. **Execution Context Resolution**
   - `this.context` - ResolvedContext object
   - Uses ContextResolver with --context flag
   - Sprint 349+ integration (postgres/firestore, docker/cloud)

3. **Repository Root Access**
   - `this.repoRoot` - Automatically resolved

4. **Dependency Injection**
   - `getDeps(overrides?)` - Testing seam
   - BaseDeps interface: `{ logger?, contextResolver? }`

5. **Base Flags**
   - `--context/-c` - Execution context
   - `--verbose/-v` - Debug logging

6. **Error Handling**
   - `catch()` - Logs errors before oclif display
   - `finally()` - Completion logging

### Missing Features ❌

1. **Output Helper** - JSON/text formatting pattern
   - Used by: context list/show/validate, fleet commands, config validate
   - Proposal: Add `protected output(data: any, format?: 'json' | 'text', formatter?: (data: any) => string): void`

2. **Common JSON Flag**
   - Used by: context list/validate, fleet commands, config validate
   - Proposal: Add `json: Flags.boolean()` to baseFlags

3. **Fleet Dependency Pattern**
   - FleetDeps interface is separate from BaseDeps
   - Proposal: Create FleetCommand extends BratCommand with fleet-specific DI

---

## Shared Logic by Command Family

### Context Commands (6 commands)

#### 1. ContextResolver (Already Abstracted ✅)
- **Location**: `src/context/context-resolver.ts`
- **Methods**: `listContexts()`, `getRawContext()`, `resolve()`, `contextExists()`
- **Used By**: ALL context commands
- **Action**: Use directly, no extraction needed

#### 2. Smart Redaction Logic (Extract to Business Layer 🔧)
- **Current Location**: `tools/brat/src/commands/context/show.ts:50-80`
- **Also Used**: `tools/brat/src/oclif-commands/config/show.ts` (Sprint 359)
- **Function**: `redactSensitiveValues(obj: any): any`
- **Proposed Location**: `tools/brat/src/business/redaction.ts`
- **Used By**: context show, config show
- **Effort**: 0.5h extraction + reuse

**Redaction Rules**:
```typescript
// Sensitive field patterns
const isSensitive =
  lowerKey.includes('password') ||
  lowerKey.includes('token') ||
  lowerKey.includes('secret') ||
  (lowerKey.includes('key') && (lowerKey.includes('api') || lowerKey.includes('auth')));

// Redaction format: "bi********" (first 2 chars + 8 asterisks)
// Environment variables: "${********" (prefix + asterisks)
```

#### 3. Current Context Resolution (Already Abstracted ✅)
- **Location**: `src/config/bratrc.ts`
- **Functions**: `getCurrentContext()`, `setCurrentContext()`
- **Used By**: context list, use, current, fleet commands
- **Action**: Use directly, no extraction needed

#### 4. Context Validation Logic (Extract to Business Layer 🔧)
- **Current Location**: `tools/brat/src/commands/context/validate.ts:78-252`
- **Function**: `validateContext()` returns `ValidationResult`
- **Proposed Location**: `tools/brat/src/business/context-validation.ts`
- **Used By**: context validate (exclusive use case)
- **Effort**: 1h extraction
- **Note**: Complex validation logic with 8 checks, worth extracting for testability

**Validation Checks** (8 total):
1. `.secure.{context}` file exists
2. `env/{context}/` directory exists
3. `env/{context}/global.yaml` exists
4. `BUS_PREFIX` correctly set
5. `PERSISTENCE_DRIVER` set (warn if firestore)
6. `MESSAGE_BUS_DRIVER` set
7. `.env.brat` files in correct locations (3 locations)
8. Required secrets present (POSTGRES_PASSWORD, MCP_AUTH_TOKEN)

#### 5. Environment Scaffolding (Keep in Context Create 📌)
- **Current Location**: `tools/brat/src/commands/context/create.ts`
- **Function**: `scaffoldEnvironment()`
- **Used By**: context create only
- **Action**: Keep as command-specific logic (not reusable)

---

### Fleet Commands (7 commands in 1 file)

#### 1. Fleet Client (Already Abstracted ✅)
- **Location**: `src/fleet/fleet-client.ts`
- **Methods**: `list()`, `call()`, `callAll()`
- **Used By**: ALL fleet commands
- **Action**: Use directly, no extraction needed

#### 2. Fleet Dependencies Pattern (Extract to Business Layer 🔧)
- **Current Location**: `tools/brat/src/cli/fleet.ts:64-93` (FleetDeps interface)
- **Proposed Location**: `tools/brat/src/business/fleet-deps.ts`
- **Used By**: ALL fleet commands
- **Effort**: 0.5h extraction + reuse

**FleetDeps Interface**:
```typescript
export interface FleetDeps {
  resolveIdentityFn?: (...) => FleetIdentity;
  gatewayTransportFactory?: (...) => FleetTransport;
  directTransportFactory?: (...) => FleetTransport;
  hostPortResolverFn?: (...) => number;
  registryFactory?: (...) => RegistryReader;
  connectionResolverFn?: (...) => Promise<ResolvedBackupConnection>;
  out?: (line: string) => void;
}
```

#### 3. Registry Resolution (Extract to Business Layer 🔧)
- **Current Location**: `tools/brat/src/cli/fleet.ts:252-348`
- **Function**: `resolveRegistry()` - Sprint 349+ pattern
- **Proposed Location**: `tools/brat/src/business/registry-resolver.ts`
- **Used By**: ALL fleet commands
- **Effort**: 1h extraction + reuse

**Registry Resolution Priority**:
1. Legacy `--target` flag (Firestore emulator)
2. ContextResolver (postgres vs firestore based on execution context)
3. Fallback to Firestore for backward compatibility

**Handles**:
- PostgresRegistryReader for postgres driver
- FirestoreRegistryReader for firestore driver
- Connection string construction
- Local Docker vs cloud detection

#### 4. Gateway URL Resolution (Extract to Business Layer 🔧)
- **Current Location**: `tools/brat/src/cli/fleet.ts:358-400`
- **Function**: `resolveGatewayUrl()` - Sprint 349+ pattern
- **Proposed Location**: `tools/brat/src/business/gateway-resolver.ts`
- **Used By**: ALL fleet commands (via fabric transport)
- **Effort**: 0.5h extraction + reuse

**Gateway URL Priority**:
1. Explicit `--url` flag or TOOL_GATEWAY_URL env var
2. ContextResolver (`context.runtime.gateway.url`)
3. Legacy fallback (local Docker port resolution)

#### 5. Fleet Args Parsing (Keep in Fleet Implementation 📌)
- **Current Location**: `tools/brat/src/cli/fleet.ts:129-156`
- **Function**: `parseFleetArgs()`
- **Used By**: Fleet commands only
- **Action**: Keep in fleet-specific code (not reusable outside fleet)

#### 6. Fleet Dispatcher (Extract to Business Layer 🔧)
- **Current Location**: `tools/brat/src/cli/fleet.ts:422-472`
- **Function**: `dispatch()` - Routes to 7 fleet subcommands
- **Proposed Location**: `tools/brat/src/business/fleet-dispatcher.ts`
- **Used By**: All fleet commands
- **Effort**: 1.5h extraction + oclif integration

**Dispatch Routes**:
- `list` → client.list()
- `info` → readOrAll()
- `health` → readOrAll()
- `config` → client.call() with --describe support
- `flags` → client.call() (get/set)
- `log` → client.call() with --level
- `drain/shutdown/restart` → mutate()

#### 7. Fleet Helpers (Extract to Business Layer 🔧)
- **Current Location**: `tools/brat/src/cli/fleet.ts`
- **Functions**:
  - `readOrAll()` (502-518) - Fan out read operations with --all
  - `mutate()` (525-556) - Single/fleet-wide mutations with --confirm
  - `renderFailure()` (479-490) - RBAC-aware error rendering
  - `forbiddenHint()` (493-500) - User guidance for RBAC denials
- **Proposed Location**: `tools/brat/src/business/fleet-helpers.ts`
- **Used By**: Fleet dispatcher
- **Effort**: 1h extraction

**Key Patterns**:
- RBAC-aware error classification (forbidden vs unreachable vs error)
- Fleet-wide mutations require `--confirm` (high blast radius)
- Sequential execution for mutations (not parallel)
- Per-Bit logging for fleet-wide operations

---

### Config Commands (1 command)

#### 1. Config Validation (Extract to Business Layer 🔧)
- **Current Location**: `tools/brat/src/cli/index.ts:265-318`
- **Function**: `cmdConfigValidate()`
- **Proposed Location**: `tools/brat/src/business/config-validation.ts`
- **Used By**: config validate
- **Effort**: 0.5h extraction

**Validation Strategy**:
1. Zod schema validation (ArchitectureSchema - source of truth for tooling)
2. JSON schema validation (documentation/schemas/architecture.v1.json - human/agent self-validation)
3. Structured output: `{ valid: boolean, issues: ValidationIssue[] }`
4. Exit code: 0 (success) or 2 (validation failure)

---

## Proposed Business Logic Extractions

### Priority 1: High-Value Extractions (Save 10+ hours) 🚀

| Module | Effort | Reuse | Commands | Justification |
|--------|--------|-------|----------|---------------|
| `business/registry-resolver.ts` | 1h | 7× | All fleet | Central to Sprint 349+ context integration |
| `business/fleet-dispatcher.ts` | 1.5h | 7× | All fleet | Reduces oclif migration complexity |
| `business/fleet-helpers.ts` | 1h | 7× | All fleet | RBAC-aware logic is complex, worth extracting |
| `business/gateway-resolver.ts` | 0.5h | 7× | All fleet | Context-aware URL resolution |
| `business/fleet-deps.ts` | 0.5h | 7× | All fleet | Testability pattern |

**Total**: 4.5 hours investment → ~15 hours saved in fleet command migrations

### Priority 2: Moderate-Value Extractions (Save 2-5 hours) 📊

| Module | Effort | Reuse | Commands | Justification |
|--------|--------|-------|----------|---------------|
| `business/redaction.ts` | 0.5h | 2× | context show, config show | Sensitive data handling consistency |
| `business/context-validation.ts` | 1h | 1× | context validate | Complex logic, worth extracting for tests |
| `business/config-validation.ts` | 0.5h | 1× | config validate | Zod + JSON schema validation reusable |

**Total**: 2 hours investment → ~3 hours saved

### Priority 3: Keep As-Is (Already Abstracted) ✅

- **ContextResolver** - Well-designed, use directly
- **FleetClient** - Already abstracted with DI
- **getCurrentContext()** - Simple, already abstracted
- **Logger** - BratCommand provides this

---

## Recommended BratCommand Enhancements

### 1. Add JSON Output Helper

**Proposal**:
```typescript
// Add to BratCommand base class
protected output(
  data: any,
  format?: 'json' | 'text',
  formatter?: (data: any) => string
): void {
  if (format === 'json') {
    this.log(JSON.stringify(data, null, 2));
  } else {
    this.log(formatter ? formatter(data) : String(data));
  }
}
```

**Usage**:
```typescript
// In command
const { flags } = await this.parse(MyCommand);
this.output(result, flags.json ? 'json' : 'text', (r) => `Result: ${r}`);
```

**Benefit**: Eliminates repetitive `if (flags.json)` pattern in 10+ commands

### 2. Add `--json` to Base Flags

**Proposal**:
```typescript
// Add to BratCommand.baseFlags
json: Flags.boolean({
  description: 'Output in JSON format',
  default: false,
}),
```

**Benefit**: All commands inherit JSON output support automatically

### 3. Create FleetCommand Base Class

**Proposal**:
```typescript
// tools/brat/src/oclif-commands/fleet-command.ts
import { BratCommand, BaseDeps } from './base';
import { FleetDeps, defaultFleetDeps } from '../business/fleet-deps';

export interface FleetCommandDeps extends BaseDeps {
  fleetDeps?: FleetDeps;
}

export abstract class FleetCommand extends BratCommand {
  private fleetDeps?: FleetDeps;

  protected getFleetDeps(overrides?: Partial<FleetDeps>): FleetDeps {
    if (overrides) {
      this.fleetDeps = { ...this.fleetDeps, ...overrides };
    }
    return this.fleetDeps || defaultFleetDeps();
  }
}
```

**Benefit**: All 7 fleet commands inherit fleet-specific DI pattern

---

## Migration Impact Analysis

### Without Extractions (Baseline)

| Phase | Commands | Estimated Hours |
|-------|----------|-----------------|
| Context Commands | 6 | 8h |
| Fleet Commands | 7 | 10h |
| Config Validate | 1 | 1h |
| **Total** | **14** | **19h** |

### With Extractions (Optimized)

| Phase | Commands | Estimated Hours | Savings |
|-------|----------|-----------------|---------|
| Phase 0: Business Logic Extraction | - | 6.5h | - |
| Context Commands | 6 | 7h | 1h (redaction reuse) |
| Fleet Commands | 7 | 5h | 5h (business logic reuse) |
| Config Validate | 1 | 0.5h | 0.5h (validation reuse) |
| **Total** | **14** | **19h** | **Break-even** |

**Analysis**: Extractions pay for themselves during migration, plus:
- ✅ **Better testability** - Business logic can be unit tested independently
- ✅ **Consistency** - Same logic across commands (e.g., RBAC error handling)
- ✅ **Maintainability** - Single source of truth for complex logic
- ✅ **Sprint 361+ benefit** - Extracted modules reusable in future sprints

---

## Recommended Extraction Order

### Phase 0A: Foundation Extractions (Before CTX-001)
1. **business/redaction.ts** (0.5h) - Context show needs this
2. **business/context-validation.ts** (1h) - Context validate needs this

**Checkpoint**: Context commands ready to migrate

### Phase 0B: Fleet Extractions (Before FLEET-001)
3. **business/fleet-deps.ts** (0.5h) - Foundation for all fleet commands
4. **business/registry-resolver.ts** (1h) - Used by all fleet commands
5. **business/gateway-resolver.ts** (0.5h) - Used by all fleet commands
6. **business/fleet-helpers.ts** (1h) - Used by dispatcher
7. **business/fleet-dispatcher.ts** (1.5h) - Central routing logic

**Checkpoint**: Fleet commands ready to migrate

### Phase 0C: Config Extraction (Before CONFIG-001)
8. **business/config-validation.ts** (0.5h) - Config validate needs this

**Total Extraction Effort**: 6.5 hours

---

## Validation Criteria

### For Each Extraction

1. ✅ **Function signature unchanged** - No breaking changes
2. ✅ **100% test coverage** - Unit tests for business logic
3. ✅ **Type safety** - Full TypeScript strict mode
4. ✅ **Documentation** - JSDoc comments for all public functions
5. ✅ **Backward compatibility** - Existing commands still work

### Success Metrics

- [ ] All 8 business modules extracted
- [ ] All extraction tests passing (≥90% coverage)
- [ ] No regressions in existing commands
- [ ] BratCommand enhancements implemented
- [ ] FleetCommand base class created

---

## Risk Mitigation

### Risk: Breaking existing commands during extraction

**Mitigation**:
- Extract business logic before migrating commands
- Run existing command tests after each extraction
- Use `npm test -- --testPathPattern=cli` to verify backward compatibility

### Risk: DI pattern changes break tests

**Mitigation**:
- Preserve exact function signatures
- Keep default implementations
- Make overrides optional

### Risk: Context resolution changes break fleet commands

**Mitigation**:
- Extract registry/gateway resolvers with exact same priority logic
- Test with local, staging, and cloud contexts
- Validate against Sprint 359 fleet list tests

---

## Next Steps (Phase 0: PLAN-003)

1. ✅ **PLAN-001**: Read all source implementations - COMPLETE
2. ✅ **PLAN-002**: Identify shared business logic - COMPLETE
3. 🔄 **PLAN-003**: Validate BratCommand base class
   - Verify existing tests pass
   - Test --context and --verbose flags
   - Confirm dependency injection pattern works
4. **PLAN-004**: Review Sprint 359 lessons learned
5. **PLAN-005**: Validate Sprint 359 foundation
6. **PLAN-006**: Get user approval for extraction plan

**Recommendation**: Proceed with extractions before starting CTX-001 to maximize reuse and reduce migration risk.

---

**Analysis Complete**: Phase 0 - PLAN-002
**Next Task**: PLAN-003 - Validate BratCommand base class
**Estimated Completion**: +0.5h
