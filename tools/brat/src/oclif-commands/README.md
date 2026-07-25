# oclif Commands

This directory contains all oclif-based commands for the brat CLI tool.

## Directory Structure

Commands are organized by domain using oclif's automatic namespace discovery:

```
oclif-commands/
├── base.ts              # BratCommand base class (all commands extend this)
├── setup.ts             # brat setup
├── doctor.ts            # brat doctor
├── release.ts           # brat release
├── config/              # Configuration commands (brat config <subcommand>)
│   └── show.ts          #   → brat config show
├── context/             # Execution context commands (brat context <subcommand>)
│   ├── list.ts          #   → brat context list
│   ├── show.ts          #   → brat context show
│   ├── create.ts        #   → brat context create
│   └── use.ts           #   → brat context use
├── fleet/               # Fleet management commands (brat fleet <subcommand>)
│   ├── list.ts          #   → brat fleet list
│   ├── info.ts          #   → brat fleet info
│   ├── health.ts        #   → brat fleet health
│   ├── config.ts        #   → brat fleet config
│   ├── flags.ts         #   → brat fleet flags
│   ├── log.ts           #   → brat fleet log
│   ├── drain.ts         #   → brat fleet drain
│   └── shutdown.ts      #   → brat fleet shutdown
├── infra/               # Infrastructure commands (brat infra <subcommand>)
│   ├── plan.ts          #   → brat infra plan
│   ├── apply.ts         #   → brat infra apply
│   └── destroy.ts       #   → brat infra destroy
├── deploy/              # Deployment commands (brat deploy <subcommand>)
│   ├── service.ts       #   → brat deploy service
│   └── services.ts      #   → brat deploy services
├── data/                # Data operations (brat data <subcommand>)
│   ├── backup.ts        #   → brat data backup
│   ├── restore.ts       #   → brat data restore
│   └── seed.ts          #   → brat data seed
└── dev/                 # Development tooling (brat dev <subcommand>)
    ├── mcp.ts           #   → brat dev mcp
    └── code.ts          #   → brat dev code
```

## Command Naming Conventions

- **File name** → Command name (e.g., `list.ts` → `list`)
- **Directory** → Namespace/topic (e.g., `fleet/` → `fleet`)
- **Full command** = `brat <namespace> <command>` (e.g., `brat fleet list`)
- **Top-level commands** = No namespace (e.g., `setup.ts` → `brat setup`)

## Creating a New Command

1. **Extend BratCommand**:
   ```typescript
   import { BratCommand } from '../base';
   import { Flags } from '@oclif/core';

   export default class FleetList extends BratCommand {
     static description = 'List all live Bits in the fleet';

     static flags = {
       format: Flags.string({
         char: 'f',
         description: 'Output format',
         options: ['table', 'json', 'yaml'],
         default: 'table'
       })
     };

     async run(): Promise<void> {
       const { flags } = await this.parse(FleetList);

       this.logger.info('Listing fleet...');
       // Command implementation
     }
   }
   ```

2. **Place in correct namespace directory**:
   - Fleet commands → `fleet/`
   - Config commands → `config/`
   - Top-level commands → root of `oclif-commands/`

3. **oclif auto-discovers** the command (no registration required)

4. **Help text is auto-generated** from static properties

## Base Class: BratCommand

All commands extend `BratCommand` which provides:

- **Logger**: `this.logger` - Pino logger instance
- **Context**: `this.context` - Resolved execution context (local, staging, prod)
- **Config**: Access to architecture.yaml configuration
- **Dependency Injection**: `this.getDeps<T>()` for testability
- **Global Flags**: `--context`, `--verbose` inherited automatically

See `base.ts` for full implementation.

## Testing

Commands should have corresponding test files:
- `fleet/list.ts` → `fleet/list.test.ts` or `__tests__/fleet/list.test.ts`
- Use `@oclif/test` utilities for command testing
- Mock dependencies via `getDeps()` pattern

## Migration Status

**Sprint 359 PoC (In Progress)**:
- ✅ setup.ts
- ✅ doctor.ts
- ✅ fleet/list.ts
- ✅ config/show.ts
- ✅ release.ts

**Future Sprints**:
- Migrate remaining 25+ commands
- Implement backward compatibility layer
- Remove legacy CLI router after 3-sprint deprecation window

## References

- [oclif Documentation](https://oclif.io/)
- [Migration Guide](../../../../planning/sprint-359-brat-cli-reorganization/oclif-migration-guide.md)
- [Technical Architecture](../../../../planning/sprint-359-brat-cli-reorganization/technical-architecture.md)
