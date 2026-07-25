/**
 * Fleet Dependencies Module Unit Tests
 * Sprint 360: Test suite for business/fleet-deps.ts
 */

import { createDefaultFleetDeps, mergeFleetDeps, FleetDeps } from './fleet-deps';

// Mock the fleet and backup modules
jest.mock('../fleet', () => ({
  resolveIdentity: jest.fn(() => ({
    token: 'mock-token',
    agentName: 'test-agent',
    roles: ['bit:read']
  })),
  GatewayTransport: jest.fn().mockImplementation(() => ({ type: 'gateway' })),
  DirectTransport: jest.fn().mockImplementation(() => ({ type: 'direct' })),
  resolveServiceHostPort: jest.fn(() => 3001),
  FirestoreRegistryReader: jest.fn().mockImplementation(() => ({ type: 'firestore-registry' })),
}));

jest.mock('../backup/connection', () => ({
  resolveBackupConnection: jest.fn().mockResolvedValue({ type: 'backup-connection' }),
}));

describe('Fleet Dependencies Business Logic', () => {
  describe('createDefaultFleetDeps', () => {
    it('should create all required dependencies', () => {
      const deps = createDefaultFleetDeps();

      expect(deps).toHaveProperty('resolveIdentityFn');
      expect(deps).toHaveProperty('gatewayTransportFactory');
      expect(deps).toHaveProperty('directTransportFactory');
      expect(deps).toHaveProperty('hostPortResolverFn');
      expect(deps).toHaveProperty('registryFactory');
      expect(deps).toHaveProperty('connectionResolverFn');
      expect(deps).toHaveProperty('out');
    });

    it('should provide function types for all dependencies', () => {
      const deps = createDefaultFleetDeps();

      expect(typeof deps.resolveIdentityFn).toBe('function');
      expect(typeof deps.gatewayTransportFactory).toBe('function');
      expect(typeof deps.directTransportFactory).toBe('function');
      expect(typeof deps.hostPortResolverFn).toBe('function');
      expect(typeof deps.registryFactory).toBe('function');
      expect(typeof deps.connectionResolverFn).toBe('function');
      expect(typeof deps.out).toBe('function');
    });

    it('should use console.log for default output', () => {
      const deps = createDefaultFleetDeps();
      const spy = jest.spyOn(console, 'log').mockImplementation();

      deps.out('test message');

      expect(spy).toHaveBeenCalledWith('test message');
      spy.mockRestore();
    });

    it('should create working resolveIdentityFn', () => {
      const deps = createDefaultFleetDeps();
      const identity = deps.resolveIdentityFn({ roles: ['bit:read'] });

      expect(identity).toBeDefined();
      expect(identity).toHaveProperty('agentName');
    });

    it('should create working gatewayTransportFactory', () => {
      const deps = createDefaultFleetDeps();
      const transport = deps.gatewayTransportFactory(
        'http://localhost:3000',
        { token: 'test-token', agentName: 'test', roles: [] }
      );

      expect(transport).toBeDefined();
      expect(transport).toHaveProperty('type');
    });

    it('should create working directTransportFactory', () => {
      const deps = createDefaultFleetDeps();
      const mockRegistry: any = { list: jest.fn() };
      const transport = deps.directTransportFactory('test-bit', mockRegistry);

      expect(transport).toBeDefined();
      expect(transport).toHaveProperty('type');
    });

    it('should create working hostPortResolverFn', () => {
      const deps = createDefaultFleetDeps();
      const port = deps.hostPortResolverFn('tool-gateway', 3000);

      expect(port).toBeDefined();
      expect(typeof port).toBe('number');
    });

    it('should create working registryFactory', () => {
      const deps = createDefaultFleetDeps();
      const registry = deps.registryFactory({ projectId: 'test' });

      expect(registry).toBeDefined();
      expect(registry).toHaveProperty('type');
    });

    it('should create working connectionResolverFn', async () => {
      const deps = createDefaultFleetDeps();
      const connection = await deps.connectionResolverFn({ projectId: 'test' }, {});

      expect(connection).toBeDefined();
      expect(connection).toHaveProperty('type');
    });
  });

  describe('mergeFleetDeps', () => {
    it('should return default deps when no overrides provided', () => {
      const deps = mergeFleetDeps();

      expect(deps).toHaveProperty('resolveIdentityFn');
      expect(deps).toHaveProperty('gatewayTransportFactory');
      expect(deps).toHaveProperty('out');
    });

    it('should return default deps when empty overrides provided', () => {
      const deps = mergeFleetDeps({});

      expect(deps).toHaveProperty('resolveIdentityFn');
      expect(deps).toHaveProperty('out');
    });

    it('should merge custom output function', () => {
      const customOut = jest.fn();
      const deps = mergeFleetDeps({ out: customOut });

      expect(deps.out).toBe(customOut);
      if (deps.out) deps.out('test');
      expect(customOut).toHaveBeenCalledWith('test');
    });

    it('should merge custom resolveIdentityFn', () => {
      const customResolve = jest.fn(() => ({
        token: 'custom-token',
        agentName: 'custom-agent',
        roles: ['bit:operate'],
      }));
      const deps = mergeFleetDeps({ resolveIdentityFn: customResolve });

      const identity = deps.resolveIdentityFn!({ roles: ['bit:operate'] });
      expect(customResolve).toHaveBeenCalled();
      expect(identity.agentName).toBe('custom-agent');
    });

    it('should merge custom gatewayTransportFactory', () => {
      const customTransport: any = { type: 'custom-gateway' };
      const customFactory = jest.fn(() => customTransport);
      const deps = mergeFleetDeps({ gatewayTransportFactory: customFactory });

      const transport = deps.gatewayTransportFactory!(
        'http://localhost:3000',
        { token: 'test-token', agentName: 'test', roles: [] }
      );
      expect(customFactory).toHaveBeenCalled();
      expect(transport).toBe(customTransport);
    });

    it('should merge custom directTransportFactory', () => {
      const customTransport: any = { type: 'custom-direct' };
      const customFactory = jest.fn(() => customTransport);
      const deps = mergeFleetDeps({ directTransportFactory: customFactory });

      const mockRegistry: any = { list: jest.fn() };
      const transport = deps.directTransportFactory!('test-bit', mockRegistry);
      expect(customFactory).toHaveBeenCalled();
      expect(transport).toBe(customTransport);
    });

    it('should merge multiple overrides', () => {
      const customOut = jest.fn();
      const customResolve = jest.fn(() => ({
        token: 'multi-token',
        agentName: 'multi-agent',
        roles: [],
      }));

      const deps = mergeFleetDeps({
        out: customOut,
        resolveIdentityFn: customResolve,
      });

      expect(deps.out).toBe(customOut);
      expect(deps.resolveIdentityFn).toBe(customResolve);
      // Other deps should still be defaults
      expect(deps.gatewayTransportFactory).toBeDefined();
      expect(deps.hostPortResolverFn).toBeDefined();
    });

    it('should preserve all default deps when merging single override', () => {
      const customOut = jest.fn();
      const deps = mergeFleetDeps({ out: customOut });

      // Custom override applied
      expect(deps.out).toBe(customOut);

      // All defaults still present
      expect(deps.resolveIdentityFn).toBeDefined();
      expect(deps.gatewayTransportFactory).toBeDefined();
      expect(deps.directTransportFactory).toBeDefined();
      expect(deps.hostPortResolverFn).toBeDefined();
      expect(deps.registryFactory).toBeDefined();
      expect(deps.connectionResolverFn).toBeDefined();
    });
  });

  describe('Test Scenarios', () => {
    it('should support mocking for unit tests', () => {
      // Typical test pattern: inject mocks for all dependencies
      const mockOut = jest.fn();
      const mockIdentity = { token: 'test-token', agentName: 'test', roles: ['bit:read'] };
      const mockResolveIdentity = jest.fn(() => mockIdentity);
      const mockTransport: any = {
        call: jest.fn().mockResolvedValue({ success: true }),
      };
      const mockGatewayFactory = jest.fn(() => mockTransport);

      const deps = mergeFleetDeps({
        out: mockOut,
        resolveIdentityFn: mockResolveIdentity,
        gatewayTransportFactory: mockGatewayFactory,
      });

      // Use deps in test
      const identity = deps.resolveIdentityFn!({ roles: ['bit:read'] });
      const transport = deps.gatewayTransportFactory!(
        'http://localhost:3000',
        identity
      );
      if (deps.out) deps.out('Test output');

      // Verify mocks called correctly
      expect(mockResolveIdentity).toHaveBeenCalledWith({ roles: ['bit:read'] });
      expect(mockGatewayFactory).toHaveBeenCalled();
      expect(mockOut).toHaveBeenCalledWith('Test output');
    });

    it('should support partial mocking for integration tests', () => {
      // Integration test pattern: mock only external dependencies
      const mockOut: string[] = [];
      const deps = mergeFleetDeps({
        out: (line: string) => mockOut.push(line),
      });

      // Use real implementations for everything except output
      if (deps.out) {
        deps.out('Line 1');
        deps.out('Line 2');
      }

      expect(mockOut).toEqual(['Line 1', 'Line 2']);
      expect(deps.resolveIdentityFn).toBeDefined();
      expect(deps.gatewayTransportFactory).toBeDefined();
    });
  });
});
