/**
 * brat mcp setup
 *
 * Sprint 365: MCP/Agent command migration (Pattern 1: Simple Delegation)
 *
 * Configure BitBrat dev MCP server in Claude Code's config.
 * Delegates to cmdMcpSetup() from cli/mcp-setup.ts
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { cmdMcpSetup } from '../../cli/mcp-setup';

export default class McpSetup extends BratCommand {
  static override description = 'Configure BitBrat dev MCP server in Claude Code';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --scope project --dry-run',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    scope: Flags.string({
      description: 'Config scope',
      options: ['local', 'user', 'project'],
      default: 'user',
    }),
    'server-name': Flags.string({
      description: 'MCP server name',
      default: 'bitbrat-dev',
    }),
    'log-level': Flags.string({
      description: 'Log level for MCP server',
      options: ['error', 'warn', 'info', 'debug'],
    }),
    'audit-log': Flags.string({
      description: 'Audit log file path',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without writing config',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(McpSetup);

    this.logger.info({
      action: 'mcp.setup',
      context: this.context.name,
      scope: flags.scope,
      dryRun: flags['dry-run']
    }, 'Configuring MCP server');

    // Delegate to legacy handler
    await cmdMcpSetup({
      context: this.context.name,
      scope: flags.scope as 'local' | 'user' | 'project',
      serverName: flags['server-name'],
      logLevel: flags['log-level'] as any,
      auditLog: flags['audit-log'],
      dryRun: flags['dry-run'],
      json: flags.json,
    });
  }
}
