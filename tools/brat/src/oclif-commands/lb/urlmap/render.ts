/**
 * brat lb urlmap render
 *
 * Sprint 362: Load balancer command migration (Pattern 1: Simple Delegation)
 *
 * Generates load balancer URL map YAML from architecture.yaml routing rules.
 * Output: infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../../base';
import { renderAndWrite } from '../../../lb/urlmap/renderer';

export default class LbUrlmapRender extends BratCommand {
  static override description = 'Generate load balancer URL map YAML from architecture.yaml';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --out custom-urlmap.yaml',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    out: Flags.string({
      description: 'Output file path (default: infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml)',
      required: false,
    }),
    json: Flags.boolean({
      description: 'Output result as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(LbUrlmapRender);

    const root = this.repoRoot;
    const envName = this.context.name;

    // Get project ID
    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    this.logger.info({ action: 'lb.urlmap.render', env: envName, projectId }, 'Rendering URL map YAML');

    const result = renderAndWrite({
      rootDir: root,
      env: envName as 'dev' | 'staging' | 'prod',
      projectId,
      outFile: flags.out,
    });

    this.logger.info({ status: 'success', outFile: result.outFile }, 'URL map rendered successfully');

    if (flags.json) {
      this.log(JSON.stringify({ outFile: result.outFile, name: result.yaml.name }, null, 2));
    } else {
      this.log(`✅ Rendered URL map YAML → ${result.outFile}`);
      this.log('');
      this.log('URL map details:');
      this.log(`  Name: ${result.yaml.name}`);
      this.log(`  Default service: ${result.yaml.defaultService}`);
      this.log(`  Host matchers: ${result.yaml.hostRules?.length || 0}`);
    }
  }
}
