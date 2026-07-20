/**
 * Sprint 349: 'brat use' Command Tests
 */

import { executeUse } from './use';
import { ContextResolver } from '../context/context-resolver';
import { setCurrentContext, getCurrentContext } from '../config/bratrc';

// Mock dependencies
jest.mock('../context/context-resolver');
jest.mock('../config/bratrc');

const mockContextResolver = ContextResolver as jest.MockedClass<typeof ContextResolver>;
const mockSetCurrentContext = setCurrentContext as jest.MockedFunction<typeof setCurrentContext>;
const mockGetCurrentContext = getCurrentContext as jest.MockedFunction<typeof getCurrentContext>;

describe('brat use command - Sprint 349', () => {
  let mockResolver: any;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock ContextResolver instance
    mockResolver = {
      contextExists: jest.fn(),
      listContexts: jest.fn(),
    };
    mockContextResolver.mockImplementation(() => mockResolver);

    // Spy on console.log
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('successful context switch', () => {
    it('switches to valid context and prints confirmation', async () => {
      mockResolver.contextExists.mockResolvedValue(true);
      mockGetCurrentContext.mockReturnValue('local');

      await executeUse('staging');

      expect(mockResolver.contextExists).toHaveBeenCalledWith('staging');
      expect(mockSetCurrentContext).toHaveBeenCalledWith('staging');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Switched to context 'staging'")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("was 'local'")
      );
    });

    it('switches to context when no previous context', async () => {
      mockResolver.contextExists.mockResolvedValue(true);
      mockGetCurrentContext.mockReturnValue(null);

      await executeUse('local');

      expect(mockSetCurrentContext).toHaveBeenCalledWith('local');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Switched to context 'local'")
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('was')
      );
    });

    it('switches to same context (no-op)', async () => {
      mockResolver.contextExists.mockResolvedValue(true);
      mockGetCurrentContext.mockReturnValue('staging');

      await executeUse('staging');

      expect(mockSetCurrentContext).toHaveBeenCalledWith('staging');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Switched to context 'staging'")
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('was')
      );
    });

    it('prints usage instructions after switching', async () => {
      mockResolver.contextExists.mockResolvedValue(true);
      mockGetCurrentContext.mockReturnValue('local');

      await executeUse('staging');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('All future brat commands will use this context')
      );
    });
  });

  describe('error handling', () => {
    it('throws error for unknown context', async () => {
      mockResolver.contextExists.mockResolvedValue(false);
      mockResolver.listContexts.mockResolvedValue(['local', 'staging', 'prod']);

      await expect(executeUse('nonexistent')).rejects.toThrow(
        "Unknown context: 'nonexistent'"
      );

      expect(mockSetCurrentContext).not.toHaveBeenCalled();
    });

    it('includes available contexts in error message', async () => {
      mockResolver.contextExists.mockResolvedValue(false);
      mockResolver.listContexts.mockResolvedValue(['local', 'staging', 'prod']);

      try {
        await executeUse('typo');
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('Available contexts: local, staging, prod');
      }
    });

    it('includes help text in error message', async () => {
      mockResolver.contextExists.mockResolvedValue(false);
      mockResolver.listContexts.mockResolvedValue(['local']);

      try {
        await executeUse('invalid');
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('architecture.yaml');
        expect(error.message).toContain('executionContexts');
      }
    });
  });

  describe('context validation', () => {
    it('validates context before setting', async () => {
      mockResolver.contextExists.mockResolvedValue(true);

      await executeUse('staging');

      // Should check existence and then set context
      expect(mockResolver.contextExists).toHaveBeenCalledWith('staging');
      expect(mockSetCurrentContext).toHaveBeenCalledWith('staging');
    });

    it('does not set context if validation fails', async () => {
      mockResolver.contextExists.mockResolvedValue(false);
      mockResolver.listContexts.mockResolvedValue(['local']);

      await expect(executeUse('invalid')).rejects.toThrow();

      expect(mockSetCurrentContext).not.toHaveBeenCalled();
    });
  });

  describe('integration with ContextResolver', () => {
    it('uses ContextResolver to validate context', async () => {
      mockResolver.contextExists.mockResolvedValue(true);

      await executeUse('staging');

      expect(mockResolver.contextExists).toHaveBeenCalledWith('staging');
    });

    it('uses ContextResolver to list contexts on error', async () => {
      mockResolver.contextExists.mockResolvedValue(false);
      mockResolver.listContexts.mockResolvedValue(['local', 'staging']);

      await expect(executeUse('invalid')).rejects.toThrow();

      expect(mockResolver.listContexts).toHaveBeenCalled();
    });
  });

  describe('integration with bratrc', () => {
    it('saves context to ~/.bratrc', async () => {
      mockResolver.contextExists.mockResolvedValue(true);

      await executeUse('staging');

      expect(mockSetCurrentContext).toHaveBeenCalledWith('staging');
    });

    it('reads current context before switching', async () => {
      mockResolver.contextExists.mockResolvedValue(true);
      mockGetCurrentContext.mockReturnValue('local');

      await executeUse('staging');

      expect(mockGetCurrentContext).toHaveBeenCalled();
    });

    it('updates history via setCurrentContext', async () => {
      // setCurrentContext internally updates history
      mockResolver.contextExists.mockResolvedValue(true);

      await executeUse('staging');

      // Verify setCurrentContext was called (which updates history)
      expect(mockSetCurrentContext).toHaveBeenCalledWith('staging');
    });
  });
});
