/**
 * brat lb urlmap import
 *
 * Sprint 362: Load balancer command migration (Pattern 1: Simple Delegation)
 *
 * Imports load balancer URL map to GCP with drift detection.
 * - Production guard: Import disabled in prod (drift detection only)
 * - Backend preflight: Verifies all referenced backend services exist
 * - Parity check: Verifies import succeeded
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../../base';
import { importUrlMap } from '../../../lb/importer/importer';
import { loadArchitecture } from '../../../config/loader';
import * as path from 'path';

export default class LbUrlmapImport extends BratCommand {
  static override description = 'Import load balancer URL map to GCP (with drift detection)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --dry-run --context dev',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview import without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(LbUrlmapImport);

    const root = this.repoRoot;
    const envName = this.context.name;

    // Get project ID
    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    // Load URL map name from architecture.yaml
    const arch: any = loadArchitecture(root);
    const lbNode: any = arch?.infrastructure?.resources?.['main-load-balancer'] || arch?.infrastructure?.['main-load-balancer'] || {};
    const urlMapName = lbNode?.name || 'bitbrat-global-url-map';

    // Source YAML path (default location)
    const sourceYamlPath = path.join(root, 'infrastructure', 'cdktf', 'lb', 'url-maps', envName, 'url-map.yaml');

    this.logger.info({ action: 'lb.urlmap.import', env: envName, urlMapName, sourceYamlPath }, 'Importing URL map');

    const res = await importUrlMap({
      projectId,
      env: envName as 'dev' | 'staging' | 'prod',
      urlMapName,
      sourceYamlPath,
      dryRun: flags['dry-run'],
    });

    this.logger.info({ status: 'import-complete', changed: res.changed, message: res.message }, res.message);

    if (res.changed) {
      if (flags['dry-run']) {
        this.log(`⚠️  [DRY-RUN] ${res.message}`);
        this.log('Run without --dry-run to execute the import.');
      } else if (envName === 'prod') {
        this.log(`⚠️  ${res.message}`);
        this.log('');
        this.log('Production import is disabled for safety.');
        this.log('To import in production:');
        this.log('  1. Review the diff manually');
        this.log('  2. Run: gcloud compute url-maps import ' + urlMapName + ' --global --source=' + sourceYamlPath);
      } else {
        this.log(`✅ ${res.message}`);
        this.log('URL map updated in GCP.');
      }
    } else {
      this.log(`✅ ${res.message}`);
      this.log('URL map already matches desired state.');
    }
  }
}
