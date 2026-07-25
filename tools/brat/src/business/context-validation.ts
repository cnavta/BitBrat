/**
 * Business Logic: Execution Context Validation
 * Sprint 360: Extracted from commands/context/validate.ts
 *
 * Validates execution context configuration for completeness and correctness.
 * Checks for common bootstrap issues before deployment.
 *
 * Used by:
 * - context validate command
 * - Potentially by context create command for post-creation validation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Validation error
 */
export interface ValidationError {
  /**
   * Unique check identifier (e.g., 'secure-file', 'env-directory')
   */
  check: string;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Suggested fix (optional)
   */
  fix?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /**
   * Unique check identifier
   */
  check: string;

  /**
   * Human-readable warning message
   */
  message: string;

  /**
   * Recommendation (optional)
   */
  recommendation?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /**
   * Overall validation status (true if no errors)
   */
  valid: boolean;

  /**
   * Critical errors that must be fixed
   */
  errors: ValidationError[];

  /**
   * Non-critical warnings
   */
  warnings: ValidationWarning[];
}

/**
 * Validation options
 */
export interface ValidationOptions {
  /**
   * Repository root directory
   */
  repoRoot: string;

  /**
   * Context name to validate
   */
  contextName: string;

  /**
   * Context configuration object (from architecture.yaml)
   */
  context: any;

  /**
   * Enable verbose logging (show successful checks)
   */
  verbose?: boolean;

  /**
   * Logger function (optional)
   */
  logger?: (message: string) => void;
}

/**
 * Default logger (console.log)
 */
const defaultLogger = (message: string) => console.log(message);

/**
 * Validate execution context configuration
 *
 * Performs 8 validation checks:
 * 1. .secure.{context} file exists
 * 2. env/{context}/ directory exists
 * 3. env/{context}/global.yaml exists
 * 4. BUS_PREFIX is correctly set
 * 5. PERSISTENCE_DRIVER is set (warn if firestore)
 * 6. MESSAGE_BUS_DRIVER is set
 * 7. .env.brat files exist in correct locations (3 locations)
 * 8. Required secrets present (POSTGRES_PASSWORD, MCP_AUTH_TOKEN)
 *
 * @param options - Validation options
 * @returns Validation result with errors and warnings
 */
