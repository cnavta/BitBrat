/**
 * Validation functions for brat bit create command
 * Sprint 331: BL-331-102
 * Sprint 23: T2.2 - Enhanced error messages with context and suggestions
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  suggestions?: string[];
}

/**
 * Validates that a Bit name is in kebab-case format
 * Sprint 23 T2.2: Enhanced with specific suggestions based on common mistakes
 */
export function validateBitName(name: string): ValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  if (!name || name.trim().length === 0) {
    errors.push('Bit name is required');
    suggestions.push('Usage: brat bit create <name>');
    suggestions.push('Example: brat bit create my-service');
    return { valid: false, errors, suggestions };
  }

  const kebabCasePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  if (!kebabCasePattern.test(name)) {
    errors.push(`Invalid Bit name: '${name}'`);
    errors.push('Bit names must be kebab-case: lowercase letters, numbers, hyphens only');
    errors.push('Must start with a letter, no consecutive hyphens');

    // Provide specific suggestions based on what's wrong
    if (name.match(/[A-Z]/)) {
      const fixed = name.toLowerCase();
      suggestions.push(`Try: ${fixed} (converted to lowercase)`);
    }
    if (name.match(/_/)) {
      const fixed = name.replace(/_/g, '-');
      suggestions.push(`Try: ${fixed} (underscores → hyphens)`);
    }
    if (name.match(/\s/)) {
      const fixed = name.replace(/\s+/g, '-');
      suggestions.push(`Try: ${fixed} (spaces → hyphens)`);
    }
    if (name.match(/^[^a-z]/)) {
      suggestions.push('Bit names must start with a lowercase letter');
    }

    // Always show good examples
    if (suggestions.length === 0) {
      suggestions.push('Examples: my-service, api-gateway, llm-bot, data-processor');
    }
  }

  return { valid: errors.length === 0, errors, suggestions };
}

/**
 * Validates profile and exposure combination according to Bit model contract
 * Sprint 23 T2.2: Enhanced with contract rules and examples
 */
export function validateProfileExposure(profile: string, exposure: string): ValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  // Profile: mcp-server MUST use exposure: platform+domain
  if (profile === 'mcp-server' && exposure !== 'platform+domain') {
    errors.push(`Profile/Exposure mismatch for '${profile}'`);
    errors.push(`You specified exposure: '${exposure}'`);
    errors.push(`But 'mcp-server' profile requires exposure: 'platform+domain'`);
    suggestions.push('MCP servers expose tools to domain contexts, so they require platform+domain exposure');
    suggestions.push('Fix: --profile mcp-server --exposure platform+domain');
    suggestions.push('Or remove --exposure flag (will auto-default to platform+domain for mcp-server)');
  }

  // Profile: core or llm CANNOT use exposure: platform+domain
  if ((profile === 'core' || profile === 'llm') && exposure === 'platform+domain') {
    errors.push(`Profile/Exposure mismatch for '${profile}'`);
    errors.push(`You specified exposure: 'platform+domain'`);
    errors.push(`But '${profile}' profile cannot use 'platform+domain' exposure`);
    suggestions.push(`Valid exposures for '${profile}': platform-only, none`);
    suggestions.push('Fix: --exposure platform-only (for internal tools)');
    suggestions.push('Or: --exposure none (if no MCP tools needed)');
  }

  // Gateway has flexibility but provide guidance
  if (profile === 'gateway' && !exposure) {
    suggestions.push('Gateway services can use: platform-only, platform+domain, or none');
    suggestions.push('Tip: Use platform+domain if gateway needs to expose MCP tools to domain contexts');
  }

  return { valid: errors.length === 0, errors, suggestions };
}

/**
 * Validates that a Bit doesn't already exist in architecture.yaml
 * Sprint 23 T2.2: Enhanced with actionable suggestions
 */
export function validateBitDoesNotExist(name: string, architecture: any): ValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  if (architecture?.services?.[name]) {
    errors.push(`Service '${name}' already exists in architecture.yaml`);
    errors.push('Cannot create a Bit with the same name as an existing service');

    suggestions.push('Option 1: Choose a different name');
    suggestions.push(`Option 2: Use --force to overwrite files (won't modify architecture.yaml)`);
    suggestions.push('Option 3: Manually remove the service from architecture.yaml first');
    suggestions.push(`Tip: Try variations like ${name}-v2, new-${name}, or ${name}-service`);
  }

  return { valid: errors.length === 0, errors, suggestions };
}
