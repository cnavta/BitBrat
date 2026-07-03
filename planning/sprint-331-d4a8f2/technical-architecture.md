# Technical Architecture: `brat bit create` Command

**Sprint**: 331-d4a8f2
**Author**: Architect
**Date**: 2026-07-03
**Status**: DRAFT for Review

---

## Executive Summary

This document defines the technical architecture for replacing the current `brat service bootstrap` command with a modern `brat bit create` command that reflects current BitBrat nomenclature, offers comprehensive configuration options, and makes Bit lifecycle management integral to the brat CLI tooling.

### Goals
1. Align terminology: Replace "service" with "Bit" throughout the creation workflow
2. Expose full configuration: Allow specification of `kind`, `profile`, and `mcp.exposure`
3. Improve developer experience: Provide sensible defaults and validation against `architecture.yaml`
4. Clean replacement: Completely replace `brat service bootstrap` with modern implementation

### Non-Goals
- Backward compatibility with `brat service bootstrap` (will be removed)
- Modifying existing Bits or services
- Changes to the Bit base class itself
- Deployment or runtime behavior changes

---

## Current State Analysis

### Summary: Files to be Removed

This sprint will completely remove all legacy Bit creation implementations:

**Brat CLI Implementation**:
- `tools/brat/src/cli/bootstrap.ts` (current implementation)
- Command handlers in `tools/brat/src/cli/index.ts` (lines ~723-742)

**Legacy Standalone Scripts**:
- `infrastructure/scripts/bootstrap-service.js` (pre-brat CLI implementation)
- `infrastructure/scripts/bootstrap-service.test.js` (tests for legacy script)

**Build Artifacts** (auto-removed on next build):
- `dist/tools/brat/src/cli/bootstrap.js`
- `dist/tools/brat/src/cli/bootstrap.d.ts`

**Total Impact**: ~700 lines of code to be removed, replaced by ~600 lines of new implementation.

### Existing Implementation: `brat service bootstrap`

**Location**: `tools/brat/src/cli/bootstrap.ts` + `tools/brat/src/cli/index.ts:723-742`

**Current Interface**:
```bash
brat service bootstrap --name <name> [--mcp] [--force]
```

**Limitations**:
1. **Outdated Terminology**: Uses "service" instead of "Bit"
2. **Limited Configuration**: Only supports `--mcp` flag (maps to `mcpExposure: 'platform+domain'`)
3. **No Profile Support**: Cannot specify capability profile (core, gateway, llm, mcp-domain)
4. **No Kind Support**: Cannot specify service kind (pipeline-service, gateway, mcp-server)
5. **Implicit Defaults**: Profile and exposure are hardcoded rather than configurable
6. **No Validation**: Does not validate against architecture.yaml constraints

**Current Behavior**:
- Requires service to already exist in `architecture.yaml`
- Generates 4 files:
  1. App source (`src/apps/<name>.ts` or custom entry)
  2. Unit test (`<entry>.test.ts`)
  3. Dockerfile (`Dockerfile.<name>`)
  4. Docker Compose (`infrastructure/docker-compose/services/<name>.compose.yaml`)
- Templates hardcode `Bit` as base class
- MCP exposure is binary: `--mcp` → `platform+domain`, else no explicit exposure

### Legacy Implementation: `infrastructure/scripts/bootstrap-service.js`

**Location**: `infrastructure/scripts/bootstrap-service.js` + `infrastructure/scripts/bootstrap-service.test.js`

**Status**: Deprecated duplicate implementation

**Analysis**:
- This is an older standalone Node.js script that predates the `brat` CLI tooling
- Duplicates functionality of `tools/brat/src/cli/bootstrap.ts`
- Uses outdated patterns (BaseServer/McpServer instead of Bit)
- Not referenced in package.json scripts
- Only referenced in historical sprint documents
- Last meaningful update was in sprint-318 when it was superseded by brat CLI

