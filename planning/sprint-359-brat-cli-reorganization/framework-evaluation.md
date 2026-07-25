# CLI Framework Evaluation

**Sprint**: 359
**Author**: Architect
**Date**: 2026-07-24

## Executive Summary

This document evaluates whether to adopt an existing CLI framework or refactor our custom implementation. After analyzing the top 5 Node.js CLI frameworks against our requirements, **I recommend adopting oclif** for its enterprise-grade architecture, plugin system, and alignment with our domain-driven design goals.

**TL;DR**:
- **Recommendation**: oclif (Open CLI Framework)
- **Migration Effort**: 2-3 sprints (vs 3-4 sprints custom)
- **Long-term ROI**: High (plugin system, auto-generated help, testing framework)
- **Risk**: Medium (new dependency, team learning curve)

---

## Framework Comparison Matrix

| Framework | Stars | Maintainer | Plugin System | Help Generation | Flag Validation | Subcommands | TypeScript | Last Update |
|-----------|-------|------------|---------------|-----------------|-----------------|-------------|------------|-------------|
| **oclif** | 9.0k | Salesforce | ✅ Built-in | ✅ Auto | ✅ Zod/io-ts | ✅ Unlimited depth | ✅ First-class | Active (2026) |
| **Commander.js** | 27k | TJ Holowaychuk | ❌ Manual | ⚠️ Basic | ⚠️ Basic | ✅ Nested | ⚠️ @types only | Active (2026) |
| **yargs** | 11k | Community | ❌ Manual | ✅ Auto | ✅ Built-in | ✅ Nested | ⚠️ @types only | Active (2026) |
| **Caporal** | 2.8k | Community | ❌ None | ✅ Auto | ✅ Built-in | ✅ Nested | ❌ No | Stale (2021) |
| **Ink** | 26k | Vadim Demedes | N/A (TUI) | N/A | N/A | N/A | ✅ First-class | Active (2026) |
| **Custom** | - | BitBrat | ❌ None | ❌ Manual | ❌ None | ✅ Custom | ✅ Native | - |

---

## Detailed Framework Analysis

### 1. oclif (Open CLI Framework)

**Description**: Enterprise-grade CLI framework by Salesforce, used by Heroku CLI, Twilio CLI, Adobe CLI.

**Pros**:
- ✅ **Plugin architecture**: Extends CLI without modifying core
- ✅ **Auto-generated help**: `--help` at every level (exactly what we need)
- ✅ **TypeScript-first**: Classes, decorators, type safety
- ✅ **Flag validation**: Built-in with custom parsers
- ✅ **Testing framework**: `@oclif/test` for integration tests
- ✅ **Multi-command structure**: Perfect for domain-driven design
- ✅ **Hooks system**: Pre/post command execution
- ✅ **Update notifications**: Auto-check for CLI updates
- ✅ **Active maintenance**: Salesforce backing

**Cons**:
- ❌ Learning curve (new patterns for team)
- ❌ Opinionated structure (but aligns with our goals)
- ❌ Larger bundle size (~2MB vs custom ~100KB)

**Architecture Fit**:
```typescript
// Perfect match for our domain-driven design
src/commands/
├── infra/
│   ├── plan.ts          // brat infra plan
│   ├── apply.ts         // brat infra apply
│   └── gcp/
│       ├── apis.ts      // brat infra gcp apis
│       └── trigger.ts   // brat infra gcp trigger
├── deploy/
│   ├── service.ts       // brat deploy service
│   └── docker/
│       └── up.ts        // brat deploy docker up
└── fleet/
    └── list.ts          // brat fleet list

// Each command is a class
export default class InfraGcpApis extends Command {
  static description = 'Enable required Google Cloud APIs';

  static flags = {
    'project-id': Flags.string({required: true}),
    'dry-run': Flags.boolean({default: false}),
  };

  async run() {
    const {flags} = await this.parse(InfraGcpApis);
    // Implementation
  }
}
```

