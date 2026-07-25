/**
 * brat infra apply [<module>]
 *
 * Sprint 362: Infrastructure command migration (Pattern 1: Simple Delegation)
 *
 * Runs Terraform apply for infrastructure modules with CI guards and post-apply hooks.
 * - CI guard: Blocks apply if CI=true or --dry-run
 * - LB post-hook: Renders and imports URL map in non-prod environments
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { synthModule } from '../../providers/cdktf-synth';
import { terraformApplyGeneric } from '../../providers/terraform';
import { loadArchitecture } from '../../config/loader';
import { renderAndWrite } from '../../lb/urlmap/renderer';
import { importUrlMap } from '../../lb/importer/importer';
import * as fs from 'fs';
import * as path from 'path';

export default class InfraApply extends BratCommand {
  static override description = 'Run Terraform apply for infrastructure modules (with CI guards)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> network --context staging',
    '<%= config.bin %> <%= command.id %> load-balancer --context dev',
    '<%= config.bin %> <%= command.id %> lb --context dev',
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
    'dry-run': Flags.boolean({
      description: 'Dry-run mode (blocks apply, runs plan only)',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(InfraApply);

    const root = this.repoRoot;
    const envName = this.context.name;

    // Get project ID
    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    // Module selection: positional arg > --module flag
    let moduleName = (args.module as string) || flags.module;

    // Module alias: lb → load-balancer
    if (moduleName === 'lb') moduleName = 'load-balancer';

    if (!moduleName) {
      this.logger.error({ status: 'missing-module' }, 'No module specified');
      this.error('No module specified. Please specify: network, load-balancer, or connectors\nExample: brat infra apply network --context staging');
    }

    // CI guard: Block apply if CI=true or --dry-run
    const ciEnv = String(process.env.CI || '').toLowerCase();
    const isCi = ciEnv === 'true' || ciEnv === '1';

    if (flags['dry-run'] || isCi) {
      this.logger.error(
        { status: 'apply-blocked', dryRun: flags['dry-run'], ci: isCi },
        'Apply is not allowed in CI or with --dry-run'
      );
      this.error(
        'Apply is not allowed in CI or with --dry-run.\n\n' +
          'To apply infrastructure changes:\n' +
          '  1. Unset CI in your local shell: unset CI\n' +
          '  2. Do not pass --dry-run\n' +
          '  3. Re-run: brat infra apply ' +
          moduleName +
          ' --context ' +
          envName
      );
    }

    // CDKTF synthesis
    this.logger.info({ action: 'infra.apply.synth', module: moduleName, env: envName }, 'Synthesizing CDKTF module');
    const synthOut = synthModule(moduleName as 'network' | 'load-balancer' | 'connectors', {
      rootDir: root,
      env: envName,
      projectId,
    });

    this.log(`Synthesized module '${moduleName}' to: ${synthOut}`);

    // Load balancer preflight (strict for prod apply)
    if (moduleName === 'load-balancer') {
      try {
        const arch: any = loadArchitecture(root);
        const lbNode: any = arch?.infrastructure?.resources?.['main-load-balancer'] || arch?.infrastructure?.['main-load-balancer'] || {};
        const ipName = lbNode?.ip || (envName === 'dev' ? 'birtrat-ip' : 'bitbrat-global-ip');
        const certName = lbNode?.cert || (envName === 'dev' ? 'bitbrat-dev-cert' : `bitbrat-cert-${envName}`);
        const strict = envName === 'prod';

        const { preflightLbExistingResources } = await import('../../providers/gcp/lb-preflight');
        const pf = await preflightLbExistingResources({ projectId, env: envName, ipName, certName, strict });

        const details = `ip:${ipName} exists=${pf.ip.exists}${pf.ip.address ? ` addr=${pf.ip.address}` : ''}; cert:${certName} exists=${pf.cert.exists}${pf.cert.status ? ` status=${pf.cert.status}` : ''}`;

        if (!pf.ok) {
          if (strict) {
            this.logger.error({ status: 'lb-preflight-failed', details }, '[lb:preflight] FAILED (prod strict)');
            this.error(`[lb:preflight] FAILED (prod strict). ${details}`);
          } else {
            this.logger.warn({ status: 'lb-preflight-warn', details }, '[lb:preflight] WARN (non-strict)');
            this.log(`⚠️  [lb:preflight] WARN (non-strict). ${details}`);
          }
        } else {
          this.logger.info({ status: 'lb-preflight-ok', details }, '[lb:preflight] OK');
          this.log(`✅ [lb:preflight] OK. ${details}`);
        }
      } catch (e: any) {
        if (envName === 'prod') {
          this.logger.error({ status: 'lb-preflight-error', error: e?.message || String(e) }, 'Preflight error in prod apply');
          this.error(`[lb:preflight] Error during preflight in prod apply: ${e?.message || String(e)}`);
        } else {
          this.logger.warn({ status: 'lb-preflight-error', error: e?.message || String(e) }, 'Non-fatal preflight error');
          this.log(`⚠️  [lb:preflight] Non-fatal error: ${e?.message || String(e)}`);
        }
      }
    }

    // Terraform apply
    this.logger.info({ action: 'infra.apply.terraform', cwd: synthOut }, 'Running terraform apply');
    const code = await terraformApplyGeneric({ cwd: synthOut, envName });

    // Check outputs.json
    const outputsPath = path.join(synthOut, 'outputs.json');
    if (fs.existsSync(outputsPath)) {
      const data = fs.readFileSync(outputsPath, 'utf8');
      this.logger.info({ status: 'outputs-captured', path: outputsPath }, 'Terraform outputs captured');
      this.log(`Terraform outputs written to ${outputsPath}`);
    } else {
      this.logger.warn({ status: 'outputs-missing', path: outputsPath }, 'outputs.json not found after apply');
      this.log(`⚠️  Expected outputs.json not found at ${outputsPath}`);
    }

    if (code !== 0) {
      this.logger.error({ status: 'failed', code }, 'Terraform apply failed');
      process.exit(code);
    }

    this.log(`✅ Terraform apply completed successfully`);

    // Post-apply hook: URL map render + import for LB module in non-prod
    if (moduleName === 'load-balancer') {
      if (envName !== 'prod') {
        try {
          this.logger.info({ action: 'lb.urlmap.post-apply', env: envName }, 'Running post-apply URL map render+import');
          this.log('');
          this.log('[lb:urlmap] Running post-apply hook: render + import...');

          // Render
          const r = renderAndWrite({ rootDir: root, env: envName as 'dev' | 'staging' | 'prod', projectId });
          this.log(`[lb:urlmap] Rendered URL map: ${r.outFile}`);

          // Import
          const res = await importUrlMap({
            projectId,
            env: envName as 'dev' | 'staging' | 'prod',
            urlMapName: r.yaml.name,
            sourceYamlPath: r.outFile,
            dryRun: false,
          });
          this.log(`[lb:urlmap] ${res.message}`);

          if (res.changed) {
            this.logger.info({ status: 'lb-urlmap-imported' }, 'URL map imported successfully');
            this.log('✅ [lb:urlmap] URL map updated in GCP');
          } else {
            this.logger.info({ status: 'lb-urlmap-no-drift' }, 'URL map already up-to-date');
            this.log('✅ [lb:urlmap] URL map already up-to-date (no drift)');
          }
        } catch (e: any) {
          this.logger.error({ status: 'lb-urlmap-failed', error: e?.message || String(e) }, 'Post-apply import failed');
          this.error(`[lb:urlmap] post-apply import failed: ${e?.message || String(e)}`);
        }
      } else {
        this.logger.info({ status: 'lb-urlmap-skip-prod' }, 'Skipping URL map import in prod (plan-only)');
        this.log('[lb:urlmap] prod environment: import skipped (plan-only).');
      }
    }
  }
}
