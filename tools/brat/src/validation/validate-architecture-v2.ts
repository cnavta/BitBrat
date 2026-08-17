#!/usr/bin/env node
/**
 * Architecture.yaml v2 Schema Validation Script
 *
 * Validates that architecture.yaml v2 schema is correctly defined:
 * - platform.infrastructure section is complete
 * - All providers implement required capabilities
 * - Constraints are satisfied
 * - All service dependencies can be resolved
 *
 * Exit codes:
 * - 0: Validation passed
 * - 1: Validation failed
 * - 2: Usage error
 *
 * Usage:
 *   npm run validate-arch-v2
 *   node tools/brat/src/validation/validate-architecture-v2.ts
 *
 * @module validation/validate-architecture-v2
 */

import * as path from 'path';
import { InfrastructureRegistry } from '../infrastructure/registry';
import type { ServiceMetadata } from '../infrastructure/types';
import * as yaml from 'yaml';
import * as fs from 'fs';

interface ValidationError {
  severity: 'error' | 'warning';
  category: string;
  message: string;
  context?: Record<string, any>;
}

class ArchitectureV2Validator {
  private errors: ValidationError[] = [];
  private warnings: ValidationError[] = [];
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  /**
   * Run all validation checks
   */
  validate(): boolean {
    console.log('🔍 Validating architecture.yaml v2 schema...\n');

    // Step 1: Load architecture.yaml
    console.log('📂 Loading architecture.yaml...');
    const architecture = this.loadArchitecture();
    if (!architecture) {
      this.addError('loading', 'Failed to load architecture.yaml');
      return false;
    }
    console.log('✅ Loaded successfully\n');

    // Step 2: Validate platform section
    console.log('🏗️  Validating platform.infrastructure...');
    this.validatePlatformSection(architecture);
    console.log('');

    // Step 3: Validate provider implementations
    console.log('🐳 Validating infrastructure providers...');
    this.validateProviders(architecture);
    console.log('');

    // Step 4: Validate execution contexts
    console.log('⚙️  Validating execution contexts...');
    this.validateExecutionContexts(architecture);
    console.log('');

    // Step 5: Validate service dependencies
    console.log('🔗 Validating service dependencies...');
    this.validateServiceDependencies(architecture);
    console.log('');

    // Print results
    this.printResults();

    return this.errors.length === 0;
  }

