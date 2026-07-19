/**
 * Sprint 349: 'brat current' Command Tests
 */

import { executeCurrent } from './current';
import { getCurrentContext } from '../config/bratrc';

// Mock dependencies
jest.mock('../config/bratrc');

const mockGetCurrentContext = getCurrentContext as jest.MockedFunction<typeof getCurrentContext>;

describe('brat current command - Sprint 349', () => {
  let consoleSpy: jest.SpyInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.BITBRAT_CONTEXT;

    // Spy on console.log
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.env = originalEnv;
  });

  describe('context from BITBRAT_CONTEXT env var', () => {
    it('shows context from environment variable', () => {
      process.env.BITBRAT_CONTEXT = 'staging';

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Current context: staging (from BITBRAT_CONTEXT environment variable)'
      );
    });

    it('environment variable takes priority over ~/.bratrc', () => {
      process.env.BITBRAT_CONTEXT = 'prod';
      mockGetCurrentContext.mockReturnValue('local'); // ~/.bratrc has 'local'

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Current context: prod (from BITBRAT_CONTEXT environment variable)'
      );
      // Should not read ~/.bratrc when env var is set
      expect(mockGetCurrentContext).not.toHaveBeenCalled();
    });
  });

  describe('context from ~/.bratrc', () => {
    it('shows context from ~/.bratrc when no env var', () => {
      mockGetCurrentContext.mockReturnValue('staging');

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Current context: staging (from ~/.bratrc)'
      );
      expect(mockGetCurrentContext).toHaveBeenCalled();
    });

    it('shows different contexts correctly', () => {
      mockGetCurrentContext.mockReturnValue('prod');

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Current context: prod (from ~/.bratrc)'
      );
    });
  });

  describe('default context', () => {
    it('shows default when no ~/.bratrc and no env var', () => {
      mockGetCurrentContext.mockReturnValue(null);

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Current context: local (default)'
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No context has been set')
      );
    });

    it('includes usage hint for default context', () => {
      mockGetCurrentContext.mockReturnValue(null);

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('brat use <context>')
      );
    });
  });

  describe('integration with getCurrentContext', () => {
    it('calls getCurrentContext when no env var', () => {
      mockGetCurrentContext.mockReturnValue('staging');

      executeCurrent();

      expect(mockGetCurrentContext).toHaveBeenCalled();
    });

    it('does not call getCurrentContext when env var set', () => {
      process.env.BITBRAT_CONTEXT = 'prod';

      executeCurrent();

      expect(mockGetCurrentContext).not.toHaveBeenCalled();
    });
  });

  describe('priority resolution', () => {
    it('follows correct priority: env var > ~/.bratrc > default', () => {
      // Test 1: env var wins
      process.env.BITBRAT_CONTEXT = 'prod';
      mockGetCurrentContext.mockReturnValue('staging');

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('prod')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('environment variable')
      );

      consoleSpy.mockClear();

      // Test 2: ~/.bratrc when no env var
      delete process.env.BITBRAT_CONTEXT;
      mockGetCurrentContext.mockReturnValue('staging');

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('staging')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('~/.bratrc')
      );

      consoleSpy.mockClear();

      // Test 3: default when nothing set
      mockGetCurrentContext.mockReturnValue(null);

      executeCurrent();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('local')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('default')
      );
    });
  });
});