**Removal Rationale**:
- Duplicate functionality creates maintenance burden
- Inconsistent with current architecture (uses BaseServer/McpServer, not Bit)
- Not actively used in current development workflows
- No package.json script references
- Clean slate approach: remove all legacy bootstrap implementations

### Architecture.yaml Service Structure

Services in `architecture.yaml` have the following structure:

```yaml
services:
  <service-name>:
    profile: <core|gateway|llm|mcp-domain>        # Capability profile (§6.3)
    mcp:
      exposure: <platform-only|platform+domain>   # MCP exposure level
    active: <true|false>                          # Deploy filter
    description: "..."                            # Human-readable description
    kind: <pipeline-service|gateway|mcp-server>   # Service classification
    stage: <ingest|route|analyze|react|egress|persist>  # Dataflow stage
    entry: src/apps/<name>-service.ts             # TypeScript entry point
    port: 3000                                    # HTTP port (default 3000)
    topics:                                       # Message bus subscriptions
      consumes: [...]
      publishes: [...]
    secrets: [...]                                # Secret Manager refs
    env: [...]                                    # Environment variables
    paths: [...]                                  # HTTP routes (for gateways)
    # ... other optional fields
```

**Key Constraints from architecture.yaml**:
- `defaults.services.active: false` — absent `active` means disabled
- `defaults.services.profile: core` — default profile if unspecified
- `defaults.services.mcp.exposure: platform-only` — default MCP exposure
- `defaults.services.port: 3000` — default HTTP port

---

## Proposed Solution Architecture

### Command Structure

Adopt a **command group** pattern (like `brat fleet`) for Bit lifecycle management:

```bash
brat bit create <name> [options]
brat bit list                      # Future: list all Bits from architecture.yaml
brat bit describe <name>           # Future: show Bit details from architecture.yaml
brat bit validate <name>           # Future: validate Bit configuration
```

**Initial Scope (Sprint 331)**: Implement `brat bit create` only. Additional subcommands are deferred.

### Command Interface: `brat bit create`

```bash
brat bit create <name> [options]

Required Arguments:
  <name>                    Bit name (kebab-case, must be unique in architecture.yaml)

Options:
  --kind <k>                Service kind: pipeline-service | gateway | mcp-server
                            Default: pipeline-service

  --profile <p>             Capability profile: core | gateway | llm | mcp-domain
                            Default: core

  --exposure <e>            MCP exposure: platform-only | platform+domain | none
                            Default: platform-only
                            Note: 'none' omits mcpExposure (legacy behavior)

  --stage <s>               Dataflow stage: ingest | route | analyze | react | egress | persist
                            Default: (none — optional)

  --port <p>                HTTP port
                            Default: 3000

  --entry <path>            TypeScript entry point (relative to project root)
                            Default: src/apps/<name>-service.ts

  --description <desc>      Human-readable description
                            Default: "Generated Bit: <name>"

  --active                  Mark Bit as active (deployable)
                            Default: false (inactive, must be explicitly enabled)

  --force                   Overwrite existing files
                            Default: false

  --register                Also register Bit in architecture.yaml
                            Default: false (scaffolding only; manual registration required)

  --help                    Show help message
```

### Profile → Exposure Validation

The command must enforce the **profile ↔ exposure contract** (per `documentation/concepts/capability-profiles.md`):

| Profile      | Valid Exposures                  | Notes                                      |
|--------------|----------------------------------|--------------------------------------------|
| `core`       | `platform-only`, `none`          | Core Bits expose only control plane       |
| `gateway`    | `platform-only`, `platform+domain` | Gateways may expose domain tools         |
| `llm`        | `platform-only`                  | LLM Bits expose only control plane         |
| `mcp-domain` | `platform+domain`                | MCP tool servers MUST expose domain tools  |

**Validation Rules**:
1. If `--profile mcp-domain`, `--exposure` must be `platform+domain` (or default)
2. If `--profile llm` or `--profile core`, `--exposure` cannot be `platform+domain`
3. If validation fails, print error and exit with code 2

