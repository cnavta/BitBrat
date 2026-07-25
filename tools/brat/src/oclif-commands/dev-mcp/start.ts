/**
 * brat dev-mcp start
 *
 * Sprint 365: MCP/Agent command migration (Pattern 1: Simple Delegation)
 *
 * Start BitBrat MCP development server.
 * Delegates to cmdDevMcp() from cli/dev-mcp.ts
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { cmdDevMcp } from '../../cli/dev-mcp';

export default class DevMcpStart extends BratCommand {
  static override description = 'Start BitBrat MCP development server';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --log-level debug --audit-log /tmp/mcp-audit.log',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'log-level': Flags.string({
      description: 'Log level for MCP server',
      options: ['error', 'warn', 'info', 'debug'],
    }),
    'audit-log': Flags.string({
      description: 'Audit log file path',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DevMcpStart);

    this.logger.info({
      action: 'dev-mcp.start',
      context: this.context.name,
      logLevel: flags['log-level']
    }, 'Starting MCP development server');

    // Delegate to legacy handler
    await cmdDevMcp('start', {
      context: this.context.name,
      logLevel: flags['log-level'] as any,
      auditLog: flags['audit-log'],
    });
  }
}
