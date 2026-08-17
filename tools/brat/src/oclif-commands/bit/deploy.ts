/**
 * brat bit deploy
 *
 * Sprint 372: Unified Bit Deployment
 *
 * Deploy services using strategy pattern (auto-detects docker-compose or cloud-run based on context).
 * Replaces legacy brat deploy and brat docker up commands.
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { StrategyFactory } from '../../orchestration/deployment/strategy';
import type { ServiceWithName, DeployOptions } from '../../orchestration/deployment/strategy';
import { loadArchitecture, resolveServices } from '../../config/loader';
import { ContextResolver } from '../../context/context-resolver';
import type { ResolvedContext } from '../../context/types';
import * as path from 'path';

export default class BitDeploy extends BratCommand {
  static override description = 'Deploy Bit(s) to target environment using auto-detected strategy';

  static override examples = [
    '<%= config.bin %> <%= command.id %> llm-bot',
    '<%= config.bin %> <%= command.id %> llm-bot --dry-run',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --all --concurrency 3',
    '<%= config.bin %> <%= command.id %> api-gateway --force-recreate',
    '<%= config.bin %> <%= command.id %> llm-bot --image-tag v1.2.3',
  ];

  static override args = {
    service: Args.string({
      description: 'Service name to deploy (or use --all to deploy all active services)',
      required: false,
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    all: Flags.boolean({
      description: 'Deploy all active services',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Validate and plan deployment without executing',
      default: false,
    }),
    concurrency: Flags.integer({
      description: 'Maximum concurrent deployments (when using --all)',
      default: 1,
    }),
    'force-recreate': Flags.boolean({
      description: 'Force recreate containers (docker-compose only)',
      default: false,
    }),
    'no-cache': Flags.boolean({
      description: 'Build images without cache (docker-compose only)',
      default: false,
    }),
    'rebuild-base': Flags.boolean({
      description: 'Force rebuild base image regardless of cache key (docker-compose only, Sprint 375)',
      default: false,
    }),
    'image-tag': Flags.string({
      description: 'Image tag for deployment (cloud-run only, defaults to git-derived tag)',
    }),
    'allow-no-vpc': Flags.boolean({
      description: 'Skip VPC preflight checks (cloud-run only, local dev)',
      default: false,
    }),
    loki: Flags.boolean({
      description: 'Enable Loki + Promtail observability stack (docker-compose only)',
      default: false,
    }),
    'no-deps': Flags.boolean({
      description: "Don't start linked services (docker-compose only)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(BitDeploy);

    // Validation: either service name or --all must be provided
    if (!args.service && !flags.all) {
      this.error('Must specify either a service name or --all flag', { exit: 1 });
    }

    if (args.service && flags.all) {
      this.error('Cannot specify both service name and --all flag', { exit: 1 });
    }

    this.logger.info('Starting deployment');

    // Load architecture and resolve context
    // Note: this.context is already the resolved context from BratCommand.init()
    const resolvedContext = this.context;
    const contextName = resolvedContext.name;

    this.logger.debug({ contextName, deploymentType: resolvedContext.deployment.type }, 'Resolved execution context');

    // Load architecture for service resolution
    const architecture = loadArchitecture(this.repoRoot);

    // Select services to deploy
    const allServices = resolveServices(architecture);
    const servicesToDeploy: ServiceWithName[] = [];

    if (flags.all) {
      // Deploy all active services
      for (const [name, svc] of Object.entries(allServices)) {
        if (svc.active) {
          servicesToDeploy.push({ ...svc, name });
        }
      }

      if (servicesToDeploy.length === 0) {
        this.error('No active services found in architecture.yaml', { exit: 1 });
      }

      this.log(`Deploying ${servicesToDeploy.length} active service(s): ${servicesToDeploy.map(s => s.name).join(', ')}`);
    } else {
      // Deploy single service
      const serviceName = args.service!;
      const svc = allServices[serviceName];

      if (!svc) {
        this.error(`Service '${serviceName}' not found in architecture.yaml`, { exit: 1 });
      }

      if (!svc.active) {
        this.error(`Service '${serviceName}' is not active (set active: true in architecture.yaml)`, { exit: 1 });
      }

      servicesToDeploy.push({ ...svc, name: serviceName });
      this.log(`Deploying service: ${serviceName}`);
    }

    // Create deployment strategy based on context
    const strategy = StrategyFactory.create(resolvedContext.deployment.type);
    this.logger.debug({ strategy: strategy.name }, 'Using deployment strategy');

    // Build deploy options
    const deployOptions: DeployOptions = {
      dryRun: flags['dry-run'],
      forceRecreate: flags['force-recreate'],
      forceBuild: flags['no-cache'],
      rebuildBase: flags['rebuild-base'], // Sprint 375: Force rebuild base image
      concurrency: flags.concurrency,
      verbose: flags.verbose,
      // Docker Compose-specific options
      loki: flags.loki, // Enable Loki + Promtail observability stack
      noDeps: flags['no-deps'], // Don't start linked services
      // Cloud Run-specific options
      imageTag: flags['image-tag'],
      allowNoVpc: flags['allow-no-vpc'],
    };

    if (deployOptions.dryRun) {
      this.log('[DRY-RUN MODE] No actual deployment will occur');
    }

    // Deploy services
    // Use bulk deployment if strategy supports it and --all flag is used
    let results: any[];
    if (flags.all && strategy.supportsBulkDeployment && strategy.deployAll) {
      this.log(`Using bulk deployment (single docker compose up for all services)`);
      results = await strategy.deployAll(servicesToDeploy, resolvedContext, deployOptions);
    } else {
      results = await this.deployServices(servicesToDeploy, resolvedContext, strategy, deployOptions);
    }

    // Summary
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;

    this.log('');
    this.log(`Deployment complete: ${successful} succeeded, ${failed} failed`);

    if (failed > 0) {
      this.error(`${failed} deployment(s) failed`, { exit: 1 });
    }
  }

  /**
   * Deploy multiple services with concurrency control.
   */
  private async deployServices(
    services: ServiceWithName[],
    context: ResolvedContext,
    strategy: any,
    options: DeployOptions
  ): Promise<any[]> {
    const results: any[] = [];
    const concurrency = options.concurrency || 1;

    // Simple sequential deployment for now (concurrency support in future iteration)
    for (const service of services) {
      this.log('');
      this.log(`--- Deploying ${service.name} ---`);

      try {
        // PHASE 1: Prepare
        this.logger.debug({ service: service.name }, 'Preparing deployment plan');
        const plan = await strategy.prepare(service, context, options);

        // PHASE 2: Validate
        this.logger.debug({ service: service.name }, 'Validating deployment plan');
        const validation = await strategy.validate(plan);

        if (!validation.valid) {
          this.log(`[${service.name}] Validation failed:`);
          validation.errors.forEach((err: string) => this.log(`  - ERROR: ${err}`));
          results.push({
            status: 'failed',
            service: service.name,
            error: `Validation failed: ${validation.errors.join(', ')}`,
          });
          continue;
        }

        if (validation.warnings.length > 0) {
          this.log(`[${service.name}] Validation warnings:`);
          validation.warnings.forEach((warn: string) => this.log(`  - WARN: ${warn}`));
        }

        // PHASE 3: Execute
        this.logger.debug({ service: service.name }, 'Executing deployment');
        const result = await strategy.execute(plan);

        if (result.status === 'success') {
          this.log(`[${service.name}] ✓ Deployment succeeded (${result.durationMs}ms)`);
          if (result.url) {
            this.log(`[${service.name}] URL: ${result.url}`);
          }
        } else {
          this.log(`[${service.name}] ✗ Deployment failed: ${result.error}`);
        }

        results.push(result);
      } catch (error: any) {
        this.log(`[${service.name}] ✗ Deployment failed: ${error.message}`);
        results.push({
          status: 'failed',
          service: service.name,
          error: error.message,
          durationMs: 0,
        });
      }
    }

    return results;
  }
}