export async function validateContext(options: ValidationOptions): Promise<ValidationResult> {
  const { repoRoot, contextName, context, verbose = false, logger = defaultLogger } = options;
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
    logger(`✓ .secure.${contextName} exists`);
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
    logger(`✓ env/${contextName} directory exists`);
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
      logger(`✓ BUS_PREFIX correctly set: ${globalConfig.BUS_PREFIX}`);
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
      logger(`✓ PERSISTENCE_DRIVER: ${globalConfig.PERSISTENCE_DRIVER}`);
    }

    // Check 3c: MESSAGE_BUS_DRIVER is set
    if (!globalConfig.MESSAGE_BUS_DRIVER) {
      warnings.push({
        check: 'message-bus-driver',
        message: 'MESSAGE_BUS_DRIVER not set in global.yaml',
        recommendation: 'Add: MESSAGE_BUS_DRIVER: nats (recommended)',
      });
    } else if (verbose) {
      logger(`✓ MESSAGE_BUS_DRIVER: ${globalConfig.MESSAGE_BUS_DRIVER}`);
    }

    // Check 4: DATABASE_URL format (if postgres driver)
    if (globalConfig.PERSISTENCE_DRIVER === 'postgres') {
      const hasDatabaseUrl = !!globalConfig.DATABASE_URL;
      const hasPostgresVars = !!(globalConfig.POSTGRES_HOST && globalConfig.POSTGRES_DB);

      if (!hasDatabaseUrl && !hasPostgresVars) {
        errors.push({
          check: 'postgres-config',
          message: 'PostgreSQL configuration incomplete',
          fix: 'Add DATABASE_URL or POSTGRES_HOST/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD to global.yaml',
        });
      } else if (verbose) {
        logger(`✓ PostgreSQL configuration present`);
      }
    }
  }

  // Check 5: .env.brat exists in root
  const rootEnvBrat = path.join(repoRoot, '.env.brat');
  if (!fs.existsSync(rootEnvBrat)) {
    errors.push({
      check: 'env-brat-root',
      message: '.env.brat not found in repository root',
      fix: 'Run: brat use ${contextName} to generate .env.brat',
    });
  } else if (verbose) {
    logger(`✓ .env.brat exists in root`);
  }

  // Check 6: .env.brat copied to infrastructure/docker-compose
  const composeEnvBrat = path.join(repoRoot, 'infrastructure/docker-compose/.env.brat');
  if (!fs.existsSync(composeEnvBrat)) {
    errors.push({
      check: 'env-brat-compose',
      message: '.env.brat not found in infrastructure/docker-compose',
      fix: 'Copy .env.brat to infrastructure/docker-compose/',
    });
  } else if (verbose) {
    logger(`✓ .env.brat exists in infrastructure/docker-compose`);
  }

  // Check 7: .env.brat copied to infrastructure/docker-compose/services
  const servicesEnvBrat = path.join(repoRoot, 'infrastructure/docker-compose/services/.env.brat');
  if (!fs.existsSync(servicesEnvBrat)) {
    errors.push({
      check: 'env-brat-services',
      message: '.env.brat not found in infrastructure/docker-compose/services',
      fix: 'Copy .env.brat to infrastructure/docker-compose/services/',
    });
  } else if (verbose) {
    logger(`✓ .env.brat exists in infrastructure/docker-compose/services`);
  }

  // Check 8: Required secrets present (if .secure file exists)
  if (fs.existsSync(secureFile)) {
    const secureContent = fs.readFileSync(secureFile, 'utf8');
    const requiredSecrets = ['POSTGRES_PASSWORD', 'MCP_AUTH_TOKEN'];

    for (const secret of requiredSecrets) {
      if (!secureContent.includes(secret)) {
        errors.push({
          check: `secret-${secret.toLowerCase().replace(/_/g, '-')}`,
          message: `Required secret ${secret} not found in .secure.${contextName}`,
          fix: `Add to .secure.${contextName}: ${secret}=<value>`,
        });
      } else if (verbose) {
        logger(`✓ ${secret} present in .secure.${contextName}`);
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
 * Format validation result as text
 *
 * @param contextName - Context name being validated
 * @param result - Validation result
 * @returns Formatted text output
 */
export function formatValidationResult(contextName: string, result: ValidationResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`Validating context: ${contextName}`);
  lines.push('='.repeat(60));
  lines.push('');

  if (result.valid) {
    lines.push('✅ Validation PASSED');
    lines.push('');
    lines.push(`   Context '${contextName}' is ready for deployment`);

    if (result.warnings.length > 0) {
      lines.push('');
      lines.push(`⚠️  ${result.warnings.length} warning(s):`);
      for (const warning of result.warnings) {
        lines.push('');
        lines.push(`   [${warning.check}] ${warning.message}`);
        if (warning.recommendation) {
          lines.push(`   → ${warning.recommendation}`);
        }
      }
    }
  } else {
    lines.push('❌ Validation FAILED');
    lines.push('');
    lines.push(`   Found ${result.errors.length} error(s):`);
    lines.push('');

    for (const error of result.errors) {
      lines.push(`   [${error.check}] ${error.message}`);
      if (error.fix) {
        lines.push(`   → Fix: ${error.fix}`);
      }
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push(`⚠️  ${result.warnings.length} warning(s):`);
      lines.push('');
      for (const warning of result.warnings) {
        lines.push(`   [${warning.check}] ${warning.message}`);
        if (warning.recommendation) {
          lines.push(`   → ${warning.recommendation}`);
        }
        lines.push('');
      }
    }
  }

  lines.push('='.repeat(60));
  lines.push('');

  return lines.join('\n');
}
