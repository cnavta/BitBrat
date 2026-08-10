/**
 * Architecture.yaml v2 JSON Schema Validation
 *
 * Validates architecture.yaml against the formal JSON Schema (documentation/schemas/architecture.v2.json).
 * Uses Ajv for schema validation with detailed error reporting.
 *
 * Features:
 * - JSON Schema validation with Ajv
 * - Detailed error messages with file paths and line numbers
 * - Cross-reference validation (service dependencies, provider implementations)
 * - Human-readable error formatting
 *
 * @module validation/architecture-schema-v2
 */

import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  severity: 'error';
  path: string;
  message: string;
  suggestion?: string;
  context?: Record<string, any>;
}

export interface ValidationWarning {
  severity: 'warning';
  path: string;
  message: string;
  suggestion?: string;
  context?: Record<string, any>;
}

/**
 * Architecture.yaml v2 JSON Schema Validator
 */
export class ArchitectureSchemaV2Validator {
  private ajv: Ajv;
  private schemaValidator: ValidateFunction | null = null;
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false, // Allow unknown keywords for extensibility
      allowUnionTypes: true,
    });
    addFormats(this.ajv);
  }

  /**
   * Load and compile the JSON Schema
   */
  private loadSchema(): ValidateFunction {
    if (this.schemaValidator) {
      return this.schemaValidator;
    }

    const schemaPath = path.join(this.repoRoot, 'documentation/schemas/architecture.v2.json');

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(schemaContent);

    this.schemaValidator = this.ajv.compile(schema);
    return this.schemaValidator;
  }

  /**
   * Validate architecture.yaml against JSON Schema
   */
  validate(): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Load architecture.yaml
    const archPath = path.join(this.repoRoot, 'architecture.yaml');
    let architecture: any;

    try {
      const content = fs.readFileSync(archPath, 'utf8');
      architecture = yaml.parse(content);
    } catch (error) {
      errors.push({
        severity: 'error',
        path: 'architecture.yaml',
        message: `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      });
      return { valid: false, errors, warnings };
    }

    // Validate against JSON Schema
    const validator = this.loadSchema();
    const valid = validator(architecture);

    if (!valid && validator.errors) {
      for (const error of validator.errors) {
        errors.push(this.formatAjvError(error));
      }
    }

    // Additional cross-reference validations
    this.validateCrossReferences(architecture, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Format Ajv validation error into human-readable message
   */
  private formatAjvError(error: ErrorObject): ValidationError {
    const path = error.instancePath || '/';
    let message = error.message || 'Validation error';
    let suggestion: string | undefined;

    // Enhance error messages based on error type
    switch (error.keyword) {
      case 'required':
        message = `Missing required property: ${error.params.missingProperty}`;
        suggestion = `Add "${error.params.missingProperty}" to ${path}`;
        break;

      case 'enum':
        message = `Invalid value. Must be one of: ${error.params.allowedValues?.join(', ')}`;
        suggestion = `Update ${path} to use a valid value`;
        break;

      case 'type':
        message = `Wrong type. Expected ${error.params.type}, got ${typeof error.data}`;
        suggestion = `Change ${path} to ${error.params.type}`;
        break;

      case 'additionalProperties':
        message = `Unexpected property: ${error.params.additionalProperty}`;
        suggestion = `Remove "${error.params.additionalProperty}" from ${path} or check for typos`;
        break;

      case 'pattern':
        message = `Value does not match pattern: ${error.params.pattern}`;
        suggestion = `Update ${path} to match the required pattern`;
        break;

      case 'minItems':
        message = `Array must have at least ${error.params.limit} items`;
        suggestion = `Add more items to ${path}`;
        break;

      default:
        message = error.message || 'Validation error';
    }

    return {
      severity: 'error',
      path: path === '/' ? 'architecture.yaml' : `architecture.yaml${path}`,
      message,
      suggestion,
      context: {
        keyword: error.keyword,
        params: error.params,
        data: error.data,
      },
    };
  }

  /**
   * Validate cross-references between sections
   */
  private validateCrossReferences(
    architecture: any,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Validate that services' infrastructure dependencies can be resolved
    this.validateServiceDependencies(architecture, errors, warnings);

    // Validate that execution contexts reference valid providers
    this.validateExecutionContextProviders(architecture, errors, warnings);

    // Validate that platform capabilities are implemented by required providers
    this.validateProviderCapabilities(architecture, errors, warnings);
  }

  /**
   * Validate service infrastructure dependencies
   */
  private validateServiceDependencies(
    architecture: any,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!architecture.services || !architecture.platform?.infrastructure) {
      return;
    }

    const platformCapabilities = Object.keys(architecture.platform.infrastructure);

    for (const [serviceName, service] of Object.entries(architecture.services)) {
      const svc = service as any;

      if (!svc.active) {
        continue; // Skip inactive services
      }

      const infraDeps = svc.dependencies?.infrastructure;

      if (!infraDeps || infraDeps.length === 0) {
        // Warn if active service has no infrastructure dependencies
        if (svc.category === 'platform') {
          warnings.push({
            severity: 'warning',
            path: `services.${serviceName}.dependencies.infrastructure`,
            message: `Active platform service has no infrastructure dependencies`,
            suggestion: `Add dependencies.infrastructure array if this service uses messaging, caching, or persistence`,
          });
        }
        continue;
      }

      // Validate that all dependencies reference valid platform capabilities
      for (const dep of infraDeps) {
        if (!platformCapabilities.includes(dep)) {
          errors.push({
            severity: 'error',
            path: `services.${serviceName}.dependencies.infrastructure`,
            message: `Unknown infrastructure capability: "${dep}"`,
            suggestion: `Use one of: ${platformCapabilities.join(', ')}`,
            context: { service: serviceName, capability: dep },
          });
        }
      }
    }
  }

  /**
   * Validate execution context providers
   */
  private validateExecutionContextProviders(
    architecture: any,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!architecture.executionContexts || !architecture.infrastructure) {
      return;
    }

    const availableProviders = Object.keys(architecture.infrastructure);

    for (const [contextName, context] of Object.entries(architecture.executionContexts)) {
      const ctx = context as any;

      if (!ctx.infrastructure?.provider) {
        continue; // Already caught by schema validation
      }

      const provider = ctx.infrastructure.provider;

      if (!availableProviders.includes(provider)) {
        errors.push({
          severity: 'error',
          path: `executionContexts.${contextName}.infrastructure.provider`,
          message: `Unknown provider: "${provider}"`,
          suggestion: `Use one of: ${availableProviders.join(', ')} or add infrastructure.${provider} section`,
          context: { context: contextName, provider },
        });
      }
    }
  }

  /**
   * Validate provider capability implementations
   */
  private validateProviderCapabilities(
    architecture: any,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!architecture.platform?.infrastructure || !architecture.infrastructure) {
      return;
    }

    const platformCapabilities = Object.keys(architecture.platform.infrastructure);
    const requiredCapabilities = platformCapabilities.filter(
      (cap) => architecture.platform.infrastructure[cap].required
    );

    // Validate Docker provider (required)
    if (!architecture.infrastructure.docker) {
      errors.push({
        severity: 'error',
        path: 'infrastructure.docker',
        message: 'Docker provider is required but not defined',
        suggestion: 'Add infrastructure.docker section with messaging, caching, and persistence implementations',
      });
      return;
    }

    const dockerProvider = architecture.infrastructure.docker;

    for (const capability of requiredCapabilities) {
      if (!dockerProvider[capability]) {
        errors.push({
          severity: 'error',
          path: `infrastructure.docker.${capability}`,
          message: `Required capability "${capability}" not implemented by Docker provider`,
          suggestion: `Add infrastructure.docker.${capability} implementation`,
          context: { capability },
        });
      } else {
        const impl = dockerProvider[capability];

        // Validate implementation has required fields
        if (!impl.service && !impl.type) {
          warnings.push({
            severity: 'warning',
            path: `infrastructure.docker.${capability}`,
            message: 'Implementation missing "service" or "type" field',
            suggestion: 'Add "service" (Docker Compose service name) or "type" (GCP/AWS service type)',
          });
        }

        if (!impl.healthCheck) {
          warnings.push({
            severity: 'warning',
            path: `infrastructure.docker.${capability}`,
            message: 'Implementation missing healthCheck configuration',
            suggestion: 'Add healthCheck for production readiness',
          });
        }
      }
    }

    // Validate optional providers (GCP, AWS, Azure, K8s)
    for (const providerName of ['gcp', 'aws', 'azure', 'k8s']) {
      if (architecture.infrastructure[providerName]) {
        const provider = architecture.infrastructure[providerName];

        for (const capability of requiredCapabilities) {
          if (!provider[capability]) {
            warnings.push({
              severity: 'warning',
              path: `infrastructure.${providerName}.${capability}`,
              message: `Optional provider "${providerName}" does not implement required capability "${capability}"`,
              suggestion: `Add infrastructure.${providerName}.${capability} implementation or remove ${providerName} provider`,
            });
          }
        }
      }
    }
  }

  /**
   * Format validation results as human-readable string
   */
  static formatResults(result: ValidationResult): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('='.repeat(80));
    lines.push('ARCHITECTURE.YAML V2 SCHEMA VALIDATION RESULTS');
    lines.push('='.repeat(80));
    lines.push('');

    if (result.valid && result.warnings.length === 0) {
      lines.push('✅ All validations passed!');
      lines.push('');
      return lines.join('\n');
    }

    if (result.errors.length > 0) {
      lines.push(`❌ ${result.errors.length} ERROR(S):`);
      lines.push('');

      for (const error of result.errors) {
        lines.push(`  Path: ${error.path}`);
        lines.push(`  Error: ${error.message}`);
        if (error.suggestion) {
          lines.push(`  Suggestion: ${error.suggestion}`);
        }
        lines.push('');
      }
    }

    if (result.warnings.length > 0) {
      lines.push(`⚠️  ${result.warnings.length} WARNING(S):`);
      lines.push('');

      for (const warning of result.warnings) {
        lines.push(`  Path: ${warning.path}`);
        lines.push(`  Warning: ${warning.message}`);
        if (warning.suggestion) {
          lines.push(`  Suggestion: ${warning.suggestion}`);
        }
        lines.push('');
      }
    }

    if (result.valid) {
      lines.push('✅ Validation PASSED (with warnings)');
    } else {
      lines.push('❌ Validation FAILED');
    }

    lines.push('');
    return lines.join('\n');
  }
}

/**
 * Standalone validation function
 */
export function validateArchitectureV2(repoRoot: string): ValidationResult {
  const validator = new ArchitectureSchemaV2Validator(repoRoot);
  return validator.validate();
}
