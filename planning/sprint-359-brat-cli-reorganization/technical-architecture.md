# Technical Architecture: Brat CLI Reorganization

**Sprint**: 359
**Author**: Architect
**Date**: 2026-07-24
**Status**: DRAFT

## Executive Summary

The `brat` CLI has evolved organically across 358 sprints, accumulating 30+ top-level commands with inconsistent organization, fragmented help systems, and no clear taxonomy. This document proposes a comprehensive reorganization based on:

1. **Command domains** (infrastructure, deployment, data, fleet, development)
2. **Consistent help architecture** (hierarchical, self-documenting, --help at every level)
3. **Verb-noun conventions** (industry standard: `kubectl`, `docker`, `git`)
4. **Progressive disclosure** (simple defaults, advanced options discoverable)

**Impact**: Improved DX, reduced onboarding friction, preparation for public release.

---

## Current State Analysis

### Command Inventory (As of Sprint 358)

| Command | Subcommands | Help Quality | Consistency | Notes |
|---------|-------------|--------------|-------------|-------|
| `setup` | none | ⭐⭐⭐ | Good | Clear purpose, minimal flags |
| `doctor` | none | ⭐⭐⭐ | Good | Simple diagnostic |
| `config` | `show`, `validate` | ⭐⭐ | Fair | Missing --help text |
| `bit` | `create` | ⭐⭐ | Fair | Delegates to separate file |
| `deploy` | `services`, `service`, `<name>` | ⭐ | Poor | Overloaded, confusing semantics |
| `infra` | `plan`, `apply` | ⭐ | Poor | Hidden module selection, legacy envDir fallback |
| `lb` | `urlmap render`, `urlmap import` | ⭐ | Poor | Nested 3 levels deep, no --help |
| `apis` | `enable` | ⭐⭐ | Fair | Single subcommand (should be `gcp apis enable`?) |
| `cloud-run` | `shutdown` | ⭐ | Poor | GCP-specific, should be under `gcp` |
| `trigger` | `create`, `update`, `delete` | ⭐⭐ | Fair | GCP Cloud Build triggers (should be `gcp trigger`) |
| `fleet` | `list`, `info`, `health`, `config`, `flags`, `log`, `drain`, `shutdown` | ⭐⭐⭐⭐ | Excellent | Well-organized, consistent --help |
| `release` | none | ⭐⭐⭐ | Good | Semantic versioning, clear |
| `chat` | none | ⭐⭐ | Fair | Interactive mode |
| `code` | none | ⭐⭐⭐⭐ | Excellent | Agent launcher, good UX |
| `context` | `list`, `show`, `create`, `validate` | ⭐⭐⭐ | Good | Sprint 349, well-designed |
| `use` | none | ⭐⭐⭐ | Good | Context switcher |
| `current` | none | ⭐⭐⭐ | Good | Context display |
| `docker` | `up`, `down`, `logs`, `ps` | ⭐⭐ | Fair | Docker Compose wrapper |
| `dev-mcp` | `start` | ⭐ | Poor | No --help, minimal docs |
| `mcp` | `setup` | ⭐⭐ | Fair | MCP server config |
| `backup` | `list`, `export`, `import` | ⭐⭐ | Fair | Firestore-specific |
| `seed` | none | ⭐⭐⭐ | Good | Database seeding |
| `migrate` | `collection`, `all` | ⭐⭐ | Fair | Firestore → PostgreSQL |
| `pg:backup` | none | ⭐⭐ | Fair | Colon separator inconsistent |
| `pg:restore` | none | ⭐⭐ | Fair | Colon separator inconsistent |
| `db:validate` | none | ⭐⭐ | Fair | Colon separator inconsistent |

### Critical Issues

#### 1. **No Coherent Taxonomy**
Commands are organized by **implementation detail** rather than **user intent**:
- `cloud-run shutdown` vs `docker down` (both orchestration, different platforms)
- `backup` vs `pg:backup` (same domain, different naming conventions)
- `apis enable` vs `trigger create` (both GCP, no grouping)

