/**
 * oclif Command: context list
 * Sprint 360: CTX-001
 *
 * Lists all execution contexts from architecture.yaml in table, JSON, or YAML format.
 * Highlights current context (from ~/.bratrc).
 *
 * Examples:
 *   brat context list
 *   brat context list --format json
 *   brat context list --format yaml
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { ContextResolver } from '../../context/context-resolver';
import { getCurrentContext } from '../../config/bratrc';
import * as yaml from 'js-yaml';

export default class ContextList extends BratCommand {
  static description = 'List all execution contexts';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --format yaml',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    format: Flags.string({
      description: 'Output format',
      options: ['table', 'json', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<any> {
    const { flags } = await this.parse(ContextList);

    const resolver = new ContextResolver(this.repoRoot);

    try {
      // Get all contexts
      const contexts = await resolver.listContexts();
      const currentContext = getCurrentContext() || 'local';

      // Build context metadata
      const contextData = await Promise.all(
        contexts.map(async (name) => {
          const raw = await resolver.getRawContext(name);
          return {
            name,
            current: name === currentContext,
            type: raw?.deployment.type,
            description: raw?.description,
            tags: raw?.tags || [],
          };
        })
      );

      // JSON output
      if (flags.format === 'json') {
        this.log(JSON.stringify(contextData, null, 2));
        return contextData;
      }

      // YAML output
      if (flags.format === 'yaml') {
        this.log(yaml.dump(contextData));
        return contextData;
      }

      // Table output
      if (contexts.length === 0) {
        this.log('No execution contexts found in architecture.yaml');
        this.log('\nRun "brat context create <name>" to create a new context.');
        return [];
      }

      // Calculate column widths
      const nameWidth = Math.max(10, ...contexts.map((n) => n.length));
      const typeWidth = 15;
      const descWidth = 50;
      const tagsWidth = 20;

      // Header
      const header = [
        'NAME'.padEnd(nameWidth),
        'TYPE'.padEnd(typeWidth),
        'DESCRIPTION'.padEnd(descWidth),
        'TAGS'.padEnd(tagsWidth),
      ].join(' ');
      this.log(header);
      this.log('='.repeat(header.length));

      // Rows
      for (const ctx of contextData.sort((a, b) => a.name.localeCompare(b.name))) {
        const nameCol = (ctx.current ? `* ${ctx.name}` : `  ${ctx.name}`).padEnd(nameWidth);
        const typeCol = (ctx.type || '-').padEnd(typeWidth);
        const descCol = (ctx.description || '-').substring(0, descWidth).padEnd(descWidth);
        const tagsCol = (ctx.tags.join(', ') || '-').substring(0, tagsWidth).padEnd(tagsWidth);

        const row = [nameCol, typeCol, descCol, tagsCol].join(' ');
        this.log(row);
      }

      // Footer
      this.log();
      this.log(`* Current context: ${currentContext}`);
      this.log();
      this.log('Use "brat use <context>" to switch contexts');
      this.log('Use "brat context show <context>" for full configuration');

      return contextData;
    } catch (error: any) {
      this.logger.error({ action: 'context.list.error', error: error.message }, 'Error listing contexts');
      this.error(`Error listing contexts: ${error.message}`, { exit: 1 });
    }
  }
}