**Migration Effort**: Medium (2-3 sprints)
- Sprint 359: Setup oclif, migrate 5-10 commands
- Sprint 360: Migrate remaining commands
- Sprint 361: Plugin system, advanced features

**Example Projects**:
- Heroku CLI: https://github.com/heroku/cli
- Twilio CLI: https://github.com/twilio/twilio-cli
- Salesforce CLI: https://github.com/salesforcecli/cli

---

### 2. Commander.js

**Description**: Minimalist, battle-tested CLI framework. Most popular in Node.js ecosystem.

**Pros**:
- ✅ **Simple API**: Easy to learn
- ✅ **Lightweight**: ~50KB
- ✅ **Flexible**: Don't have to use all features
- ✅ **Nested subcommands**: `program.command('foo').command('bar')`
- ✅ **Huge community**: 27k stars, tons of examples

**Cons**:
- ❌ **No plugin system**: Must build manually
- ❌ **Basic help generation**: Requires manual formatting for advanced layouts
- ❌ **No TypeScript support**: Just @types, not native
- ❌ **Flag validation**: Manual implementation
- ❌ **No testing framework**: Use generic test libraries

**Architecture Fit**:
```typescript
// Simpler but more manual
const program = new Command();

program
  .command('infra')
  .command('gcp')
  .command('apis')
  .option('--project-id <id>', 'GCP project ID')
  .option('--dry-run', 'Dry run mode')
  .action(async (options) => {
    // Implementation
  });
```

**Migration Effort**: Low-Medium (1-2 sprints)
- Sprint 359: Migrate all commands, setup structure
- Sprint 360: Custom help system, flag validation

**Verdict**: Good for simple CLIs, but we'd end up building most of what oclif provides.

---

### 3. yargs

**Description**: Feature-rich argument parser with advanced configuration.

**Pros**:
- ✅ **Rich flag parsing**: Best-in-class argument handling
- ✅ **Auto-generated help**: Good quality
- ✅ **Middleware system**: Pre/post command hooks
- ✅ **Validation**: Built-in schema validation
- ✅ **Completion**: Bash/zsh completion generation

**Cons**:
- ❌ **Complex API**: Steep learning curve
- ❌ **Imperative style**: Not as clean as oclif classes
- ❌ **No plugin system**: Manual implementation
- ❌ **TypeScript**: @types only, not native

**Architecture Fit**:
```typescript
// More imperative, less structured
yargs(process.argv.slice(2))
  .command('infra', 'Infrastructure commands', (yargs) => {
    return yargs.command('gcp', 'GCP commands', (yargs) => {
      return yargs.command('apis', 'API management', (yargs) => {
        return yargs
          .option('project-id', {type: 'string', demandOption: true})
          .option('dry-run', {type: 'boolean', default: false});
      }, async (argv) => {
        // Implementation
      });
    });
  })
  .parse();
```

**Migration Effort**: Medium (2 sprints)
- Sprint 359: Migrate all commands
- Sprint 360: Polish help, testing

**Verdict**: Powerful but API complexity doesn't justify over oclif.

---

### 4. Custom Implementation (Current Approach)

**Pros**:
- ✅ **Full control**: No constraints
- ✅ **Lightweight**: Only what we need
- ✅ **No dependencies**: One less thing to maintain
- ✅ **Team familiarity**: We built it

**Cons**:
- ❌ **No plugin system**: Hard to extend
- ❌ **Manual help generation**: Labor-intensive
- ❌ **No testing framework**: Generic tests only
- ❌ **Reinventing the wheel**: Building what frameworks provide
- ❌ **Maintenance burden**: We own bugs and features
- ❌ **No auto-completion**: Would need to build

**Migration Effort**: Medium-High (3-4 sprints)
- Sprint 359: Help registry, flag validator
- Sprint 360-362: Domain migration
- Sprint 363-365: Polish, testing

**Verdict**: Viable, but high opportunity cost. We'd build 80% of oclif.

---

### 5. Ink (React-based TUI)

**Description**: Build CLIs with React components. Great for interactive TUIs.