#### 2. **Inconsistent Help System**
- **printHelp()**: 100-line monolithic function, unmaintained
- **No per-command --help**: Most subcommands don't respond to `--help`
- **Usage errors**: Inline `console.error()` scattered across index.ts
- **No examples**: Help text lacks real-world usage examples

#### 3. **Flag Chaos**
- **Global flags mixed with command flags**: `--env`, `--context`, `--target` all mean similar things
- **Inconsistent casing**: `--bot-name` vs `--botName`, `--log-level` vs `--logLevel`
- **No validation**: Typos silently ignored (e.g., `--envv local` does nothing)
- **Deprecated flags linger**: `--env` and `--target` still parsed (Sprint 349+)

#### 4. **Monolithic index.ts**
- **1,234 lines** of command routing logic
- **Deeply nested if/else chains** (up to 5 levels)
- **Mixed concerns**: Parsing, validation, execution all inline
- **Hard to test**: No separation between CLI and business logic

#### 5. **Namespace Pollution**
- **30+ top-level commands** in global scope
- **Subcommand depth inconsistent**: `lb urlmap render` (3 levels) vs `deploy services` (2 levels)
- **No room to grow**: Every new feature creates a new top-level command

---

## Proposed Architecture

### Design Principles

1. **Domain-Driven Organization**: Group commands by domain (infra, data, fleet, dev)
2. **Verb-Noun Convention**: `brat <domain> <verb> <noun>` (e.g., `brat infra apply network`)
3. **Self-Documenting**: Every command/subcommand responds to `--help`
4. **Progressive Disclosure**: Simple defaults, advanced options behind flags
5. **Consistent Flags**: Kebab-case, validated, documented
6. **Modular Implementation**: One file per command group, testable

### Command Taxonomy (Proposed)

```
brat
├── Platform Management
│   ├── setup                    # First-time platform setup
│   ├── doctor                   # Diagnostic checks
│   ├── release <ver>            # Version management
│   └── config                   # Platform configuration
│       ├── show
│       └── validate
│
├── Infrastructure (infra)
│   ├── plan <module>            # Terraform plan
│   ├── apply <module>           # Terraform apply
│   └── gcp                      # GCP-specific operations
│       ├── apis enable
│       ├── lb urlmap render
│       ├── lb urlmap import
│       ├── trigger create/update/delete
│       └── cloud-run shutdown
│
├── Deployment (deploy)
│   ├── service <name>           # Deploy single service
│   ├── services --all           # Deploy all active services
│   └── docker                   # Local Docker deployments
│       ├── up
│       ├── down
│       ├── logs
│       └── ps
│
├── Data Management (data)
│   ├── seed                     # Seed initial data
│   ├── backup                   # Backup operations
│   │   ├── list
│   │   ├── export
│   │   └── import
│   ├── migrate                  # Firestore → PostgreSQL
│   │   ├── collection <name>
│   │   └── all
│   └── validate                 # Consistency checks
│
├── Fleet Operations (fleet)
│   ├── list                     # List all Bits
│   ├── info <bit>               # Get bit.info
│   ├── health <bit>             # Get bit.health
│   ├── config <bit>             # Get bit.config
│   ├── flags <bit>              # Feature flag management
│   ├── log <bit>                # Log level control
│   ├── drain <bit>              # Graceful drain
│   └── shutdown <bit>           # Shutdown Bit
│
├── Development Tools (dev)
│   ├── code                     # Launch coding agent
│   ├── chat                     # Interactive chat
│   ├── mcp                      # MCP server management
│   │   ├── setup
│   │   └── start
│   └── context                  # Execution contexts
│       ├── list
│       ├── show <name>
│       ├── create <name>
│       ├── use <name>
│       ├── current
│       └── validate <name>
│
└── Bit Management (bit)
    └── create <name>            # Scaffold new Bit
```

