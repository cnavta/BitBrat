/**
 * Business Logic: Config Validation
 * Sprint 360: Extracted from cli/index.ts:265-317
 *
 * Validates architecture.yaml against:
 * 1. Runtime Zod schema (ArchitectureSchema) - source of truth for tooling
 * 2. Published JSON Schema - for humans and agents to self-validate
 *
 * Used by:
 * - config validate command
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ArchitectureSchema } from '../config/schema';

/**
 * Validation issue
 */
export interface ValidationIssue {
  /**
   * Path to the problematic field (e.g., 'services.llm-bot.port')
   */
  path: string;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Error code (e.g., 'zod', 'json-schema', 'schema-missing')
   */
  code: string;
}

/**
 * Validation result
 */
export interface ConfigValidationResult {
  /**
   * Whether the configuration is valid
   */
  valid: boolean;

  /**
   * Validation issues (if invalid)
   */
  issues: ValidationIssue[];

  /**
   * Relative path to the JSON schema that was used for validation
   */
  schemaPath?: string;
}

/**
 * Validation options
 */
export interface ConfigValidationOptions {
  /**
   * Repository root directory
   */
  repoRoot: string;

  /**
   * Override architecture.yaml path (for testing)
   */
  architecturePath?: string;
}

/**
 * Validate architecture.yaml configuration
 *
 * Performs two-tier validation:
 * 1. Structural validation against runtime Zod schema (ArchitectureSchema)
 * 2. Validation against published JSON Schema (for self-validation)
 *
 * @param options - Validation options
 * @returns Validation result with issues
 */
export function validateConfig(options: ConfigValidationOptions): ConfigValidationResult {
  const { repoRoot, architecturePath } = options;

  const archPath = architecturePath || path.join(repoRoot, 'architecture.yaml');
  const issues: ValidationIssue[] = [];

  // Load architecture.yaml
  if (!fs.existsSync(archPath)) {
    return {
      valid: false,
      issues: [
        {
          path: archPath,
          message: `architecture.yaml not found at ${archPath}`,
          code: 'file-missing',
        },
      ],
    };
  }

  let raw: any;
  try {
    const src = fs.readFileSync(archPath, 'utf8');
    raw = yaml.load(src);
  } catch (e: any) {
    return {
      valid: false,
      issues: [
        {
          path: archPath,
          message: `Failed to parse YAML: ${e.message}`,
          code: 'yaml-parse',
        },
      ],
    };
  }

  // 1) Structural validation against the runtime Zod schema (source of truth for the tooling)
  const parsed = ArchitectureSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({
        path: i.path.join('.') || '(root)',
        message: i.message,
        code: 'zod',
      });
    }
  }

  // 2) Validation against the shipped, published JSON Schema so humans and agents can self-validate
  //    architecture.yaml (path resolved from references.architecture_schema, with a sensible default).
  const schemaRel: string =
    (raw && raw.references && raw.references.architecture_schema) ||
    'documentation/schemas/architecture.v1.json';
  const schemaPath = path.join(repoRoot, schemaRel);

  if (!fs.existsSync(schemaPath)) {
    issues.push({
      path: schemaRel,
      message: `Referenced architecture schema not found at ${schemaRel}`,
      code: 'schema-missing',
    });
  } else {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);

      if (!validate(raw)) {
        for (const e of validate.errors || []) {
          const p = (e.instancePath || '').replace(/^\//, '').replace(/\//g, '.');
          issues.push({
            path: p || '(root)',
            message: e.message || 'Validation error',
            code: 'json-schema',
          });
        }
      }
    } catch (e: any) {
      issues.push({
        path: schemaRel,
        message: `Failed to load/compile JSON schema: ${e.message}`,
        code: 'schema-load',
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    schemaPath: schemaRel,
  };
}

/**
 * Format validation result as text
 *
 * @param result - Validation result
 * @returns Formatted text output
 */
export function formatConfigValidationResult(result: ConfigValidationResult): string {
  if (result.valid) {
    return `Config valid (validated against ${result.schemaPath || 'schema'})`;
  }

  const lines: string[] = [];
  lines.push('Config invalid:');
  for (const issue of result.issues) {
    lines.push(`- ${issue.path}: ${issue.message}`);
  }
  return lines.join('\n');
}
