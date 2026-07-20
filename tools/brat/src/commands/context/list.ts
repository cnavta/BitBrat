/**
 * Sprint 349: brat context list
 *
 * Lists all execution contexts from architecture.yaml in table format.
 * Highlights current context (from ~/.bratrc).
 */

import { ContextResolver } from '../../context/context-resolver';
import { getCurrentContext } from '../../config/bratrc';

export interface ContextListOptions {
  /** Show full details (not just table) */
  verbose?: boolean;
  /** Output format (table or json) */
  format?: 'table' | 'json';
}

/**
 * Execute 'brat context list' command
 */
export async function executeContextList(options: ContextListOptions = {}): Promise<void> {
  const format = options.format || 'table';
  const repoRoot = process.cwd();
  const resolver = new ContextResolver(repoRoot);

  try {
    // Get all contexts
    const contexts = await resolver.listContexts();
    const currentContext = getCurrentContext() || 'local';

    if (format === 'json') {
      // JSON output
      const output = await Promise.all(contexts.map(async (name) => {
        const raw = await resolver.getRawContext(name);
        return {
          name,
          current: name === currentContext,
          type: raw?.deployment.type,
          description: raw?.description,
          tags: raw?.tags || [],
        };
      }));
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Table output
    if (contexts.length === 0) {
      console.log('No execution contexts found in architecture.yaml');
      console.log('\nRun "brat context create <name>" to create a new context.');
      return;
    }

    // Calculate column widths
    const nameWidth = Math.max(10, ...contexts.map(n => n.length));
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
    console.log(header);
    console.log('='.repeat(header.length));

    // Rows
    for (const name of contexts.sort()) {
      const raw = await resolver.getRawContext(name);
      const isCurrent = name === currentContext;

      const nameCol = (isCurrent ? `* ${name}` : `  ${name}`).padEnd(nameWidth);
      const typeCol = (raw?.deployment.type || '-').padEnd(typeWidth);
      const descCol = (raw?.description || '-').substring(0, descWidth).padEnd(descWidth);
      const tagsCol = (raw?.tags?.join(', ') || '-').substring(0, tagsWidth).padEnd(tagsWidth);

      const row = [nameCol, typeCol, descCol, tagsCol].join(' ');
      console.log(row);
    }

    // Footer with current context indicator
    console.log();
    console.log(`* Current context: ${currentContext}`);
    console.log();
    console.log('Use "brat use <context>" to switch contexts');
    console.log('Use "brat context show <context>" for full configuration');

  } catch (error: any) {
    console.error(`Error listing contexts: ${error.message}`);
    process.exit(1);
  }
}