### Command Mapping (Current → Proposed)

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `brat cloud-run shutdown` | `brat infra gcp cloud-run shutdown` | GCP-specific, group under infra/gcp |
| `brat trigger create` | `brat infra gcp trigger create` | GCP Cloud Build trigger |
| `brat apis enable` | `brat infra gcp apis enable` | GCP API management |
| `brat lb urlmap render` | `brat infra gcp lb urlmap render` | GCP Load Balancer |
| `brat deploy services --all` | `brat deploy services --all` | **NO CHANGE** (already clear) |
| `brat pg:backup` | `brat data backup --driver postgres` | Unified backup command |
| `brat backup export` | `brat data backup export --driver firestore` | Legacy Firestore backup |
| `brat db:validate` | `brat data validate` | Consistency checking |
| `brat dev-mcp start` | `brat dev mcp start` | MCP server operations |
| `brat mcp setup` | `brat dev mcp setup` | MCP configuration |
| `brat context list` | `brat dev context list` | Dev-time context management |
| `brat use <ctx>` | `brat dev context use <ctx>` | Context switching |
| `brat current` | `brat dev context current` | Current context |
| `brat docker up` | `brat deploy docker up` | Local deployment |

### Backward Compatibility Strategy

**Phase 1 (Sprint 359)**: Implement new structure with aliases
```bash
# New commands work
brat infra gcp apis enable

# Old commands still work (with deprecation warning)
brat apis enable
# WARNING: 'brat apis enable' is deprecated. Use 'brat infra gcp apis enable' instead.
# This alias will be removed in Sprint 365 (6 sprints / ~2 months).
```

**Phase 2 (Sprint 365)**: Remove aliases, fail with helpful message
```bash
brat apis enable
# ERROR: Command 'apis' was removed in Sprint 365.
# Use: brat infra gcp apis enable
# See: https://docs.bitbrat.dev/migration/sprint-365
```

---

## Help System Redesign

### Hierarchical Help Architecture

```
brat --help                           # Global help, shows domains
brat infra --help                     # Shows infra subcommands
brat infra gcp --help                 # Shows GCP-specific commands
brat infra gcp apis --help            # Shows API operations
brat infra gcp apis enable --help     # Shows full usage + examples
```

### Help Text Template

Every command must implement this structure:

```
NAME
    brat <domain> <command> - <one-line description>

SYNOPSIS
    brat <domain> <command> [OPTIONS] <ARGS>

DESCRIPTION
    <2-3 sentence explanation of what this command does and when to use it>

OPTIONS
    --flag <type>        <description> (default: <value>)
    --another-flag       <description> (required)

EXAMPLES
    # <Use case 1>
    $ brat <domain> <command> --flag value

    # <Use case 2>
    $ brat <domain> <command> --another-flag

SEE ALSO
    brat <related-command>
    Documentation: https://docs.bitbrat.dev/<domain>/<command>
```

### Implementation: Help Registry Pattern

```typescript
// tools/brat/src/cli/help/registry.ts
interface HelpEntry {
  name: string;
  synopsis: string;
  description: string;
  options: HelpOption[];
  examples: HelpExample[];
  seeAlso: string[];
}

class HelpRegistry {
  private static entries = new Map<string, HelpEntry>();

  static register(commandPath: string, entry: HelpEntry) {
    this.entries.set(commandPath, entry);
  }

  static get(commandPath: string): HelpEntry | undefined {
    return this.entries.get(commandPath);
  }

  static render(commandPath: string): string {
    const entry = this.get(commandPath);
    if (!entry) return `No help available for '${commandPath}'`;

    return `
NAME
    ${entry.name} - ${entry.synopsis}

SYNOPSIS
    ${entry.synopsis}

DESCRIPTION
    ${entry.description}

OPTIONS
${entry.options.map(opt => `    ${opt.flag.padEnd(20)} ${opt.description}${opt.default ? ` (default: ${opt.default})` : ''}`).join('\n')}

EXAMPLES
${entry.examples.map(ex => `    # ${ex.description}\n    $ ${ex.command}`).join('\n\n')}