### File Generation Strategy

The command will generate **4 files** (same as current bootstrap):

1. **App Source** (`<entry>`):
   - Extends `Bit` base class
   - Passes `mcpExposure` to super constructor based on `--exposure`
   - Includes profile-appropriate scaffolding:
     - **gateway**: HTTP route stubs
     - **mcp-domain**: MCP tool example
     - **llm**: No special scaffolding
     - **core**: Minimal setup
   - Includes topic subscription stubs if `--kind pipeline-service`

2. **Unit Test** (`<entry>.test.ts`):
   - Basic health check test
   - Matches current template

3. **Dockerfile** (`Dockerfile.<name>`):
   - Standard multi-stage Node build
   - Matches current template

4. **Docker Compose** (`infrastructure/docker-compose/services/<name>.compose.yaml`):
   - Local development service definition
   - Matches current template

### Architecture.yaml Registration (Optional)

When `--register` is passed, the command will:
1. Parse `architecture.yaml`
2. Validate that `<name>` does not already exist under `services:`
3. Insert a new service entry with minimal required fields:
   ```yaml
   services:
     <name>:
       profile: <profile>
       mcp:
         exposure: <exposure>
       active: <true if --active, else false>
       description: <description>
       kind: <kind>
       entry: <entry>
       port: <port>
       # stage: <stage> — only if --stage provided
   ```
4. Write back to `architecture.yaml` (preserving comments and formatting via `js-yaml` dump)

**Risk Mitigation**:
- Registration is **opt-in** via `--register` flag
- Default behavior is scaffolding only (manual registration required)
- Validation prevents duplicate service names
- Preserve YAML comments and structure using `js-yaml` options

---

## Implementation Strategy

### Module Structure

Create a new dedicated module for the `bit` command group:

```
tools/brat/src/cli/
  bit.ts           # Command group entry point (exports cmdBit)
  bit/
    create.ts      # cmdBitCreate implementation
    templates.ts   # Template generators (app, test, dockerfile, compose)
    registry.ts    # architecture.yaml registration logic
    validation.ts  # Profile/exposure/name validation
```

### CLI Integration

In `tools/brat/src/cli/index.ts`:

```typescript
if (c1 === 'bit') {
  const { cmdBit } = require('./bit');
  await cmdBit(cmd, rest, flags);
  return;
}
```

### Template Generation

Refactor existing `bootstrap.ts` template functions into `bit/templates.ts`:

**Enhancements**:
1. **Profile-aware scaffolding**:
   - **mcp-domain**: Include `registerTool` example
   - **gateway**: Include HTTP route examples
   - **llm**: Include LLM provider initialization comment
   - **core**: Minimal setup

2. **Exposure-aware constructor**:
   ```typescript
   // If exposure === 'platform-only':
   super({ mcpExposure: 'platform-only' });

   // If exposure === 'platform+domain':
   super({ mcpExposure: 'platform+domain' });

   // If exposure === 'none':
   super(); // No mcpExposure arg
   ```

3. **Kind-aware structure**:
   - **pipeline-service**: Include topic subscription stubs
   - **gateway**: Include HTTP route examples
   - **mcp-server**: Include MCP server initialization

### Validation Logic

Implement in `bit/validation.ts`:

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateBitName(name: string): ValidationResult;
function validateProfileExposure(profile: string, exposure: string): ValidationResult;
function validateBitDoesNotExist(name: string, arch: any): ValidationResult;
```

### Architecture.yaml Registration

Implement in `bit/registry.ts`:

```typescript
interface RegistrationOptions {
  name: string;
  profile: string;
  exposure: string;
  kind: string;
  entry: string;
  port: number;
  description: string;
  active: boolean;
  stage?: string;
}

