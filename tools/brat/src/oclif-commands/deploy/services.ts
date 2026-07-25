/**
 * brat deploy services --all
 *
 * Sprint 362: Deploy command migration (Pattern 1: Simple Delegation)
 *
 * Deploys all active services to the target environment (Cloud Run, ECS, etc.).
 * Orchestrates build submission, VPC preflight, and concurrency control.
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { resolveConfig } from '../../config/loader';
import { selectDeployableServices, computeDeploySubstitutions } from '../../cli/index';
import { submitBuild } from '../../providers/gcp/cloudbuild';
import { Queue } from '../../orchestration/queue';
import { assertVpcPreconditions } from '../../providers/gcp/preflight';
import { deriveTag } from '../../util/git';
import { DependencyError, ConfigurationError } from '../../orchestration/errors';
import * as fs from 'fs';
import * as path from 'path';

export default class DeployServices extends BratCommand {
  static override description = 'Deploy all active services to target environment';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --dry-run --context local',
    '<%= config.bin %> <%= command.id %> --concurrency 3 --context prod',
    '<%= config.bin %> <%= command.id %> --allow-no-vpc --image-tag v1.2.3',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID (default: from architecture.yaml)',
      required: false,
    }),
    region: Flags.string({
      description: 'GCP region (default: from service config)',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview deployment without executing',
      default: false,
    }),
    concurrency: Flags.integer({
      description: 'Maximum concurrent deployments',
      default: 1,
    }),
    'allow-no-vpc': Flags.boolean({
      description: 'Skip VPC preflight checks',
      default: undefined, // Auto-determined by environment
    }),
    'image-tag': Flags.string({
      description: 'Docker image tag (default: git-derived)',
      required: false,
    }),
    repo: Flags.string({
      description: 'Artifact Registry repository name',
      default: 'bitbrat-services',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DeployServices);

    // Resolve configuration
    const root = this.repoRoot;
    const cfg = resolveConfig(root);

    // Get project ID (flag > env)
    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    // Get environment name from context
    const envName = this.context.name;

    // Select deployable services (all active services)
    const services = selectDeployableServices(Object.values(cfg.services));

    if (!services.length) {
      throw new ConfigurationError('No active services found in architecture.yaml. Set active:true to enable services.');
    }

    this.logger.info(
      { action: 'deploy.services.start', count: services.length, env: envName, concurrency: flags.concurrency },
      `Deploying ${services.length} active services`
    );

    // Create concurrency queue
    const concurrency = flags.concurrency || cfg.maxConcurrency || 1;
    const queue = new Queue(concurrency);
    const tag = flags['image-tag'] || deriveTag();
    const repoName = flags.repo;

    // Create deployment tasks
    const tasks = services.map((svc) => async () => {
      const serviceLog = this.logger.child({ service: svc.name, action: 'deploy.service' });

      // VPC preflight check (unless dry-run or allow-no-vpc)
      if (!flags['dry-run']) {
        try {
          await assertVpcPreconditions({
            projectId,
            region: flags.region || svc.region,
            env: envName,
            allowNoVpc: flags['allow-no-vpc'],
            dryRun: flags['dry-run'],
          });
        } catch (e: any) {
          throw new DependencyError(e?.message || String(e));
        }
      } else {
        serviceLog.info({ status: 'preflight-skip', reason: 'dry-run' }, 'Skipping VPC preflight in dry-run');
      }

      const start = Date.now();
      serviceLog.info({ status: 'start' }, 'Starting build+deploy');

      const isExternalImage = !!svc.image;
      const currentCbConfigPath = isExternalImage
        ? path.join(root, 'cloudbuild.deploy-only.yaml')
        : path.join(root, 'cloudbuild.oauth-flow.yaml');

      // Dockerfile inference (only if not using external image)
      let dockerfile = '';
      if (!isExternalImage) {
        dockerfile = `Dockerfile.${svc.name}`;
        const kebab = svc.name.replace(/\s+/g, '-');
        if (!fs.existsSync(path.join(root, dockerfile))) {
          const alt = `Dockerfile.${kebab}`;
          if (fs.existsSync(path.join(root, alt))) {
            dockerfile = alt;
          } else {
            serviceLog.warn({ status: 'skipped', reason: 'dockerfile-not-found' }, 'Skipping service: Dockerfile not found');
            return { service: svc.name, skipped: true };
          }
        }
      }

      // Load environment variables for this service
      const { loadEnvKv, synthesizeSecretMapping, filterEnvKvAgainstSecrets } = await import('../../config/loader');
      const { resolveSecretMappingToNumeric } = await import('../../providers/gcp/secrets');

      const envKv = loadEnvKv(envName, svc.name);
      let secretMap = synthesizeSecretMapping(svc.secrets);
      if (secretMap) {
        try {
          const resolved = await resolveSecretMappingToNumeric(secretMap, projectId);
          if (resolved) secretMap = resolved;
        } catch (e: any) {
          if (!flags['dry-run']) {
            throw new DependencyError(e?.message || String(e));
          } else {
            serviceLog.warn(
              { status: 'dry-run', reason: 'missing-secret-versions', error: e?.message || String(e) },
              'DRY-RUN: would fail due to missing secret versions'
            );
          }
        }
      }

      // Validate required env keys
      if (svc.envKeys && svc.envKeys.length) {
        const runtimeProvided = new Set<string>(['K_REVISION']);
        const present = new Set<string>(
          (envKv || '')
            .split(';')
            .filter(Boolean)
            .map((p) => p.split('=')[0])
        );
        const missing = (svc.envKeys || []).filter((k) => !runtimeProvided.has(k)).filter((k) => !present.has(k));
        if (missing.length) {
          const msg = `Missing required env keys for ${svc.name}: ${missing.join(', ')}. Provide these via env overlay or Secret Manager.`;
          if (!flags['dry-run']) {
            throw new ConfigurationError(msg);
          } else {
            serviceLog.warn({ status: 'dry-run', missing }, msg);
          }
        }
      }

      const envFiltered = filterEnvKvAgainstSecrets(envKv, secretMap);

      // Write env vars to file to avoid Cloud Build --substitutions parsing issues
      let envVarsFileRel = '';
      try {
        const cbDir = path.join(root, '.cloudbuild');
        if (!fs.existsSync(cbDir)) fs.mkdirSync(cbDir, { recursive: true });
        const safeName = String(svc.name).replace(/[^A-Za-z0-9_.-]+/g, '-');
        envVarsFileRel = path.join('.cloudbuild', `env.${safeName}.kv`);
        fs.writeFileSync(path.join(root, envVarsFileRel), envFiltered || '', 'utf8');
      } catch (e: any) {
        envVarsFileRel = '';
        serviceLog.warn(
          { status: 'warn', reason: 'env-file-write-failed', error: e?.message || String(e) },
          'Falling back to _ENV_VARS_ARG substitution'
        );
      }

      // Compute effective allow-unauthenticated policy
      const ingressPolicy = 'internal-and-cloud-load-balancing';
      const vpcConnectorName = `brat-conn-${flags.region || svc.region}-${envName}`;
      const effectiveAllowUnauth = !!(svc.allowUnauth || ingressPolicy === 'internal-and-cloud-load-balancing' || vpcConnectorName);

      serviceLog.info(
        {
          status: 'policy',
          allowUnauthConfigured: svc.allowUnauth,
          effectiveAllowUnauth,
          ingress: ingressPolicy,
          vpcConnector: vpcConnectorName,
        },
        'Computed effective allowUnauthenticated policy'
      );

      // Compute substitutions
      const substitutions = computeDeploySubstitutions({
        svc,
        repoName,
        region: flags.region,
        tag,
        allowUnauth: effectiveAllowUnauth,
        dockerfile,
        envVarsArg: envVarsFileRel ? '' : envFiltered,
        envVarsFile: envVarsFileRel,
        secretSetArg: secretMap,
        ingressPolicy,
        vpcConnectorName,
        image: svc.image,
      });

      if (flags['dry-run']) {
        serviceLog.info({ status: 'dry-run', substitutions }, 'DRY-RUN: Would submit Cloud Build');
        return { service: svc.name, dryRun: true };
      }

      // Submit Cloud Build
      const res = await submitBuild({
        projectId,
        configPath: currentCbConfigPath,
        substitutions,
        cwd: root,
        dryRun: false,
        onStdout: (chunk) => {
          chunk.split(/\r?\n/).filter(Boolean).forEach((line) => serviceLog.info({ stream: 'stdout' }, line));
        },
        onStderr: (chunk) => {
          chunk.split(/\r?\n/).filter(Boolean).forEach((line) => serviceLog.warn({ stream: 'stderr' }, line));
        },
      });

      const durationMs = Date.now() - start;
      if (res.code !== 0) {
        serviceLog.error({ status: 'failed', code: res.code, durationMs }, 'Cloud Build failed');
        throw new DependencyError(`Cloud Build failed for ${svc.name}: ${res.stderr || res.stdout}`);
      }

      serviceLog.info({ status: 'success', durationMs }, 'Build+deploy finished');
      return { service: svc.name, ok: true };
    });

    // Execute all tasks with concurrency control
    const results = await Promise.all(tasks.map((t) => queue.add(t)));
    const failed = results.filter((r: any) => r && r.ok === false);

    if (failed.length) {
      this.logger.error({ action: 'deploy.services.failed', count: failed.length }, `${failed.length} deployments failed`);
      process.exit(1);
    }

    this.logger.info({ action: 'deploy.services.complete' }, 'All deployments completed successfully');
  }
}