SEE ALSO
${entry.seeAlso.map(ref => `    ${ref}`).join('\n')}
`.trim();
  }
}

// Usage in command files
HelpRegistry.register('infra.gcp.apis.enable', {
  name: 'brat infra gcp apis enable',
  synopsis: 'Enable required Google Cloud APIs for BitBrat platform',
  description: 'Enables all APIs defined in architecture.yaml for the target GCP project...',
  options: [
    { flag: '--project-id <id>', description: 'GCP project ID', required: true },
    { flag: '--dry-run', description: 'Preview API list without enabling', default: 'false' },
    { flag: '--json', description: 'Output as JSON', default: 'false' }
  ],
  examples: [
    {
      description: 'Enable APIs for staging environment',
      command: 'brat infra gcp apis enable --project-id my-project --context staging'
    },
    {
      description: 'Preview APIs that would be enabled',
      command: 'brat infra gcp apis enable --project-id my-project --dry-run'
    }
  ],
  seeAlso: [
    'brat infra gcp trigger create',
    'Documentation: https://docs.bitbrat.dev/infra/gcp/apis'
  ]
});
```

---

## Flag Standardization

### Naming Conventions

| Category | Convention | Examples |
|----------|------------|----------|
| Global Context | `--context`, `--project-id`, `--region` | Platform-wide identifiers |
| Boolean Flags | `--flag` (presence = true) | `--dry-run`, `--force`, `--json` |
| Value Flags | `--flag <value>` | `--output <path>`, `--level <debug>` |
| Multi-word | Kebab-case | `--bot-name`, `--log-level`, `--api-token` |

### Validation

```typescript
// tools/brat/src/cli/flags/validator.ts
interface FlagSpec {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: any;
  choices?: any[];
  validate?: (value: any) => boolean;
}

class FlagValidator {
  validate(flags: Record<string, any>, spec: FlagSpec[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const s of spec) {
      const value = flags[s.name];

      // Required check
      if (s.required && value === undefined) {
        errors.push(`Missing required flag: --${s.name}`);
      }

      // Type check
      if (value !== undefined && typeof value !== s.type) {
        errors.push(`Flag --${s.name} must be ${s.type}, got ${typeof value}`);
      }

      // Choices validation
      if (s.choices && value !== undefined && !s.choices.includes(value)) {
        errors.push(`Flag --${s.name} must be one of: ${s.choices.join(', ')}`);
      }

      // Custom validation
      if (s.validate && value !== undefined && !s.validate(value)) {
        errors.push(`Invalid value for --${s.name}: ${value}`);
      }
    }

    // Warn on unknown flags
    const knownFlags = spec.map(s => s.name);
    for (const flagName of Object.keys(flags)) {
      if (!knownFlags.includes(flagName) && !flagName.startsWith('_')) {
        warnings.push(`Unknown flag: --${flagName} (will be ignored)`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

// Usage
const spec: FlagSpec[] = [
  { name: 'context', type: 'string', required: false, default: 'local' },
  { name: 'dry-run', type: 'boolean', default: false },
  { name: 'level', type: 'string', choices: ['error', 'warn', 'info', 'debug'] }
];

const result = validator.validate(flags, spec);
if (!result.valid) {
  console.error('Flag validation failed:');
  result.errors.forEach(e => console.error(`  - ${e}`));
  process.exit(2);
}
```

---

## Implementation Strategy

### Phase 1: Foundation (Sprint 359)

**Deliverables**:
1. Help registry system (`tools/brat/src/cli/help/`)
2. Flag validator (`tools/brat/src/cli/flags/`)
3. Command router refactor (extract from index.ts)
4. Deprecation warning system

**Success Criteria**:
- All existing commands still work
- New `brat --help` shows structured output
- Flag validation catches typos

### Phase 2: Domain Migration (Sprint 360-362)

**Week 1 (Sprint 360)**: Infrastructure domain
- `brat infra plan/apply` → Keep as-is
- `brat infra gcp apis enable` (migrate `brat apis`)
- `brat infra gcp trigger create/update/delete` (migrate `brat trigger`)
- `brat infra gcp cloud-run shutdown` (migrate `brat cloud-run`)
- `brat infra gcp lb urlmap render/import` (migrate `brat lb`)

