/**
 * brat cloud-run shutdown
 *
 * Sprint 364: Cloud/Platform command migration (Pattern 1: Simple Delegation)
 *
 * Shutdown Cloud Run services by scaling to zero instances.
 * Uses gcloud CLI via execCmd() helper.
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { resolveConfig } from '../../config/loader';
import { execCmd } from '../../orchestration/exec';

export default class CloudRunShutdown extends BratCommand {
  static override description = 'Shutdown Cloud Run services (scale to zero instances)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --region us-central1 --dry-run',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    region: Flags.string({
      description: 'GCP region (overrides service-specific region)',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(CloudRunShutdown);

    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';
    const cfg = resolveConfig(this.repoRoot);
    const services = Object.values(cfg.services);

    if (!services.length) {
      this.error('No services found in architecture.yaml');
    }

    this.logger.info({
      action: 'cloud-run.shutdown',
      context: this.context.name,
      serviceCount: services.length,
      projectId
    }, `Shutting down ${services.length} Cloud Run services`);

    for (const svc of services) {
      const region = flags.region || svc.region;
      const serviceName = svc.name;

      this.log(`Scaling ${serviceName} to zero instances (region: ${region})`);

      const args = [
        'run', 'services', 'update', serviceName,
        '--min-instances=0',
        '--region', region,
        '--project', projectId,
        '--quiet'
      ];

      if (flags['dry-run']) {
        this.log(`[DRY-RUN] gcloud ${args.join(' ')}`);
        continue;
      }

      try {
        const res = await execCmd('gcloud', args);
        if (res.code !== 0) {
          this.logger.error({
            service: serviceName,
            code: res.code,
            stderr: res.stderr
          }, `Failed to scale ${serviceName} to zero`);
          this.log(`❌ ${serviceName} - failed (code ${res.code})`);
        } else {
          this.logger.info({ service: serviceName }, `Successfully scaled ${serviceName} to zero`);
          this.log(`✅ ${serviceName} scaled to zero`);
        }
      } catch (e: any) {
        this.logger.error({
          service: serviceName,
          error: e?.message || String(e)
        }, `Error scaling ${serviceName} to zero`);
        this.log(`❌ ${serviceName} - error: ${e?.message || String(e)}`);
      }
    }

    this.log('');
    this.log('Cloud Run shutdown completed');
  }
}