**Pros**:
- ✅ **React paradigm**: Familiar to many devs
- ✅ **Rich UIs**: Progress bars, spinners, tables
- ✅ **Component reuse**: Build UI library

**Cons**:
- ❌ **Wrong tool**: We need a CLI, not a TUI
- ❌ **Overkill**: Most commands are non-interactive
- ❌ **Performance**: React overhead for simple commands

**Verdict**: Not applicable for `brat`. Consider for `brat chat` or interactive wizards only.

---

## Requirements Scoring

| Requirement | oclif | Commander | yargs | Custom |
|-------------|-------|-----------|-------|--------|
| Hierarchical help | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| Subcommand nesting | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Flag validation | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐ |
| TypeScript support | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Plugin system | ⭐⭐⭐⭐⭐ | ⭐ | ⭐ | ⭐ |
| Testing framework | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ |
| Deprecation warnings | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Migration effort | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| Long-term maintenance | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **TOTAL** | **43/45** | **27/45** | **30/45** | **27/45** |

---

## Recommendation: oclif

### Why oclif?

1. **Perfect architectural alignment**
   - Domain-driven command structure maps 1:1 to file structure
   - Plugin system enables future extensibility (e.g., `brat plugin install @bitbrat/slack`)
   - TypeScript-first matches our codebase

2. **Auto-generated help solves our #1 problem**
   - Every command gets `--help` for free
   - Consistent formatting across all commands
   - Examples, flags, descriptions all declared in code

3. **Enterprise-proven**
   - Heroku, Twilio, Adobe, Shopify all use it
   - Backed by Salesforce (not going away)
   - Large plugin ecosystem to learn from

4. **Future-proofing**
   - Plugin system enables community extensions
   - Hooks enable middleware (auth, telemetry, etc.)
   - Auto-update notifications for users

5. **Testing**
   - `@oclif/test` provides helpers for command testing
   - Mock flags, capture output, test help text
   - Integration test examples from Heroku CLI

### Migration Strategy

**Sprint 359: Foundation**
```bash
npm install @oclif/core @oclif/test
npm install --save-dev @oclif/plugin-help @oclif/plugin-plugins

# Setup oclif structure
tools/brat/
├── package.json          # Add oclif config
├── bin/
│   └── run               # oclif entry point
└── src/
    ├── commands/         # oclif auto-discovers
    │   ├── setup.ts
    │   ├── doctor.ts
    │   └── fleet/
    │       └── list.ts
    └── base-command.ts   # Custom base class
```

**Migrate 5 commands** (proof of concept):
- `brat setup` → Low complexity, standalone
- `brat doctor` → Low complexity, standalone
- `brat fleet list` → Medium complexity, good test case
- `brat config show` → Low complexity
- `brat release` → Medium complexity

**Sprint 360: Bulk Migration**
- Migrate remaining 25+ commands
- Setup deprecation aliases (oclif hooks)
- Comprehensive testing

**Sprint 361: Polish**
- Plugin system for future extensions
- Auto-completion (bash/zsh)
- Update documentation

### Code Example: Before/After

**Before (Current)**:
```typescript
// tools/brat/src/cli/index.ts (excerpt)
if (c1 === 'fleet') {
  const { cmdFleet } = require('./fleet');
  await cmdFleet(cmd, rest, flags);
  return;
}

// tools/brat/src/cli/fleet.ts
export async function cmdFleet(cmd: string[], rest: string[], flags: GlobalFlags) {
  const subcommand = cmd[1];
  if (subcommand === 'list') {
    // Implementation inline
  }
}
```

**After (oclif)**:
```typescript
// tools/brat/src/commands/fleet/list.ts
import {Command, Flags} from '@oclif/core';

export default class FleetList extends Command {
  static description = 'List all active Bits in the fleet';

  static examples = [
    '$ brat fleet list',
    '$ brat fleet list --json',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run() {
    const {flags} = await this.parse(FleetList);
    // Implementation
  }
}
```

**Help output (auto-generated)**:
```bash
$ brat fleet list --help

List all active Bits in the fleet

USAGE
  $ brat fleet list [--json]

FLAGS
  --json  Output as JSON

EXAMPLES
  $ brat fleet list
  $ brat fleet list --json
```

