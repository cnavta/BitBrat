/**
 * brat code
 *
 * Sprint 365: MCP/Agent command migration (Pattern 1: Simple Delegation)
 *
 * Launch coding agent with BitBrat project context.
 * Delegates to cmdCode() from cli/code/code-command.ts
 */

import { Flags } from '@oclif/core';
import { BratCommand } from './base';
import { cmdCode } from '../cli/code/code-command';

export default class Code extends BratCommand {
  static override description = 'Launch coding agent with BitBrat project context';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --list',
    '<%= config.bin %> <%= command.id %> --agent aider',
    '<%= config.bin %> <%= command.id %> --agent claude-code -- "Explain the platform"',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    agent: Flags.string({
      char: 'a',
      description: 'Coding agent to use',
      options: ['claude-code', 'aider', 'continue', 'openhands'],
    }),
    list: Flags.boolean({
      char: 'l',
      description: 'List available coding agents',
      default: false,
    }),
    'project-root': Flags.string({
      char: 'p',
      description: 'Project root directory',
    }),
  };

  // Allow pass-through arguments for agent-specific flags
  static override strict = false;

  public async run(): Promise<void> {
    const { flags, argv } = await this.parse(Code);

    this.logger.info({
      action: 'code',
      agent: flags.agent,
      list: flags.list
    }, 'Launching coding agent');

    // Build command array for legacy handler
    const cmd: string[] = ['code'];

    // Build rest array with flags and pass-through args
    const rest: string[] = [];
    if (flags.list) rest.push('--list');
    if (flags.agent) rest.push(`--agent=${flags.agent}`);
    if (flags['project-root']) rest.push(`--project-root=${flags['project-root']}`);

    // Add pass-through arguments (anything after --)
    rest.push(...(argv as string[]));

    // Delegate to legacy handler
    await cmdCode(cmd, rest);
  }
}
