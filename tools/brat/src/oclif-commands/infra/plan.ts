/**
 * brat infra plan [<module>]
 *
 * Sprint 362: Infrastructure command migration (Pattern 1: Simple Delegation)
 *
 * Runs Terraform plan for infrastructure modules (network, load-balancer, connectors).
 * Synthesizes CDKTF modules before running terraform plan.
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { synthModule } from '../../providers/cdktf-synth';
import { terraformPlanGeneric } from '../../providers/terraform';
import { loadArchitecture } from '../../config/loader';
import path from 'path';

export default class InfraPlan extends BratCommand {
  static override description = 'Run Terraform plan for infrastructure modules';

  static override examples = [
    '<%= config.bin %> <%= command.id %> network --context staging',
    '<%= config.bin %> <%= command.id %> load-balancer --context dev',
    '<%= config.bin %> <%= command.id %> lb --context dev',
    '<%= config.bin %> <%= command.id %> connectors',
  ];

  static override args = {
    module: Args.string({
      description: 'Infrastructure module (network, load-balancer, connectors)',
      required: false,
      options: ['network', 'load-balancer', 'lb', 'connectors'],
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    region: Flags.string({
      description: 'GCP region',
      required: false,
    }),
    module: Flags.string({
      description: 'Infrastructure module (alternative to positional arg)',
      required: false,
      options: ['network', 'load-balancer', 'lb', 'connectors'],
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(InfraPlan);

    const root = this.repoRoot;
    const envName = this.context.name;

    // Get project ID
    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    // Module selection: positional arg > --module flag
    let moduleName = (args.module as string) || flags.module;

    // Module alias: lb → load-balancer
    if (moduleName === 'lb') moduleName = 'load-balancer';

    if (moduleName) {
      // CDKTF synthesis
      this.logger.info({ action: 'infra.plan.synth', module: moduleName, env: envName }, 'Synthesizing CDKTF module');
      const synthOut = synthModule(moduleName as 'network' | 'load-balancer' | 'connectors', {
        rootDir: root,
        env: envName,
        projectId,
      });

      this.log(`Synthesized module '${moduleName}' to: ${synthOut}`);

      // Load balancer preflight (check IP and cert exist)
      if (moduleName === 'load-balancer') {
        try {
          const arch: any = loadArchitecture(root);
          const lbNode: any = arch?.infrastructure?.resources?.['main-load-balancer'] || arch?.infrastructure?.['main-load-balancer'] || {};
          const ipName = lbNode?.ip || (envName === 'dev' ? 'birtrat-ip' : 'bitbrat-global-ip');
          const certName = lbNode?.cert || (envName === 'dev' ? 'bitbrat-dev-cert' : `bitbrat-cert-${envName}`);

          const { preflightLbExistingResources } = await import('../../providers/gcp/lb-preflight');
          const pf = await preflightLbExistingResources({ projectId, env: envName, ipName, certName, strict: false });

          const details = `ip:${ipName} exists=${pf.ip.exists}${pf.ip.address ? ` addr=${pf.ip.address}` : ''}; cert:${certName} exists=${pf.cert.exists}${pf.cert.status ? ` status=${pf.cert.status}` : ''}`;

          if (!pf.ok) {
            this.logger.warn({ status: 'lb-preflight-warn', details }, `[lb:preflight] WARN (non-strict). ${details}`);
            this.log(`⚠️  [lb:preflight] WARN (non-strict). ${details}`);
          } else {
            this.logger.info({ status: 'lb-preflight-ok', details }, `[lb:preflight] OK. ${details}`);
            this.log(`✅ [lb:preflight] OK. ${details}`);
          }
        } catch (e: any) {
          this.logger.warn({ status: 'lb-preflight-error', error: e?.message || String(e) }, 'Non-fatal preflight error');
          this.log(`⚠️  [lb:preflight] Non-fatal error: ${e?.message || String(e)}`);
        }
      }

      // Terraform plan
      this.logger.info({ action: 'infra.plan.terraform', cwd: synthOut }, 'Running terraform plan');
      const code = await terraformPlanGeneric({ cwd: synthOut, envName });

      if (code !== 0) {
        this.logger.error({ status: 'failed', code }, 'Terraform plan failed');
        process.exit(code);
      }

      this.log(`✅ Terraform plan completed successfully`);
    } else {
      // Legacy fallback: no module specified
      this.logger.warn({ status: 'legacy-fallback' }, 'No module specified, using legacy env dir fallback');
      this.log('⚠️  No module specified. Please specify: network, load-balancer, or connectors');
      this.log('Example: brat infra plan network --context staging');
      process.exit(2);
    }
  }
}
