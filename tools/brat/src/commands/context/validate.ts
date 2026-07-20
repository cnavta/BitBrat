/**
 * Sprint 351: brat context validate
 *
 * Validates execution context configuration for completeness and correctness.
 * Checks for common bootstrap issues before deployment.
 */

import { ContextResolver } from '../../context/context-resolver';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  check: string;
  message: string;
  fix?: string;
}

export interface ValidationWarning {
  check: string;
  message: string;
  recommendation?: string;
}

export interface ContextValidateOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Execute 'brat context validate <name>' command
 */
export async function executeContextValidate(
  contextName: string,
  options: ContextValidateOptions = {}
): Promise<void> {
  const repoRoot = process.cwd();
  const resolver = new ContextResolver(repoRoot);

  try {
    // Check if context exists
    const context = await resolver.getRawContext(contextName);
    if (!context) {
      console.error(`Error: Context '${contextName}' does not exist`);
      console.error(`Use 'brat context list' to see available contexts`);
      process.exit(1);
    }

    // Run validation checks
    const result = await validateContext(repoRoot, contextName, context, options.verbose || false);

    // Output results
    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printTextResults(contextName, result);
    }

    // Exit with error code if validation failed
    if (!result.valid) {
      process.exit(1);
    }

  } catch (error: any) {
    console.error(`Error validating context: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Validate context configuration
 */
async function validateContext(
  repoRoot: string,
  contextName: string,
  context: any,
  verbose: boolean
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check 1: .secure.{context} file exists
  const secureFile = path.join(repoRoot, `.secure.${contextName}`);
  if (!fs.existsSync(secureFile)) {
    errors.push({
      check: 'secure-file',
      message: `.secure.${contextName} file not found`,
      fix: `Create .secure.${contextName} with required secrets (POSTGRES_PASSWORD, MCP_AUTH_TOKEN, etc.)`,
    });
  } else if (verbose) {
    console.log(`✓ .secure.${contextName} exists`);
  }

  // Check 2: env/{context} directory exists
  const envDir = path.join(repoRoot, 'env', contextName);
  if (!fs.existsSync(envDir)) {
    errors.push({
      check: 'env-directory',
      message: `env/${contextName} directory not found`,
      fix: `Run: brat context create ${contextName}`,
    });
  } else if (verbose) {
    console.log(`✓ env/${contextName} directory exists`);
  }

  // Check 3: env/{context}/global.yaml exists
  const globalYaml = path.join(envDir, 'global.yaml');
  if (!fs.existsSync(globalYaml)) {
    errors.push({
      check: 'global-yaml',
      message: `env/${contextName}/global.yaml not found`,
      fix: `Run: brat context create ${contextName}`,
    });
  } else {
    // Check 3a: BUS_PREFIX is set
    const globalConfig = yaml.load(fs.readFileSync(globalYaml, 'utf8')) as any;
    if (!globalConfig.BUS_PREFIX) {
      errors.push({
        check: 'bus-prefix',
        message: 'BUS_PREFIX not set in global.yaml',
        fix: `Add to env/${contextName}/global.yaml: BUS_PREFIX: "${contextName}."`,
      });
    } else if (globalConfig.BUS_PREFIX !== `${contextName}.`) {
      warnings.push({
        check: 'bus-prefix-mismatch',
        message: `BUS_PREFIX (${globalConfig.BUS_PREFIX}) doesn't match context name (${contextName}.)`,
        recommendation: `Update to: BUS_PREFIX: "${contextName}."`,
      });
    } else if (verbose) {
      console.log(`✓ BUS_PREFIX correctly set: ${globalConfig.BUS_PREFIX}`);
    }

    // Check 3b: PERSISTENCE_DRIVER is set
    if (!globalConfig.PERSISTENCE_DRIVER) {
      warnings.push({
        check: 'persistence-driver',
        message: 'PERSISTENCE_DRIVER not set in global.yaml',
        recommendation: 'Add: PERSISTENCE_DRIVER: postgres (recommended)',
      });
    } else if (globalConfig.PERSISTENCE_DRIVER === 'firestore') {
      warnings.push({
        check: 'firestore-deprecated',
        message: 'Using deprecated Firestore backend',
        recommendation: 'Migrate to PostgreSQL: PERSISTENCE_DRIVER: postgres',
      });
    } else if (verbose) {
      console.log(`✓ PERSISTENCE_DRIVER: ${globalConfig.PERSISTENCE_DRIVER}`);
    }

    // Check 3c: MESSAGE_BUS_DRIVER is set
    if (!globalConfig.MESSAGE_BUS_DRIVER) {
      warnings.push({
        check: 'message-bus-driver',
        message: 'MESSAGE_BUS_DRIVER not set in global.yaml',
        recommendation: 'Add: MESSAGE_BUS_DRIVER: nats (recommended)',
      });
    } else if (verbose) {
      console.log(`✓ MESSAGE_BUS_DRIVER: ${globalConfig.MESSAGE_BUS_DRIVER}`);
    }
  }

  // Check 4: .env.brat exists in root
  const rootEnvBrat = path.join(repoRoot, '.env.brat');
  if (!fs.existsSync(rootEnvBrat)) {
    errors.push({
      check: 'env-brat-root',
      message: '.env.brat not found in repository root',
      fix: 'Run: brat use ${contextName} to generate .env.brat',
    });
  } else if (verbose) {
    console.log(`✓ .env.brat exists in root`);
  }

  // Check 5: .env.brat copied to infrastructure/docker-compose
  const composeEnvBrat = path.join(repoRoot, 'infrastructure/docker-compose/.env.brat');
  if (!fs.existsSync(composeEnvBrat)) {
    errors.push({
      check: 'env-brat-compose',
      message: '.env.brat not found in infrastructure/docker-compose',
      fix: 'Copy .env.brat to infrastructure/docker-compose/',
    });
  } else if (verbose) {
    console.log(`✓ .env.brat exists in infrastructure/docker-compose`);
  }

  // Check 6: .env.brat copied to infrastructure/docker-compose/services
  const servicesEnvBrat = path.join(repoRoot, 'infrastructure/docker-compose/services/.env.brat');
  if (!fs.existsSync(servicesEnvBrat)) {
    errors.push({
      check: 'env-brat-services',
      message: '.env.brat not found in infrastructure/docker-compose/services',
      fix: 'Copy .env.brat to infrastructure/docker-compose/services/',
    });
  } else if (verbose) {
    console.log(`✓ .env.brat exists in infrastructure/docker-compose/services`);
  }

  // Check 7: Required secrets present (if .secure file exists)
  if (fs.existsSync(secureFile)) {
    const secureContent = fs.readFileSync(secureFile, 'utf8');
    const requiredSecrets = [
      'POSTGRES_PASSWORD',
      'MCP_AUTH_TOKEN',
    ];

    for (const secret of requiredSecrets) {
      if (!secureContent.includes(secret)) {
        errors.push({
          check: `secret-${secret.toLowerCase()}`,
          message: `Required secret ${secret} not found in .secure.${contextName}`,
          fix: `Add to .secure.${contextName}: ${secret}=<value>`,
        });
      } else if (verbose) {
        console.log(`✓ ${secret} present in .secure.${contextName}`);
      }
    }
  }

  // Check 8: DATABASE_URL format (if postgres driver)
  if (fs.existsSync(globalYaml)) {
    const globalConfig = yaml.load(fs.readFileSync(globalYaml, 'utf8')) as any;
    if (globalConfig.PERSISTENCE_DRIVER === 'postgres') {
      // Check if DATABASE_URL or individual POSTGRES_* vars are set
      const hasDatabaseUrl = !!globalConfig.DATABASE_URL;
      const hasPostgresVars = !!(globalConfig.POSTGRES_HOST && globalConfig.POSTGRES_DB);

      if (!hasDatabaseUrl && !hasPostgresVars) {
        errors.push({
          check: 'postgres-config',
          message: 'PostgreSQL configuration incomplete',
          fix: 'Add DATABASE_URL or POSTGRES_HOST/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD to global.yaml',
        });
      } else if (verbose) {
        console.log(`✓ PostgreSQL configuration present`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print validation results in text format
 */
function printTextResults(contextName: string, result: ValidationResult): void {
  console.log();
  console.log(`Validating context: ${contextName}`);
  console.log('='.repeat(60));
  console.log();

  if (result.valid) {
    console.log('✅ Validation PASSED');
    console.log();
    console.log(`   Context '${contextName}' is ready for deployment`);

    if (result.warnings.length > 0) {
      console.log();
      console.log(`⚠️  ${result.warnings.length} warning(s):`);
      for (const warning of result.warnings) {
        console.log();
        console.log(`   [${warning.check}] ${warning.message}`);
        if (warning.recommendation) {
          console.log(`   → ${warning.recommendation}`);
        }
      }
    }
  } else {
    console.log('❌ Validation FAILED');
    console.log();
    console.log(`   Found ${result.errors.length} error(s):`);
    console.log();

    for (const error of result.errors) {
      console.log(`   [${error.check}] ${error.message}`);
      if (error.fix) {
        console.log(`   → Fix: ${error.fix}`);
      }
      console.log();
    }

    if (result.warnings.length > 0) {
      console.log(`⚠️  ${result.warnings.length} warning(s):`);
      console.log();
      for (const warning of result.warnings) {
        console.log(`   [${warning.check}] ${warning.message}`);
        if (warning.recommendation) {
          console.log(`   → ${warning.recommendation}`);
        }
        console.log();
      }
    }
  }

  console.log('='.repeat(60));
  console.log();
}
