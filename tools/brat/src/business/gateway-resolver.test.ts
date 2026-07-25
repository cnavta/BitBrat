/**
 * Gateway Resolver Module Unit Tests
 * Sprint 360: Test suite for business/gateway-resolver.ts
 */

import { resolveGatewayUrl, GatewayResolutionOptions } from './gateway-resolver';
import { ContextResolver } from '../context/context-resolver';
import { getCurrentContext } from '../config/bratrc';
import type { Logger } from '../orchestration/logger';

// Mock dependencies
jest.mock('../context/context-resolver');
jest.mock('../config/bratrc');

const mockContextResolver = ContextResolver as jest.MockedClass<typeof ContextResolver>;
const mockGetCurrentContext = getCurrentContext as jest.MockedFunction<typeof getCurrentContext>;

describe('Gateway Resolver Business Logic', () => {
  const repoRoot = '/test/repo';
  const mockLogger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;

  let mockResolve: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock ContextResolver.resolve()
    mockResolve = jest.fn();
    mockContextResolver.mockImplementation(() => ({
      resolve: mockResolve,
    } as any));

    // Mock getCurrentContext
    mockGetCurrentContext.mockReturnValue('local');

    // Clear environment variable
    delete process.env.TOOL_GATEWAY_URL;
  });

  afterEach(() => {
    delete process.env.TOOL_GATEWAY_URL;
    delete process.env.BITBRAT_CONTEXT;
  });

  describe('Priority 1: Explicit URL Override', () => {
    it('should use explicit URL from flag', async () => {
      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        explicitUrl: 'http://custom-gateway:4000',
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://custom-gateway:4000');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet.gateway.explicit',
          url: 'http://custom-gateway:4000',
        }),
        expect.stringContaining('explicit')
      );
    });

    it('should use TOOL_GATEWAY_URL env var when no flag provided', async () => {
      process.env.TOOL_GATEWAY_URL = 'http://env-gateway:5000';

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://env-gateway:5000');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet.gateway.explicit',
          url: 'http://env-gateway:5000',
        }),
        expect.any(String)
      );
    });

    it('should prioritize flag over env var', async () => {
      process.env.TOOL_GATEWAY_URL = 'http://env-gateway:5000';

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        explicitUrl: 'http://flag-gateway:6000',
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://flag-gateway:6000');
    });

    it('should strip trailing slashes from explicit URL', async () => {
      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        explicitUrl: 'http://gateway:3000///',
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://gateway:3000');
    });

    it('should not invoke ContextResolver when explicit URL provided', async () => {
      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        explicitUrl: 'http://gateway:3000',
      };

      await resolveGatewayUrl(options);

      expect(mockResolve).not.toHaveBeenCalled();
    });
  });

  describe('Priority 2: Context-Based Resolution (Sprint 349+)', () => {
    beforeEach(() => {
      mockResolve.mockResolvedValue({
        runtime: {
          gateway: {
            url: 'http://context-gateway:7000',
          },
        },
      });
    });

    it('should resolve gateway URL from context', async () => {
      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        contextName: 'staging',
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://context-gateway:7000');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet.gateway.resolved',
          context: 'staging',
          url: 'http://context-gateway:7000',
        }),
        expect.stringContaining("context 'staging'")
      );
    });

    it('should use context name from flag over environment', async () => {
      process.env.BITBRAT_CONTEXT = 'dev';

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        contextName: 'prod',
      };

      await resolveGatewayUrl(options);

      expect(mockResolve).toHaveBeenCalledWith('prod');
    });

    it('should use BITBRAT_CONTEXT env var when no flag provided', async () => {
      process.env.BITBRAT_CONTEXT = 'staging';

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
      };

      await resolveGatewayUrl(options);

      expect(mockResolve).toHaveBeenCalledWith('staging');
    });

    it('should use getCurrentContext() when no flag or env var', async () => {
      mockGetCurrentContext.mockReturnValue('dev');

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
      };

      await resolveGatewayUrl(options);

      expect(mockResolve).toHaveBeenCalledWith('dev');
    });

    it('should default to "local" context when no configuration', async () => {
      mockGetCurrentContext.mockReturnValue(null);

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
      };

      await resolveGatewayUrl(options);

      expect(mockResolve).toHaveBeenCalledWith('local');
    });

    it('should strip trailing slashes from context URL', async () => {
      mockResolve.mockResolvedValue({
        runtime: {
          gateway: {
            url: 'http://context-gateway:7000///',
          },
        },
      });

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://context-gateway:7000');
    });
  });

  describe('Priority 3: Legacy Fallback', () => {
    beforeEach(() => {
      // Context resolution fails or returns no gateway URL
      mockResolve.mockResolvedValue({
        runtime: {
          gateway: {
            // No URL
          },
        },
      });
    });

    describe('Local Docker', () => {
      it('should use hostPortResolverFn for local Docker', async () => {
        const mockHostPortResolver = jest.fn().mockReturnValue(3001);

        const options: GatewayResolutionOptions = {
          repoRoot,
          logger: mockLogger,
          isLocalDocker: true,
          hostPortResolverFn: mockHostPortResolver,
        };

        const url = await resolveGatewayUrl(options);

        expect(mockHostPortResolver).toHaveBeenCalledWith('tool-gateway', 3000);
        expect(url).toBe('http://localhost:3001');
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'fleet.gateway.legacy',
            url: 'http://localhost:3001',
            port: 3001,
          }),
          expect.stringContaining('Docker port resolution')
        );
      });

      it('should not use hostPortResolverFn when not local Docker', async () => {
        const mockHostPortResolver = jest.fn().mockReturnValue(3001);

        const options: GatewayResolutionOptions = {
          repoRoot,
          logger: mockLogger,
          isLocalDocker: false,
          hostPortResolverFn: mockHostPortResolver,
        };

        const url = await resolveGatewayUrl(options);

        expect(mockHostPortResolver).not.toHaveBeenCalled();
        expect(url).toBe('http://localhost:3000');
      });
    });

    describe('Emulator Host', () => {
      it('should use emulator host when provided', async () => {
        const options: GatewayResolutionOptions = {
          repoRoot,
          logger: mockLogger,
          legacyEmulatorHost: 'emulator-host:8080',
        };

        const url = await resolveGatewayUrl(options);

        expect(url).toBe('http://emulator-host:3000');
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'fleet.gateway.legacy',
            url: 'http://emulator-host:3000',
            emulatorHost: 'emulator-host:8080',
          }),
          expect.stringContaining('emulator host')
        );
      });

      it('should replace 0.0.0.0 with localhost', async () => {
        const options: GatewayResolutionOptions = {
          repoRoot,
          logger: mockLogger,
          legacyEmulatorHost: '0.0.0.0:8080',
        };

        const url = await resolveGatewayUrl(options);

        expect(url).toBe('http://localhost:3000');
      });

      it('should extract host from emulator host:port', async () => {
        const options: GatewayResolutionOptions = {
          repoRoot,
          logger: mockLogger,
          legacyEmulatorHost: 'custom-host:9999',
        };

        const url = await resolveGatewayUrl(options);

        expect(url).toBe('http://custom-host:3000');
      });

      it('should handle emulator host without port', async () => {
        const options: GatewayResolutionOptions = {
          repoRoot,
          logger: mockLogger,
          legacyEmulatorHost: 'emulator-host',
        };

        const url = await resolveGatewayUrl(options);

        expect(url).toBe('http://emulator-host:3000');
      });
    });

    describe('Final Fallback', () => {
      it('should use localhost:3000 when no other options', async () => {
        const options: GatewayResolutionOptions = {
          repoRoot,
          logger: mockLogger,
        };

        const url = await resolveGatewayUrl(options);

        expect(url).toBe('http://localhost:3000');
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'fleet.gateway.fallback',
            url: 'http://localhost:3000',
          }),
          expect.stringContaining('default')
        );
      });
    });
  });

  describe('Fallback on Context Resolution Failure', () => {
    it('should fall back to legacy when context resolution fails', async () => {
      mockResolve.mockRejectedValue(new Error('Context not found'));

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        contextName: 'nonexistent',
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://localhost:3000');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fleet.gateway.fallback',
          error: 'Context not found',
        }),
        expect.stringContaining('Context resolution failed')
      );
    });

    it('should use legacy options after context failure', async () => {
      mockResolve.mockRejectedValue(new Error('Context not found'));
      const mockHostPortResolver = jest.fn().mockReturnValue(3002);

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        contextName: 'nonexistent',
        isLocalDocker: true,
        hostPortResolverFn: mockHostPortResolver,
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://localhost:3002');
      expect(mockHostPortResolver).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle context with no gateway configuration', async () => {
      mockResolve.mockResolvedValue({
        runtime: {
          // No gateway property
        },
      });

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://localhost:3000');
    });

    it('should handle empty explicit URL gracefully', async () => {
      mockResolve.mockResolvedValue({
        runtime: {
          gateway: {
            url: 'http://context-gateway:7000',
          },
        },
      });

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        explicitUrl: '',
      };

      const url = await resolveGatewayUrl(options);

      // Should fall through to context resolution
      expect(url).toBe('http://context-gateway:7000');
    });

    it('should handle whitespace-only explicit URL', async () => {
      mockResolve.mockResolvedValue({
        runtime: {
          gateway: {
            url: 'http://context-gateway:7000',
          },
        },
      });

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        explicitUrl: '   ',
      };

      const url = await resolveGatewayUrl(options);

      // Should fall through to context resolution
      expect(url).toBe('http://context-gateway:7000');
    });

    it('should handle empty emulator host gracefully', async () => {
      mockResolve.mockResolvedValue({
        runtime: {
          gateway: {},
        },
      });

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        legacyEmulatorHost: '',
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://localhost:3000');
    });
  });

  describe('Resolution Priority Order', () => {
    beforeEach(() => {
      mockResolve.mockResolvedValue({
        runtime: {
          gateway: {
            url: 'http://context-gateway:7000',
          },
        },
      });
    });

    it('should prioritize explicit URL over context and legacy', async () => {
      const mockHostPortResolver = jest.fn().mockReturnValue(3001);

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        explicitUrl: 'http://explicit:9000',
        contextName: 'staging',
        isLocalDocker: true,
        hostPortResolverFn: mockHostPortResolver,
        legacyEmulatorHost: 'emulator:8080',
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://explicit:9000');
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockHostPortResolver).not.toHaveBeenCalled();
    });

    it('should prioritize context over legacy', async () => {
      const mockHostPortResolver = jest.fn().mockReturnValue(3001);

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        contextName: 'staging',
        isLocalDocker: true,
        hostPortResolverFn: mockHostPortResolver,
        legacyEmulatorHost: 'emulator:8080',
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://context-gateway:7000');
      expect(mockResolve).toHaveBeenCalled();
      expect(mockHostPortResolver).not.toHaveBeenCalled();
    });

    it('should use legacy when context has no gateway URL', async () => {
      mockResolve.mockResolvedValue({
        runtime: {
          gateway: {
            // No URL
          },
        },
      });
      const mockHostPortResolver = jest.fn().mockReturnValue(3001);

      const options: GatewayResolutionOptions = {
        repoRoot,
        logger: mockLogger,
        isLocalDocker: true,
        hostPortResolverFn: mockHostPortResolver,
      };

      const url = await resolveGatewayUrl(options);

      expect(url).toBe('http://localhost:3001');
      expect(mockHostPortResolver).toHaveBeenCalled();
    });
  });
});
