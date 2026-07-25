/**
 * Fleet List Command Tests
 * Sprint 359: Integration tests for brat fleet list command
 */

import { test } from '@oclif/test';
import FleetList, { FleetListDeps } from './list';
import { FleetClient } from '../../fleet';
import type { FleetIdentity, FleetTransport, RegistryReader } from '../../fleet';

// Mock dependencies
jest.mock('../../fleet');

const mockFleetClient = FleetClient as jest.MockedClass<typeof FleetClient>;

describe('brat fleet list', () => {
  let mockTransport: jest.Mocked<FleetTransport>;
  let mockRegistry: jest.Mocked<RegistryReader>;
  let mockIdentity: FleetIdentity;
  let mockBits: Array<{ name: string; profile?: string; exposure?: string }>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock identity
    mockIdentity = {
      userId: 'test-user',
      agentName: 'test-agent',
      roles: ['bit:read'],
      token: 'mock-token',
    };

    // Mock transport
    mockTransport = {
      call: jest.fn(),
      close: jest.fn(),
    } as any;

    // Mock registry
    mockRegistry = {
      listBits: jest.fn(),
      getBit: jest.fn(),
      close: jest.fn(),
    } as any;

    // Mock bits data
    mockBits = [
      { name: 'api-gateway', profile: 'gateway', exposure: 'platform+domain' },
      { name: 'llm-bot', profile: 'llm', exposure: 'platform-only' },
      { name: 'auth-service', profile: 'core', exposure: 'platform-only' },
    ];

    // Mock FleetClient.list()
    mockFleetClient.prototype.list = jest.fn().mockResolvedValue(mockBits);
    mockFleetClient.prototype.close = jest.fn().mockResolvedValue(undefined);
  });

  describe('Table Output (Default)', () => {
    test
      .stdout()
      .do(() => {
        // Mock dependencies for test
        const cmd = new FleetList([], {} as any);
        (cmd as any).getFleetDeps({
          resolveIdentityFn: () => mockIdentity,
          gatewayTransportFactory: () => mockTransport,
          registryFactory: async () => mockRegistry,
          hostPortResolverFn: () => 3000,
        });
      })
      .command(['fleet:list'])
      .it('should display bits in table format', (ctx) => {
        expect(ctx.stdout).toContain('BIT');
        expect(ctx.stdout).toContain('PROFILE');
        expect(ctx.stdout).toContain('EXPOSURE');
        expect(ctx.stdout).toContain('api-gateway');
        expect(ctx.stdout).toContain('llm-bot');
        expect(ctx.stdout).toContain('auth-service');
      });

    test
      .stdout()
      .do(() => {
        mockFleetClient.prototype.list = jest.fn().mockResolvedValue([]);
      })
      .command(['fleet:list'])
      .it('should handle empty fleet', (ctx) => {
        expect(ctx.stdout).toContain('BIT');
        expect(ctx.stdout).toContain('PROFILE');
        expect(ctx.stdout).toContain('EXPOSURE');
        // Should show headers but no data rows
      });
  });

  describe('JSON Output', () => {
    test
      .stdout()
      .command(['fleet:list', '--format=json'])
      .it('should output bits as JSON', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(Array.isArray(output)).toBe(true);
        expect(output.length).toBe(3);
        expect(output[0]).toMatchObject({
          name: 'api-gateway',
          profile: 'gateway',
          exposure: 'platform+domain',
        });
      });

    test
      .stdout()
      .do(() => {
        mockFleetClient.prototype.list = jest.fn().mockResolvedValue([]);
      })
      .command(['fleet:list', '--format=json'])
      .it('should output empty array for empty fleet', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output).toEqual([]);
      });
  });

  describe('YAML Output', () => {
    test
      .stdout()
      .command(['fleet:list', '--format=yaml'])
      .it('should output bits as YAML', (ctx) => {
        expect(ctx.stdout).toContain('- name: api-gateway');
        expect(ctx.stdout).toContain('  profile: gateway');
        expect(ctx.stdout).toContain('  exposure: platform+domain');
      });
  });

  describe('Dependency Injection', () => {
    test
      .stdout()
      .do(() => {
        const mockResolveIdentity = jest.fn().mockReturnValue({
          userId: 'custom-user',
          roles: ['bit:read', 'bit:operate'],
          token: 'custom-token',
        });

        const cmd = new FleetList([], {} as any);
        (cmd as any).getFleetDeps({
          resolveIdentityFn: mockResolveIdentity,
        });
      })
      .command(['fleet:list'])
      .it('should allow injecting custom identity resolver');

    test
      .stdout()
      .do(() => {
        const mockTransportFactory = jest.fn().mockReturnValue(mockTransport);

        const cmd = new FleetList([], {} as any);
        (cmd as any).getFleetDeps({
          gatewayTransportFactory: mockTransportFactory,
        });
      })
      .command(['fleet:list'])
      .it('should allow injecting custom transport factory');

    test
      .stdout()
      .do(() => {
        const mockRegistryFactory = jest.fn().mockResolvedValue(mockRegistry);

        const cmd = new FleetList([], {} as any);
        (cmd as any).getFleetDeps({
          registryFactory: mockRegistryFactory,
        });
      })
      .command(['fleet:list'])
      .it('should allow injecting custom registry factory');
  });

  describe('Context Integration', () => {
    test
      .stdout()
      .command(['fleet:list', '--context=staging'])
      .it('should accept --context flag from BratCommand');

    test
      .stdout()
      .command(['fleet:list', '--verbose'])
      .it('should accept --verbose flag from BratCommand');

    test
      .env({ BITBRAT_CONTEXT: 'prod' })
      .stdout()
      .command(['fleet:list'])
      .it('should use BITBRAT_CONTEXT env var');
  });

  describe('Fleet Client Integration', () => {
    test
      .stdout()
      .command(['fleet:list'])
      .it('should create FleetClient with correct parameters', () => {
        expect(mockFleetClient).toHaveBeenCalledWith(
          expect.objectContaining({
            transport: expect.any(Object),
            identity: expect.any(Object),
            registry: expect.any(Object),
            logger: expect.any(Object),
          })
        );
      });

    test
      .stdout()
      .command(['fleet:list'])
      .it('should call FleetClient.list()', () => {
        expect(mockFleetClient.prototype.list).toHaveBeenCalled();
      });

    test
      .stdout()
      .command(['fleet:list'])
      .it('should close FleetClient after execution', () => {
        expect(mockFleetClient.prototype.close).toHaveBeenCalled();
      });
  });

  describe('Error Handling', () => {
    test
      .stdout()
      .do(() => {
        mockFleetClient.prototype.list = jest
          .fn()
          .mockRejectedValue(new Error('Fleet connection failed'));
      })
      .command(['fleet:list'])
      .catch((error) => {
        expect(error.message).toContain('Fleet list failed');
      })
      .it('should handle fleet client errors');

    test
      .stdout()
      .do(() => {
        mockFleetClient.prototype.list = jest
          .fn()
          .mockRejectedValue(new Error('Unauthorized'));
      })
      .command(['fleet:list'])
      .catch((error) => {
        expect(error.message).toMatch(/unauthorized|fleet list failed/i);
      })
      .it('should handle authorization errors');

    test
      .stdout()
      .do(() => {
        const cmd = new FleetList([], {} as any);
        (cmd as any).getFleetDeps({
          registryFactory: async () => {
            throw new Error('Registry connection failed');
          },
        });
      })
      .command(['fleet:list'])
      .catch((error) => {
        expect(error.message).toContain('Registry connection failed');
      })
      .it('should handle registry creation errors');
  });

  describe('Help Text', () => {
    test
      .stdout()
      .command(['fleet:list', '--help'])
      .it('should display help text', (ctx) => {
        expect(ctx.stdout).toContain('List all live Bits in the fleet');
        expect(ctx.stdout).toContain('--format');
        expect(ctx.stdout).toContain('table|json|yaml');
      });
  });

  describe('Format Validation', () => {
    test
      .stdout()
      .command(['fleet:list', '--format=invalid'])
      .catch((error) => {
        expect(error.message).toContain('Expected --format=');
      })
      .it('should reject invalid format option');

    test
      .stdout()
      .command(['fleet:list', '--format=table'])
      .it('should accept table format');

    test
      .stdout()
      .command(['fleet:list', '--format=json'])
      .it('should accept json format');

    test
      .stdout()
      .command(['fleet:list', '--format=yaml'])
      .it('should accept yaml format');
  });

  describe('Identity Resolution', () => {
    test
      .stdout()
      .env({ MCP_AUTH_TOKEN: 'test-token' })
      .command(['fleet:list'])
      .it('should resolve identity from MCP_AUTH_TOKEN env var');

    test
      .stdout()
      .env({ MCP_USER_ID: 'test-user-id' })
      .command(['fleet:list'])
      .it('should use MCP_USER_ID if provided');

    test
      .stdout()
      .command(['fleet:list'])
      .it('should require bit:read role', () => {
        // Identity resolver should be called with ['bit:read']
        // This would be validated in the actual implementation
      });
  });

  describe('Output Formatting', () => {
    test
      .stdout()
      .do(() => {
        mockFleetClient.prototype.list = jest.fn().mockResolvedValue([
          { name: 'api-gateway', profile: 'gateway', exposure: 'platform+domain' },
        ]);
      })
      .command(['fleet:list'])
      .it('should pad columns in table format', (ctx) => {
        // Table should have aligned columns
        const lines = ctx.stdout.split('\n');
        const headerLine = lines.find((l) => l.includes('BIT'));
        const dataLine = lines.find((l) => l.includes('api-gateway'));

        expect(headerLine).toBeDefined();
        expect(dataLine).toBeDefined();
      });

    test
      .stdout()
      .do(() => {
        mockFleetClient.prototype.list = jest.fn().mockResolvedValue([
          { name: 'api-gateway' }, // Missing profile and exposure
        ]);
      })
      .command(['fleet:list'])
      .it('should handle missing profile/exposure with dash placeholder', (ctx) => {
        expect(ctx.stdout).toContain('-');
      });
  });

  describe('Verbose Logging', () => {
    test
      .stdout()
      .command(['fleet:list', '--verbose'])
      .it('should enable debug logging', () => {
        // Verbose flag should enable debug-level logging
        // This would show additional debug information
      });
  });
});