async function registerBitInArchitecture(
  opts: RegistrationOptions,
  root: string,
  logger: Logger
): Promise<void>;
```

**Implementation**:
1. Load `architecture.yaml` via `js-yaml.load()`
2. Validate name uniqueness
3. Insert service entry under `services:`
4. Write back with `js-yaml.dump()` using options:
   ```typescript
   {
     indent: 2,
     lineWidth: 120,
     noRefs: true,
     sortKeys: false  // Preserve original key order
   }
   ```

---

## Testing Strategy

### Unit Tests

Create `tools/brat/src/cli/bit/__tests__/`:

1. **`create.test.ts`**:
   - Validate command argument parsing
   - Validate profile/exposure combinations
   - Validate name format (kebab-case)
   - Test file generation (mock fs writes)
   - Test error handling (invalid args, missing architecture.yaml)

2. **`validation.test.ts`**:
   - Test all profile/exposure combinations
   - Test name validation (valid kebab-case, invalid characters)
   - Test duplicate name detection

3. **`registry.test.ts`**:
   - Test architecture.yaml parsing and insertion
   - Test YAML formatting preservation
   - Test duplicate detection
   - Test error handling (malformed YAML)

4. **`templates.test.ts`**:
   - Test template generation for each profile
   - Test exposure variations
   - Test kind variations
   - Validate generated code compiles (integration test)

### Integration Tests

1. **End-to-End Test** (`tools/brat/src/cli/__tests__/bit-create.integration.test.ts`):
   - Run `brat bit create test-bit --profile core --exposure platform-only`
   - Verify 4 files created
   - Verify generated code compiles
   - Verify test runs and passes
   - Cleanup temp files

2. **Architecture Registration Test**:
   - Create temp architecture.yaml
   - Run `brat bit create test-bit --register`
   - Parse architecture.yaml and verify entry exists
   - Verify YAML is valid

### Manual Testing Checklist

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

## Documentation Requirements

### Updates Required

1. **CLAUDE.md**:
   - Update "Creating a New Bit (Service)" section
   - Replace `brat service bootstrap` examples with `brat bit create`
   - Document new command options

2. **README.md**:
   - Update service management section
   - Add `brat bit create` to command reference

3. **documentation/tools/brat.md**:
   - Add `brat bit` command group section
   - Document `brat bit create` with full option reference
   - Add examples for each profile/exposure combination

4. **architecture.yaml** `extension_points.add_service`:
   - Update CLI example: `brat bit create --name <name> [--profile <p>] [--exposure <e>]`
   - Update steps to reflect new command

5. **New Documentation** (create if doesn't exist):
   - `documentation/guides/creating-bits.md`: Comprehensive guide to bit creation

### Example Documentation Snippets

```markdown
### Creating a New Bit

Use the `brat bit create` command to scaffold a new Bit:

```bash
# Create a core Bit with platform-only exposure (default)
npm run brat -- bit create my-service

# Create a gateway Bit with domain tools
npm run brat -- bit create api-gateway --profile gateway --exposure platform+domain

# Create an MCP tool server
npm run brat -- bit create custom-mcp --profile mcp-domain --kind mcp-server

# Create and register in architecture.yaml
npm run brat -- bit create my-service --register --active
```

