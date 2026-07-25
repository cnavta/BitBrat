/**
 * brat bit create
 *
 * Sprint 364: Cloud/Platform command migration (Pattern 1: Simple Delegation)
 *
 * Create a new Bit with scaffolded files (app source, test, Dockerfile, docker-compose).
 * Delegates to cmdBitCreate() from cli/bit/create.ts
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { cmdBitCreate } from '../../cli/bit/create';

export default class BitCreate extends BratCommand {
  static override description = 'Create a new Bit with scaffolded files';

  static override examples = [
    '<%= config.bin %> <%= command.id %> my-service',
    '<%= config.bin %> <%= command.id %> api-gateway --profile gateway --exposure platform+domain',
    '<%= config.bin %> <%= command.id %> custom-tools --profile mcp-server',
    '<%= config.bin %> <%= command.id %> my-service --register --active',
  ];

  static override args = {
    name: Args.string({
      description: 'Bit name (kebab-case)',
      required: true,
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    kind: Flags.string({
      description: 'Service kind',
      options: ['pipeline-service', 'gateway', 'mcp-server'],
      default: 'pipeline-service',
    }),
    profile: Flags.string({
      description: 'Capability profile',
      options: ['core', 'gateway', 'llm', 'mcp-server'],
      default: 'core',
    }),
    exposure: Flags.string({
      description: 'MCP exposure level',
      options: ['platform-only', 'platform+domain', 'none'],
    }),
    stage: Flags.string({
      description: 'Dataflow stage',
      options: ['ingest', 'route', 'analyze', 'react', 'egress', 'persist'],
    }),
    port: Flags.integer({
      description: 'HTTP port',
      default: 3000,
    }),
    entry: Flags.string({
      description: 'TypeScript entry point path',
    }),
    description: Flags.string({
      description: 'Human-readable description',
    }),
    active: Flags.boolean({
      description: 'Mark Bit as active (deployable)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Overwrite existing files',
      default: false,
    }),
    register: Flags.boolean({
      description: 'Also register in architecture.yaml',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(BitCreate);

    this.logger.info({
      action: 'bit.create',
      name: args.name,
      profile: flags.profile,
      exposure: flags.exposure,
      register: flags.register
    }, 'Creating new Bit');

    // Adapt oclif flags to legacy CLI format
    const cmd = ['bit', 'create', args.name];
    const rest: string[] = [];
    const legacyFlags: Record<string, any> = {};

    // Map oclif flags to legacy format
    if (flags.kind) legacyFlags.kind = flags.kind;
    if (flags.profile) legacyFlags.profile = flags.profile;
    if (flags.exposure) legacyFlags.exposure = flags.exposure;
    if (flags.stage) legacyFlags.stage = flags.stage;
    if (flags.port) legacyFlags.port = flags.port;
    if (flags.entry) legacyFlags.entry = flags.entry;
    if (flags.description) legacyFlags.description = flags.description;
    if (flags.active) legacyFlags.active = flags.active;
    if (flags.force) legacyFlags.force = flags.force;
    if (flags.register) legacyFlags.register = flags.register;

    // Delegate to legacy business logic
    await cmdBitCreate(cmd, rest, legacyFlags, this.logger);
  }
}
