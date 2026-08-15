/**
 * Feature Flags Tests
 * Sprint 13: DX-013
 */

import {
  getFeatureFlags,
  validateFeatureFlags,
  isFullyMigrated,
  isLegacyMode,
} from './feature-flags';

describe('Feature Flags (DX-013)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getFeatureFlags', () => {
    it('should return false for all flags by default', () => {
      delete process.env.ENABLE_CONFIG_REGISTRY;
      delete process.env.ENABLE_GENERIC_BUILDER;

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(false);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(false);
    });

    it('should parse "true" as true', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'true';

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(true);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(true);
    });

    it('should parse "yes" as true', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'yes';
      process.env.ENABLE_GENERIC_BUILDER = 'YES';

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(true);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(true);
    });

    it('should parse "1" as true', () => {
      process.env.ENABLE_CONFIG_REGISTRY = '1';
      process.env.ENABLE_GENERIC_BUILDER = '1';

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(true);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(true);
    });

    it('should parse "on" as true', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'on';
      process.env.ENABLE_GENERIC_BUILDER = 'ON';

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(true);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(true);
    });

    it('should parse "false" as false', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'false';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(false);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(false);
    });

    it('should parse empty string as default (false)', () => {
      process.env.ENABLE_CONFIG_REGISTRY = '';
      process.env.ENABLE_GENERIC_BUILDER = '';

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(false);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(false);
    });

    it('should parse invalid values as false', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'invalid';
      process.env.ENABLE_GENERIC_BUILDER = 'maybe';

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(false);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(false);
    });

    it('should be case-insensitive', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'TRUE';
      process.env.ENABLE_GENERIC_BUILDER = 'Yes';

      const flags = getFeatureFlags();

      expect(flags.ENABLE_CONFIG_REGISTRY).toBe(true);
      expect(flags.ENABLE_GENERIC_BUILDER).toBe(true);
    });
  });

  describe('validateFeatureFlags', () => {
    it('should not throw when both flags are true', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'true';

      expect(() => validateFeatureFlags()).not.toThrow();
    });

    it('should not throw when both flags are false', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'false';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      expect(() => validateFeatureFlags()).not.toThrow();
    });

    it('should not throw when only config registry is enabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      expect(() => validateFeatureFlags()).not.toThrow();
    });

    it('should throw when generic builder enabled without config registry', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'false';
      process.env.ENABLE_GENERIC_BUILDER = 'true';

      expect(() => validateFeatureFlags()).toThrow(
        'ENABLE_GENERIC_BUILDER=true requires ENABLE_CONFIG_REGISTRY=true'
      );
    });
  });

  describe('isFullyMigrated', () => {
    it('should return true when all flags are enabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'true';

      expect(isFullyMigrated()).toBe(true);
    });

    it('should return false when only config registry is enabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      expect(isFullyMigrated()).toBe(false);
    });

    it('should return false when only generic builder is enabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'false';
      process.env.ENABLE_GENERIC_BUILDER = 'true';

      expect(isFullyMigrated()).toBe(false);
    });

    it('should return false when both flags are disabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'false';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      expect(isFullyMigrated()).toBe(false);
    });
  });

  describe('isLegacyMode', () => {
    it('should return true when both flags are disabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'false';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      expect(isLegacyMode()).toBe(true);
    });

    it('should return false when config registry is enabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'false';

      expect(isLegacyMode()).toBe(false);
    });

    it('should return false when generic builder is enabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'false';
      process.env.ENABLE_GENERIC_BUILDER = 'true';

      expect(isLegacyMode()).toBe(false);
    });

    it('should return false when all flags are enabled', () => {
      process.env.ENABLE_CONFIG_REGISTRY = 'true';
      process.env.ENABLE_GENERIC_BUILDER = 'true';

      expect(isLegacyMode()).toBe(false);
    });
  });
});