**Common Profiles**:
- `core`: Basic Bit with minimal capabilities
- `gateway`: HTTP gateway with routing capabilities
- `llm`: LLM-enabled Bit with provider integration
- `mcp-domain`: MCP tool server exposing domain tools
```

---

## Risk Analysis

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| YAML formatting corruption | Medium | High | Use `js-yaml` with preserve options; extensive testing |
| Profile/exposure validation bugs | Low | Medium | Comprehensive unit tests; validate against architecture.yaml |
| Template generation errors | Medium | Medium | Template unit tests; integration tests verify compilation |

### Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Incomplete documentation | Low | Medium | Documentation review as part of DoD |
| Missing test coverage | Low | High | Minimum 80% coverage requirement |

---

## Success Criteria

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

### User Experience
- [ ] Developer can create a Bit without consulting documentation
- [ ] Error messages clearly explain validation failures
- [ ] Default values align with common use cases
- [ ] Command follows existing brat CLI conventions

---

## Open Questions & Decisions

### Decision Log

| Decision | Rationale | Status |
|----------|-----------|--------|
| Use command group (`brat bit`) | Aligns with `brat fleet` pattern; allows future expansion | ✅ Approved |
| Make `--register` opt-in | Reduces risk of YAML corruption; allows manual review | ✅ Approved |
| Default `active: false` | Aligns with architecture.yaml defaults; prevents accidental deploys | ✅ Approved |
| Support `exposure: none` | Enables legacy behavior (no mcpExposure arg) | ✅ Approved |
| Remove `brat service bootstrap` completely | No backward compatibility required; clean replacement | ✅ Approved |

### Open Questions

1. **Should we auto-format architecture.yaml after registration?**
   - **Recommendation**: No. Preserve existing formatting to minimize diff noise.

2. **Should we validate that `--kind mcp-server` implies `--profile mcp-domain`?**
   - **Recommendation**: Yes, but as a warning rather than an error. Allow override for flexibility.

3. **Should we support interactive mode (prompts for options)?**
   - **Recommendation**: Defer to future sprint. Keep initial version flag-based only.

---

## Implementation Checklist

### Phase 1: Core Implementation
- [ ] Create `tools/brat/src/cli/bit.ts` (command group entry)
- [ ] Create `tools/brat/src/cli/bit/create.ts` (command logic)
- [ ] Create `tools/brat/src/cli/bit/templates.ts` (template generators)
- [ ] Create `tools/brat/src/cli/bit/validation.ts` (validation logic)
- [ ] Create `tools/brat/src/cli/bit/registry.ts` (architecture.yaml registration)
- [ ] Integrate `cmdBit` into `tools/brat/src/cli/index.ts`
- [ ] Add help text for `brat bit create`

### Phase 2: Testing
- [ ] Unit tests for validation logic
- [ ] Unit tests for template generation
- [ ] Unit tests for registry operations
- [ ] Integration test for end-to-end flow
- [ ] Manual testing checklist completed

### Phase 3: Documentation
- [ ] Update CLAUDE.md
- [ ] Update README.md
- [ ] Update documentation/tools/brat.md
- [ ] Update architecture.yaml extension_points
- [ ] Create documentation/guides/creating-bits.md (optional)

### Phase 4: Cleanup & Removal
- [ ] Remove `brat service bootstrap` command from `tools/brat/src/cli/index.ts`
- [ ] Delete `tools/brat/src/cli/bootstrap.ts`
- [ ] Delete legacy `infrastructure/scripts/bootstrap-service.js`
- [ ] Delete legacy `infrastructure/scripts/bootstrap-service.test.js`
- [ ] Update CI/CD scripts to use `brat bit create`
- [ ] Update sprint templates to use `brat bit create`
- [ ] Update CHANGELOG.md with breaking change notice

---

## Appendix A: Example Usage Scenarios

### Scenario 1: Create a Basic Pipeline Service

```bash
npm run brat -- bit create message-processor \
  --profile core \
  --kind pipeline-service \
  --stage react \
  --description "Processes incoming messages and applies transformations"
```

**Generated Files**:
- `src/apps/message-processor-service.ts`
- `src/apps/message-processor-service.test.ts`
- `Dockerfile.message-processor`
- `infrastructure/docker-compose/services/message-processor.compose.yaml`

**Manual Steps**:
1. Register service in `architecture.yaml` (or use `--register`)
2. Implement domain logic in generated service class
3. Add topic subscriptions
4. Build and test

### Scenario 2: Create an MCP Tool Server

```bash
npm run brat -- bit create custom-tools \
  --profile mcp-domain \
  --kind mcp-server \
  --exposure platform+domain \
  --description "Custom MCP tools for domain-specific operations" \
  --register \
  --active