### Backward Compatibility via oclif Hooks

```typescript
// tools/brat/src/hooks/deprecation.ts
import {Hook} from '@oclif/core';

const aliases: Record<string, string> = {
  'apis enable': 'infra gcp apis enable',
  'trigger create': 'infra gcp trigger create',
  'pg:backup': 'data backup --driver postgres',
};

export const hook: Hook<'prerun'> = async function (opts) {
  const commandPath = opts.Command.id;
  const newCommand = aliases[commandPath];

  if (newCommand) {
    this.warn(`DEPRECATED: 'brat ${commandPath}' is deprecated.`);
    this.warn(`Use: 'brat ${newCommand}' instead.`);
    this.warn('This alias will be removed in Sprint 365 (~2 months).');
    this.warn('');
  }
};
```

---

## Alternative: Hybrid Approach

If oclif feels too risky, we could do **Phase 1 with Commander.js**:

**Pros**:
- Faster migration (1 sprint vs 2-3)
- Smaller learning curve
- Keep custom help system

**Cons**:
- Still need to build plugin system manually
- No testing framework
- Less future-proof

**Recommendation**: Only if we're extremely time-constrained. oclif's ROI justifies the extra sprint.

---

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Team learning curve | Medium | Low | Pair programming, oclif examples abundant |
| Migration bugs | Medium | Medium | Phased rollout, comprehensive testing |
| Bundle size increase | High | Low | Acceptable for CLI tool (not web bundle) |
| Framework abandonment | Low | High | Salesforce-backed, widely adopted |
| Breaking changes | Low | Medium | Deprecation warnings, 6-sprint grace period |

---

## Decision Matrix

| Factor | Weight | oclif Score | Custom Score | Weighted oclif | Weighted Custom |
|--------|--------|-------------|--------------|----------------|-----------------|
| Solves help problem | 30% | 10/10 | 5/10 | 3.0 | 1.5 |
| Migration effort | 20% | 6/10 | 7/10 | 1.2 | 1.4 |
| Long-term maintenance | 25% | 10/10 | 4/10 | 2.5 | 1.0 |
| Plugin extensibility | 15% | 10/10 | 2/10 | 1.5 | 0.3 |
| Testing support | 10% | 10/10 | 5/10 | 1.0 | 0.5 |
| **TOTAL** | 100% | - | - | **9.2/10** | **4.7/10** |

---

## Final Recommendation

**Adopt oclif** for the brat CLI reorganization.

**Rationale**:
1. Solves 90% of our problems out-of-the-box
2. Enterprise-proven architecture
3. Better long-term maintainability
4. Plugin system enables future growth
5. 2-3 sprint migration is acceptable given benefits

**Next Steps**:
1. Get stakeholder buy-in on oclif adoption
2. Create Sprint 359 implementation plan with oclif
3. Setup proof-of-concept (5 commands)
4. Evaluate after Sprint 359, adjust if needed

---

## Appendices

### A. oclif Resources

- **Docs**: https://oclif.io/docs/introduction
- **GitHub**: https://github.com/oclif/oclif
- **Examples**: https://github.com/oclif/example-multi-ts
- **Community**: https://github.com/oclif/oclif/discussions

### B. Migration Checklist

- [ ] Install oclif dependencies
- [ ] Setup bin/run entry point
- [ ] Configure package.json for oclif
- [ ] Create base command class
- [ ] Migrate 5 proof-of-concept commands
- [ ] Setup testing with @oclif/test
- [ ] Document migration patterns
- [ ] Create deprecation hook system
- [ ] Bulk migrate remaining commands
- [ ] Update all documentation

### C. Proof-of-Concept Commands

1. `brat setup` - Standalone, no subcommands
2. `brat doctor` - Standalone, simple flags
3. `brat fleet list` - Has subcommands, good complexity
4. `brat config show` - Reads state, outputs formatted text
5. `brat release` - Complex validation, version parsing

These 5 commands cover the range of patterns we'll encounter.
