/**
 * Unit tests for validation logic
 * Sprint 331: BL-331-201
 */

import { validateBitName, validateProfileExposure, validateBitDoesNotExist } from '../validation';

describe('validateBitName', () => {
  it('should accept valid kebab-case names', () => {
    expect(validateBitName('my-service').valid).toBe(true);
    expect(validateBitName('api-gateway').valid).toBe(true);
    expect(validateBitName('llm-bot').valid).toBe(true);
    expect(validateBitName('test').valid).toBe(true);
    expect(validateBitName('service-123').valid).toBe(true);
  });

  it('should reject empty or whitespace-only names', () => {
    expect(validateBitName('').valid).toBe(false);
    expect(validateBitName('   ').valid).toBe(false);
  });

  it('should reject PascalCase names', () => {
    const result = validateBitName('MyService');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('kebab-case');
  });

  it('should reject snake_case names', () => {
    const result = validateBitName('my_service');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('kebab-case');
  });

  it('should reject names with spaces', () => {
    const result = validateBitName('my service');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('kebab-case');
  });

  it('should reject names starting with numbers', () => {
    const result = validateBitName('123service');
    expect(result.valid).toBe(false);
  });

  it('should reject names starting or ending with hyphens', () => {
    expect(validateBitName('-service').valid).toBe(false);
    expect(validateBitName('service-').valid).toBe(false);
  });

  it('should reject names with special characters', () => {
    expect(validateBitName('my@service').valid).toBe(false);
    expect(validateBitName('my.service').valid).toBe(false);
    expect(validateBitName('my/service').valid).toBe(false);
  });
});

describe('validateProfileExposure', () => {
  describe('valid combinations', () => {
    it('should accept core with platform-only', () => {
      expect(validateProfileExposure('core', 'platform-only').valid).toBe(true);
    });

    it('should accept core with none', () => {
      expect(validateProfileExposure('core', 'none').valid).toBe(true);
    });

    it('should accept gateway with platform-only', () => {
      expect(validateProfileExposure('gateway', 'platform-only').valid).toBe(true);
    });

    it('should accept gateway with platform+domain', () => {
      expect(validateProfileExposure('gateway', 'platform+domain').valid).toBe(true);
    });

    it('should accept gateway with none', () => {
      expect(validateProfileExposure('gateway', 'none').valid).toBe(true);
    });

    it('should accept llm with platform-only', () => {
      expect(validateProfileExposure('llm', 'platform-only').valid).toBe(true);
    });

    it('should accept llm with none', () => {
      expect(validateProfileExposure('llm', 'none').valid).toBe(true);
    });

    it('should accept mcp-domain with platform+domain', () => {
      expect(validateProfileExposure('mcp-domain', 'platform+domain').valid).toBe(true);
    });
  });

  describe('invalid combinations', () => {
    it('should reject mcp-domain with platform-only', () => {
      const result = validateProfileExposure('mcp-domain', 'platform-only');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('mcp-domain');
      expect(result.errors[0]).toContain('platform+domain');
    });

    it('should reject mcp-domain with none', () => {
      const result = validateProfileExposure('mcp-domain', 'none');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('mcp-domain');
      expect(result.errors[0]).toContain('platform+domain');
    });

    it('should reject core with platform+domain', () => {
      const result = validateProfileExposure('core', 'platform+domain');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('core');
      expect(result.errors[0]).toContain('cannot');
    });

    it('should reject llm with platform+domain', () => {
      const result = validateProfileExposure('llm', 'platform+domain');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('llm');
      expect(result.errors[0]).toContain('cannot');
    });
  });
});

describe('validateBitDoesNotExist', () => {
  it('should accept a new service name', () => {
    const arch = {
      services: {
        'existing-service': {},
      },
    };
    const result = validateBitDoesNotExist('new-service', arch);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject an existing service name', () => {
    const arch = {
      services: {
        'existing-service': {},
      },
    };
    const result = validateBitDoesNotExist('existing-service', arch);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('already exists');
  });

  it('should handle empty services object', () => {
    const arch = {
      services: {},
    };
    const result = validateBitDoesNotExist('new-service', arch);
    expect(result.valid).toBe(true);
  });

  it('should handle missing services object', () => {
    const arch = {};
    const result = validateBitDoesNotExist('new-service', arch);
    expect(result.valid).toBe(true);
  });

  it('should handle null architecture', () => {
    const result = validateBitDoesNotExist('new-service', null);
    expect(result.valid).toBe(true);
  });
});