```

**Generated Files** (same as Scenario 1, plus):
- Entry in `architecture.yaml` under `services:`

**Manual Steps**:
1. Implement MCP tools using `registerTool`
2. Test tool execution
3. Deploy to environment

### Scenario 3: Create an HTTP Gateway

```bash
npm run brat -- bit create admin-api \
  --profile gateway \
  --kind gateway \
  --exposure platform+domain \
  --port 8080 \
  --stage ingest \
  --description "Admin API gateway for platform management"
```

**Generated Files** (includes HTTP route scaffolding)

**Manual Steps**:
1. Define routes and handlers
2. Add authentication middleware
3. Register routes in Load Balancer (architecture.yaml)
4. Test endpoints

---

## Appendix B: Template Examples

### Core Profile Template (Minimal)

```typescript
import { Bit } from '../common/base-server';

export class MessageProcessorServer extends Bit {
  constructor() {
    super({ mcpExposure: 'platform-only' });
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await super.close(reason);
  }
}

if (require.main === module) {
  const server = new MessageProcessorServer();
  const port = parseInt(process.env.PORT || '3000', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start message-processor:', err);
    process.exit(1);
  });
}
```

### MCP-Domain Profile Template (With Tool Example)

```typescript
import { Bit } from '../common/base-server';
import { z } from 'zod';

export class CustomToolsServer extends Bit {
  constructor() {
    super({ mcpExposure: 'platform+domain' });
    this.registerDomainTools();
  }

  private registerDomainTools() {
    // Example MCP tool registration
    this.registerTool(
      'echo',
      'Echoes back the input message',
      z.object({
        message: z.string().describe('The message to echo'),
      }),
      async (args) => {
        return {
          content: [{ type: 'text', text: args.message }],
        };
      }
    );
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await super.close(reason);
  }
}

if (require.main === module) {
  const server = new CustomToolsServer();
  const port = parseInt(process.env.PORT || '3000', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start custom-tools:', err);
    process.exit(1);
  });
}
```

### Gateway Profile Template (With HTTP Routes)

```typescript
import { Request, Response } from 'express';
import { Bit } from '../common/base-server';

export class AdminApiServer extends Bit {
  constructor() {
    super({ mcpExposure: 'platform+domain' });
    this.setupRoutes();
  }

  private setupRoutes() {
    const app = this.getApp();

    app.get('/api/status', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', service: 'admin-api' });
    });

    // Add more routes here
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await super.close(reason);
  }
}

if (require.main === module) {
  const server = new AdminApiServer();
  const port = parseInt(process.env.PORT || '8080', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start admin-api:', err);
    process.exit(1);
  });
}
```

---

## Appendix C: Validation Error Messages

### Profile/Exposure Mismatch

```
❌ ERROR: Invalid profile/exposure combination

Profile 'mcp-domain' requires exposure 'platform+domain'.
You specified exposure 'platform-only'.

Valid combinations for mcp-domain:
  --exposure platform+domain

Use: brat bit create <name> --profile mcp-domain --exposure platform+domain
```

### Duplicate Service Name

```
❌ ERROR: Service 'my-service' already exists in architecture.yaml

Cannot create duplicate service entry.

Options:
  1. Use --force to overwrite generated files (does not modify architecture.yaml)
  2. Choose a different name
  3. Remove existing entry from architecture.yaml first
```

### Invalid Name Format

```
❌ ERROR: Invalid service name 'MyService'

Service names must be in kebab-case (lowercase with hyphens).

Examples:
  ✅ my-service
  ✅ api-gateway
  ✅ message-processor

Use: brat bit create my-service [options]
```

---

## Summary

This architecture provides a comprehensive, low-risk path to modernizing Bit creation in the BitBrat Platform. The key design decisions prioritize:

1. **Safety**: Opt-in architecture.yaml registration; preservation of existing formatting
2. **Developer Experience**: Sensible defaults; clear validation errors; comprehensive help text
3. **Flexibility**: Support for all current profiles and exposures; extensible command structure
4. **Migration**: Gradual deprecation of old command; backward compatibility during transition

The implementation can proceed in phases, with thorough testing at each stage to ensure platform stability.

