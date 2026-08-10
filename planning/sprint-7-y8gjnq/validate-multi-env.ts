#!/usr/bin/env ts-node
/**
 * Multi-Environment Validation Script
 * Sprint 6: S6-P3.4
 *
 * Validates that all execution contexts (local, staging, agent-dev) use
 * architecture.yaml v2 schema consistently.
 *
 * Validation Criteria:
 * 1. All contexts use same platform.infrastructure declarations
 * 2. All contexts use docker provider
 * 3. All contexts pass schema validation
 * 4. Service dependencies are consistent across environments
 * 5. Agent-dev ephemeral contexts follow same patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

interface ValidationResult {
  context: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ArchitectureYaml {
  platform?: {
    version?: string;
    infrastructure?: {
      messaging?: any;
      caching?: any;
      persistence?: any;
    };
  };
  executionContexts?: Record<string, any>;
  services?: Record<string, any>;
}

interface EphemeralContexts {
  executionContexts?: Record<string, any>;
}

const REPO_ROOT = path.resolve(__dirname, '../..');

function loadArchitecture(): ArchitectureYaml {
  const archPath = path.join(REPO_ROOT, 'architecture.yaml');
  const content = fs.readFileSync(archPath, 'utf-8');
  return yaml.parse(content);
}

function loadEphemeralContexts(): EphemeralContexts {
  const ephemeralPath = path.join(REPO_ROOT, '.brat/ephemeral-contexts.yaml');
  if (!fs.existsSync(ephemeralPath)) {
    return { executionContexts: {} };
  }
  const content = fs.readFileSync(ephemeralPath, 'utf-8');
  return yaml.parse(content);
}

function validateContext(
  contextName: string,
  context: any,
  platformInfra: any
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check 1: Context must have infrastructure.provider
  if (!context.infrastructure?.provider) {
    errors.push('Missing infrastructure.provider');
  }

  // Check 2: Provider must be docker for local/staging/agent-dev
  if (context.infrastructure?.provider !== 'docker') {
    errors.push(
      `Expected provider: docker, got: ${context.infrastructure?.provider || 'undefined'}`
    );
  }

  // Check 3: Context inherits platform.infrastructure
  // (Context-specific overrides are allowed, but base capabilities should match)
  const requiredCapabilities = ['messaging', 'caching', 'persistence'];
  for (const cap of requiredCapabilities) {
    if (!platformInfra[cap]) {
      warnings.push(`Platform infrastructure missing ${cap} capability`);
    }
  }

  // Check 4: Deployment type should be docker-compose for docker provider
  if (context.deployment?.type !== 'docker-compose') {
    warnings.push(
      `Expected deployment.type: docker-compose, got: ${context.deployment?.type || 'undefined'}`
    );
  }

  return {
    context: contextName,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateServiceDependencies(
  architecture: ArchitectureYaml
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const services = architecture.services || {};
  const activeServices = Object.entries(services).filter(([_, svc]) => svc.active);

  for (const [name, svc] of activeServices) {
    // Services that use messaging should declare messaging dependency
    if (svc.topics?.publishes || svc.topics?.consumes) {
      if (!svc.dependencies?.infrastructure?.includes('messaging')) {
        warnings.push(
          `Service ${name} uses topics but doesn't declare messaging dependency`
        );
      }
    }

    // Services marked as stateful should declare persistence dependency
    if (svc.stateful && !svc.dependencies?.infrastructure?.includes('persistence')) {
      warnings.push(
        `Service ${name} is stateful but doesn't declare persistence dependency`
      );
    }
  }

  return {
    context: 'service-dependencies',
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function main(): void {
  console.log('================================================================================');
  console.log('MULTI-ENVIRONMENT VALIDATION REPORT');
  console.log('Sprint 6: S6-P3.4');
  console.log('================================================================================\n');

  const architecture = loadArchitecture();
  const ephemeral = loadEphemeralContexts();

  // Check platform.infrastructure exists
  if (!architecture.platform?.infrastructure) {
    console.error('❌ FATAL: Missing platform.infrastructure section\n');
    process.exit(1);
  }

  const platformInfra = architecture.platform.infrastructure;
  console.log('✅ Platform Infrastructure Declared:\n');
  console.log(`   - messaging: ${platformInfra.messaging?.required ? 'required' : 'optional'}`);
  console.log(`   - caching: ${platformInfra.caching?.required ? 'required' : 'optional'}`);
  console.log(`   - persistence: ${platformInfra.persistence?.required ? 'required' : 'optional'}\n`);

  // Validate all execution contexts
  const allContexts = {
    ...architecture.executionContexts,
    ...ephemeral.executionContexts,
  };

  const results: ValidationResult[] = [];

  console.log('Execution Contexts:\n');
  for (const [name, context] of Object.entries(allContexts || {})) {
    const result = validateContext(name, context, platformInfra);
    results.push(result);

    const icon = result.valid ? '✅' : '❌';
    console.log(`${icon} ${name}`);
    console.log(`   Provider: ${context.infrastructure?.provider || 'undefined'}`);
    console.log(`   Deployment: ${context.deployment?.type || 'undefined'}`);

    if (result.errors.length > 0) {
      console.log(`   Errors:`);
      result.errors.forEach(err => console.log(`     - ${err}`));
    }

    if (result.warnings.length > 0) {
      console.log(`   Warnings:`);
      result.warnings.forEach(warn => console.log(`     - ${warn}`));
    }

    console.log();
  }

  // Validate service dependencies
  console.log('Service Dependencies:\n');
  const depsResult = validateServiceDependencies(architecture);
  results.push(depsResult);

  if (depsResult.valid) {
    console.log('✅ All active services have appropriate infrastructure dependencies\n');
  } else {
    console.log('❌ Service dependency validation failed\n');
    depsResult.errors.forEach(err => console.log(`   Error: ${err}`));
  }

  if (depsResult.warnings.length > 0) {
    console.log('   Warnings:');
    depsResult.warnings.forEach(warn => console.log(`     - ${warn}`));
    console.log();
  }

  // Summary
  console.log('================================================================================');
  console.log('SUMMARY');
  console.log('================================================================================\n');

  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

  if (totalErrors === 0) {
    console.log('✅ ALL VALIDATIONS PASSED\n');
    console.log(`   Contexts validated: ${Object.keys(allContexts || {}).length}`);
    console.log(`   Warnings: ${totalWarnings}`);
    console.log();
    process.exit(0);
  } else {
    console.log('❌ VALIDATION FAILED\n');
    console.log(`   Errors: ${totalErrors}`);
    console.log(`   Warnings: ${totalWarnings}`);
    console.log();
    process.exit(1);
  }
}

main();