**Week 2 (Sprint 361)**: Data domain
- `brat data backup list/export/import` (unify `brat backup` + `brat pg:backup`)
- `brat data migrate collection/all` (keep as-is, rename namespace)
- `brat data validate` (migrate `brat db:validate`)
- `brat data seed` (migrate `brat seed`)

**Week 3 (Sprint 362)**: Development domain
- `brat dev code` (migrate `brat code`)
- `brat dev chat` (migrate `brat chat`)
- `brat dev mcp setup/start` (unify `brat mcp` + `brat dev-mcp`)
- `brat dev context list/show/create/use/current/validate` (migrate context commands)

### Phase 3: Cleanup (Sprint 363-365)

**Sprint 363**: Comprehensive help text
- Write help entries for all 60+ commands
- Add examples to every command
- Integration test: `brat <cmd> --help` for every command

**Sprint 364**: Testing & documentation
- Unit tests for help registry
- Unit tests for flag validator
- Update CLAUDE.md with new command structure
- Migration guide in docs

**Sprint 365**: Deprecation removal
- Remove all old command aliases
- Remove deprecated flags (`--env`, `--target`)
- Update CI/CD scripts to use new commands

---

## File Structure (Proposed)

```
tools/brat/src/
├── cli/
│   ├── index.ts                  # Minimal router (100 lines max)
│   ├── help/
│   │   ├── registry.ts           # Help system
│   │   ├── renderer.ts           # Template engine
│   │   └── entries/              # Help definitions
│   │       ├── infra.ts
│   │       ├── deploy.ts
│   │       ├── data.ts
│   │       ├── fleet.ts
│   │       └── dev.ts
│   ├── flags/
│   │   ├── validator.ts          # Flag validation
│   │   ├── parser.ts             # Unified flag parsing
│   │   └── specs.ts              # Global flag specifications
│   ├── commands/
│   │   ├── infra/
│   │   │   ├── index.ts          # Infra command router
│   │   │   ├── plan.ts
│   │   │   ├── apply.ts
│   │   │   └── gcp/
│   │   │       ├── apis.ts
│   │   │       ├── trigger.ts
│   │   │       ├── cloud-run.ts
│   │   │       └── lb.ts
│   │   ├── deploy/
│   │   │   ├── index.ts
│   │   │   ├── service.ts
│   │   │   ├── services.ts
│   │   │   └── docker/
│   │   │       ├── up.ts
│   │   │       ├── down.ts
│   │   │       ├── logs.ts
│   │   │       └── ps.ts
│   │   ├── data/
│   │   │   ├── index.ts
│   │   │   ├── backup.ts
│   │   │   ├── migrate.ts
│   │   │   ├── seed.ts
│   │   │   └── validate.ts
│   │   ├── fleet/
│   │   │   └── index.ts          # Fleet already well-organized
│   │   └── dev/
│   │       ├── index.ts
│   │       ├── code.ts
│   │       ├── chat.ts
│   │       ├── mcp.ts
│   │       └── context.ts
│   └── deprecation/
│       ├── aliases.ts            # Old → New mappings
│       └── warnings.ts           # Deprecation notices
```

---

## Testing Strategy

### Unit Tests