  private loadArchitecture(): any {
    try {
      const archPath = path.join(this.repoRoot, 'architecture.yaml');
      const content = fs.readFileSync(archPath, 'utf8');
      return yaml.parse(content);
    } catch (error) {
      this.addError('loading', `Failed to load architecture.yaml: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private validatePlatformSection(architecture: any): void {
    if (!architecture.platform) {
      this.addError('platform', 'Missing platform section');
      return;
    }

    // Check version
    if (architecture.platform.version !== '2.0') {
      this.addError('platform', `Expected platform.version = "2.0", got "${architecture.platform.version}"`);
    } else {
      console.log('  ✓ platform.version = "2.0"');
    }

    // Check infrastructure section
    if (!architecture.platform.infrastructure) {
      this.addError('platform', 'Missing platform.infrastructure section');
      return;
    }

    const infra = architecture.platform.infrastructure;

    // Validate required capabilities
    const requiredCapabilities = ['messaging', 'caching', 'persistence'];
    for (const capability of requiredCapabilities) {
      if (!infra[capability]) {
        this.addError('platform', `Missing platform.infrastructure.${capability}`);
      } else {
        const cap = infra[capability];

        // Check required fields
        if (cap.required === undefined) {
          this.addWarning('platform', `platform.infrastructure.${capability}.required not specified`);
        }
        if (!cap.capabilities || cap.capabilities.length === 0) {
          this.addWarning('platform', `platform.infrastructure.${capability}.capabilities empty`);
        }
        if (!cap.config) {
          this.addWarning('platform', `platform.infrastructure.${capability}.config not defined`);
        }
        if (!cap.constraints) {
          this.addWarning('platform', `platform.infrastructure.${capability}.constraints not defined`);
        }
        if (!cap.intent || cap.intent.length === 0) {
          this.addWarning('platform', `platform.infrastructure.${capability}.intent not documented`);
        }

        console.log(`  ✓ platform.infrastructure.${capability} defined`);
      }
    }
  }

  private validateProviders(architecture: any): void {
    if (!architecture.infrastructure) {
      this.addError('providers', 'Missing infrastructure section');
      return;
    }

    const providers = architecture.infrastructure;
    const platformInfra = architecture.platform?.infrastructure || {};

    // Check Docker provider (required)
    if (!providers.docker) {
      this.addError('providers', 'Missing infrastructure.docker provider');
      return;
    }

    const dockerProvider = providers.docker;
    const requiredCapabilities = ['messaging', 'caching', 'persistence'];

    for (const capability of requiredCapabilities) {
      if (!dockerProvider[capability]) {
        this.addError('providers', `infrastructure.docker.${capability} not implemented`);
      } else {
        const impl = dockerProvider[capability];

        // Validate implementation structure
        if (!impl.service && !impl.type) {
          this.addError('providers', `infrastructure.docker.${capability} missing service or type`);
        }
        if (!impl.image) {
          this.addWarning('providers', `infrastructure.docker.${capability} missing image`);
        }
        if (!impl.healthCheck) {
          this.addWarning('providers', `infrastructure.docker.${capability} missing healthCheck`);
        }
        if (!impl.intent || impl.intent.length === 0) {
          this.addWarning('providers', `infrastructure.docker.${capability} missing intent`);
        }

        // Validate constraint satisfaction
        const platformCap = platformInfra[capability];
        if (platformCap?.constraints) {
          this.validateConstraints(capability, platformCap.constraints, impl.config || {});
        }

        console.log(`  ✓ infrastructure.docker.${capability} implemented`);
      }
    }

    // Validate Docker provider metadata
    if (!dockerProvider.config) {
      this.addWarning('providers', 'infrastructure.docker.config not defined');
    }
    if (!dockerProvider.constraints) {
      this.addWarning('providers', 'infrastructure.docker.constraints not defined');
    }
    if (!dockerProvider.intent || dockerProvider.intent.length === 0) {
      this.addWarning('providers', 'infrastructure.docker.intent not documented');
    }
  }

  private validateConstraints(capability: string, constraints: any, config: any): void {
    // Validate minMemory constraint
    if (constraints.minMemory && config.maxmemory) {
      const minBytes = this.parseMemoryString(constraints.minMemory);
      const maxBytes = this.parseMemoryString(config.maxmemory);
      if (maxBytes < minBytes) {
        this.addError('constraints', `${capability}: maxmemory (${config.maxmemory}) < minMemory (${constraints.minMemory})`);
      }
    }

    // Validate requireDurability/requirePersistence
    if ((constraints.requireDurability || constraints.requirePersistence) &&
        !config.appendonly && !config.persistence && !config.jetstream) {
      this.addWarning('constraints', `${capability}: requireDurability/requirePersistence not satisfied (no persistence configured)`);
    }
  }

  private parseMemoryString(memStr: string): number {
    const match = memStr.match(/^(\d+)(mb|gb|tb)?$/i);
    if (!match) return 0;

    const value = parseInt(match[1], 10);
    const unit = (match[2] || '').toLowerCase();

    switch (unit) {
      case 'gb': return value * 1024 * 1024 * 1024;
      case 'mb': return value * 1024 * 1024;
      case 'tb': return value * 1024 * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  private validateExecutionContexts(architecture: any): void {
    if (!architecture.executionContexts) {
      this.addError('contexts', 'Missing executionContexts section');
      return;
    }

    const contexts = architecture.executionContexts;
    const requiredContexts = ['local', 'staging'];

    for (const contextName of requiredContexts) {
      if (!contexts[contextName]) {
        this.addWarning('contexts', `Missing executionContext "${contextName}"`);
        continue;
      }

      const context = contexts[contextName];

      // Check infrastructure configuration
      if (!context.infrastructure) {
        this.addWarning('contexts', `executionContexts.${contextName}.infrastructure not defined`);
        continue;
      }

      if (!context.infrastructure.provider) {
        this.addError('contexts', `executionContexts.${contextName}.infrastructure.provider not specified`);
      } else {
        console.log(`  ✓ executionContexts.${contextName}.infrastructure.provider = "${context.infrastructure.provider}"`);
      }
    }
  }

  private validateServiceDependencies(architecture: any): void {
    if (!architecture.services) {
      this.addError('services', 'Missing services section');
      return;
    }

    const services = architecture.services;
    const activeServices: ServiceMetadata[] = [];

    // Collect active services
    for (const [name, service] of Object.entries(services)) {
      const svc = service as any;
      if (svc.active) {
        activeServices.push({
          name,
          active: true,
          dependencies: svc.dependencies,
        });
      }
    }

    console.log(`  Found ${activeServices.length} active services`);

    // Validate dependencies can be resolved
    try {
      const result = InfrastructureRegistry.validateDependencies(
        this.repoRoot,
        'local', // Validate against local context
        activeServices
      );

      if (!result.valid) {
        for (const error of result.errors) {
          this.addError('dependencies', error);
        }
      }

      for (const warning of result.warnings) {
        this.addWarning('dependencies', warning);
      }

      if (result.valid) {
        console.log('  ✓ All service dependencies resolvable');
      }
    } catch (error) {
      this.addError('dependencies', `Dependency validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check that key platform services have infrastructure dependencies
    const keyServices = ['ingress-egress', 'auth', 'llm-bot', 'event-router', 'persistence', 'tool-gateway'];
    for (const serviceName of keyServices) {
      const service = services[serviceName] as any;
      if (service && service.active) {
        if (!service.dependencies?.infrastructure) {
          this.addWarning('services', `Active service "${serviceName}" missing dependencies.infrastructure`);
        } else {
          console.log(`  ✓ ${serviceName}.dependencies.infrastructure defined (${service.dependencies.infrastructure.join(', ')})`);
        }
      }
    }
  }

  private addError(category: string, message: string, context?: Record<string, any>): void {
    this.errors.push({ severity: 'error', category, message, context });
  }

  private addWarning(category: string, message: string, context?: Record<string, any>): void {
    this.warnings.push({ severity: 'warning', category, message, context });
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('VALIDATION RESULTS');
    console.log('='.repeat(80) + '\n');

    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log('✅ All validations passed!\n');
      return;
    }

    if (this.errors.length > 0) {
      console.log(`❌ ${this.errors.length} ERROR(S):\n`);
      for (const error of this.errors) {
        console.log(`  [${error.category}] ${error.message}`);
        if (error.context) {
          console.log(`    Context: ${JSON.stringify(error.context)}`);
        }
      }
      console.log('');
    }

    if (this.warnings.length > 0) {
      console.log(`⚠️  ${this.warnings.length} WARNING(S):\n`);
      for (const warning of this.warnings) {
        console.log(`  [${warning.category}] ${warning.message}`);
        if (warning.context) {
          console.log(`    Context: ${JSON.stringify(warning.context)}`);
        }
      }
      console.log('');
    }

    if (this.errors.length > 0) {
      console.log('❌ Validation FAILED\n');
    } else {
      console.log('✅ Validation PASSED (with warnings)\n');
    }
  }
}

// Main execution
function main(): void {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  const validator = new ArchitectureV2Validator(repoRoot);
  const passed = validator.validate();

  process.exit(passed ? 0 : 1);
}

if (require.main === module) {
  main();
}

export { ArchitectureV2Validator };
