/**
 * Validation functions for brat bit create command
 * Sprint 331: BL-331-102
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that a Bit name is in kebab-case format
 */
export function validateBitName(name: string): ValidationResult {
  const errors: string[] = [];

  if (!name || name.trim().length === 0) {
    errors.push('Bit name is required');
    return { valid: false, errors };
  }

  const kebabCasePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  if (!kebabCasePattern.test(name)) {
    errors.push(
      `Invalid Bit name '${name}'. Must be kebab-case (lowercase with hyphens). Examples: my-service, api-gateway, llm-bot`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates profile and exposure combination according to Bit model contract
 */
export function validateProfileExposure(profile: string, exposure: string): ValidationResult {
  const errors: string[] = [];

  // Profile: mcp-domain MUST use exposure: platform+domain
  if (profile === 'mcp-domain' && exposure !== 'platform+domain') {
    errors.push(
      `Profile 'mcp-domain' requires exposure 'platform+domain'. You specified '${exposure}'.`
    );
  }

  // Profile: core or llm CANNOT use exposure: platform+domain
  if ((profile === 'core' || profile === 'llm') && exposure === 'platform+domain') {
    errors.push(
      `Profile '${profile}' cannot use exposure 'platform+domain'. Valid exposures: platform-only, none`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates that a Bit doesn't already exist in architecture.yaml
 */
export function validateBitDoesNotExist(name: string, architecture: any): ValidationResult {
  const errors: string[] = [];

  if (architecture?.services?.[name]) {
    errors.push(
      `Service '${name}' already exists in architecture.yaml. Choose a different name or remove the existing entry first.`
    );
  }

  return { valid: errors.length === 0, errors };
}