```typescript
// tools/brat/src/cli/help/__tests__/registry.test.ts
describe('HelpRegistry', () => {
  it('registers and retrieves help entries', () => {
    HelpRegistry.register('test.command', { ... });
    const entry = HelpRegistry.get('test.command');
    expect(entry).toBeDefined();
  });

  it('renders help text with correct format', () => {
    const rendered = HelpRegistry.render('test.command');
    expect(rendered).toContain('NAME');
    expect(rendered).toContain('SYNOPSIS');
    expect(rendered).toContain('EXAMPLES');
  });
});

// tools/brat/src/cli/flags/__tests__/validator.test.ts
describe('FlagValidator', () => {
  it('detects missing required flags', () => {
    const spec = [{ name: 'context', type: 'string', required: true }];
    const result = validator.validate({}, spec);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required flag: --context');
  });

  it('validates flag types', () => {
    const spec = [{ name: 'port', type: 'number' }];
    const result = validator.validate({ port: 'not-a-number' }, spec);
    expect(result.valid).toBe(false);
  });

  it('warns on unknown flags', () => {
    const spec = [{ name: 'known', type: 'string' }];
    const result = validator.validate({ known: 'val', unknown: 'val' }, spec);
    expect(result.warnings).toContain('Unknown flag: --unknown (will be ignored)');
  });
});
```

### Integration Tests

```bash
# Test all commands have --help
for cmd in $(brat --commands); do
  brat $cmd --help > /dev/null || echo "FAIL: $cmd"
done

# Test backward compatibility (with deprecation warnings)
brat apis enable --help 2>&1 | grep -q "WARNING.*deprecated"

# Test new commands work
brat infra gcp apis enable --help > /dev/null
```

---

## Migration Impact Analysis

### User Impact

**Breaking Changes**: None (until Sprint 365)

**Behavior Changes**:
- Deprecation warnings on old commands (non-blocking)
- `--help` now works on all subcommands
- Unknown flags now warn (previously silently ignored)

**Learning Curve**:
- New users: Learn new structure from day 1
- Existing users: Aliases work, 6-sprint grace period

### Documentation Updates

**Files to Update**:
- `CLAUDE.md`: Update all command examples
- `README.md`: Update quickstart commands
- `documentation/guides/brat-*.md`: Migrate all guides
- Sprint planning templates: Update example commands

**New Documentation**:
- `documentation/reference/brat-cli-reference.md`: Full command reference
- `documentation/guides/brat-migration-sprint-359.md`: Migration guide
- `documentation/concepts/brat-command-taxonomy.md`: Design rationale

### CI/CD Impact

**GitHub Actions**: Update all `brat` invocations
**Cloud Build**: Update cloudbuild.yaml commands
**Scripts**: Audit shell scripts in `tools/`, `scripts/`, `infrastructure/`

---

## Success Metrics

### Quantitative

- **Help Coverage**: 100% of commands respond to `--help`
- **Test Coverage**: >80% for help registry, flag validator
- **Deprecation Compliance**: 0 uses of old commands in codebase by Sprint 363
- **User Errors**: Flag validation catches >90% of typos

### Qualitative

- **Developer Experience**: New contributors can discover commands via `--help` alone
- **Consistency**: All commands follow same naming/structure patterns
- **Maintainability**: Adding new commands requires <50 lines of code

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking existing workflows | High | Medium | 6-sprint grace period, comprehensive testing |
| Documentation drift | Medium | High | Automated tests verify doc accuracy |
| User confusion during transition | Medium | Medium | Clear deprecation warnings, migration guide |
| Implementation scope creep | High | Medium | Phased rollout, strict sprint boundaries |

---

## Open Questions

1. **Should we version the CLI?** (`brat --version` shows `0.16.4`, but CLI structure isn't versioned)
2. **Do we need `brat <domain>` shortcuts?** (e.g., `brat infra` shows infra-only help)
3. **Should deprecated commands fail in CI?** (Force adoption faster)
4. **Plugin architecture?** (Allow external commands via `brat plugin install`)

---

## Appendices

### A. Command Audit Spreadsheet

See: `planning/sprint-359-brat-cli-reorganization/command-audit.csv`

### B. Help Text Examples

See: `planning/sprint-359-brat-cli-reorganization/help-examples.md`

### C. Flag Migration Matrix

See: `planning/sprint-359-brat-cli-reorganization/flag-migration.csv`

---

**Next Steps**:
1. Review this document with stakeholders
2. Approve command taxonomy (critical: can't change mid-flight)
3. Create implementation plan for Sprint 359
4. Begin Phase 1 implementation
