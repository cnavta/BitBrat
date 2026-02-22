import { StateEngineServer } from '../../../src/apps/state-engine';
import { MutationProposal } from '../../../src/types/state';

// Mock McpServer and BaseServer dependencies
jest.mock('firebase-admin/firestore');
jest.mock('../../../src/common/resources/publisher-manager');
jest.mock('../../../src/common/logging');
jest.mock('../../../src/common/base-server', () => {
  return {
    BaseServer: class {
      static ensureRequiredEnv = jest.fn();
      static computeRequiredKeysFromArchitecture = jest.fn().mockReturnValue([]);
      static loadArchitectureYaml = jest.fn().mockReturnValue({ project: { version: '1.0.0' }, services: {} });
      protected logger: any;
      protected serviceName: string;
      protected app: any;
      protected config: any;
      protected resources: any = {};
      constructor(opts: any = {}) {
        this.serviceName = opts.serviceName || 'test-service';
        this.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      }
      getLogger() { return this.logger; }
      getApp() { return { get: jest.fn(), post: jest.fn(), use: jest.fn() }; }
      getConfig() { return {}; }
      getResource(k: string) { return this.resources[k]; }
      onHTTPRequest = jest.fn();
      subscribe = jest.fn();
    }
  };
});

describe('StateEngineServer', () => {
  let server: any;
  let mockFirestore: any;
  let mockPublisher: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockFirestore = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
      get: jest.fn(),
      set: jest.fn(),
      runTransaction: jest.fn(),
      where: jest.fn().mockReturnThis(),
    };

    mockPublisher = {
      create: jest.fn().mockReturnThis(),
      publishJson: jest.fn().mockResolvedValue('msg-id'),
    };

    // Instantiate server and manually inject resources
    server = new StateEngineServer();
    (server as any).resources = {
      firestore: mockFirestore,
      publisher: mockPublisher,
    };
  });

  describe('handleMutation', () => {
    it('should accept valid mutation and commit to firestore', async () => {
      const mutation: MutationProposal = {
        id: 'mut-1',
        op: 'set',
        key: 'stream.state',
        value: 'on',
        actor: 'test-actor',
        reason: 'test-reason',
        ts: new Date().toISOString(),
      };

      // Mock transaction success
      mockFirestore.runTransaction.mockImplementation(async (cb: any) => {
        const transaction = {
          get: jest.fn().mockResolvedValue({ exists: false }),
          set: jest.fn(),
        };
        await cb(transaction);
      });

      await (server as any).handleMutation(mutation);

      expect(mockFirestore.runTransaction).toHaveBeenCalled();
    });

    it('should reject mutations with non-allowed keys', async () => {
      const mutation: MutationProposal = {
        id: 'mut-2',
        op: 'set',
        key: 'forbidden.key',
        value: 'hacked',
        actor: 'attacker',
        reason: 'malice',
        ts: new Date().toISOString(),
      };

      await (server as any).handleMutation(mutation);

      expect(mockFirestore.runTransaction).not.toHaveBeenCalled();
      expect(mockFirestore.collection).toHaveBeenCalledWith('mutation_log');
    });

    it('should handle version mismatch', async () => {
       const mutation: MutationProposal = {
        id: 'mut-3',
        op: 'set',
        key: 'stream.state',
        value: 'on',
        actor: 'test-actor',
        reason: 'stale update',
        ts: new Date().toISOString(),
        expectedVersion: 5,
      };

      mockFirestore.runTransaction.mockImplementation(async (cb: any) => {
        const transaction = {
          get: jest.fn().mockResolvedValue({ 
            exists: true, 
            data: () => ({ version: 10 }) 
          }),
          set: jest.fn(),
        };
        await cb(transaction);
      });

      await (server as any).handleMutation(mutation);
      
      expect(mockFirestore.collection).toHaveBeenCalledWith('mutation_log');
    });
  });

  describe('evaluateRules', () => {
    it('should trigger publishEgress when stream.state becomes on', async () => {
      await (server as any).evaluateRules('stream.state', 'on');
      expect(mockPublisher.create).toHaveBeenCalled();
      expect(mockPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system.stream.online' }),
        expect.anything()
      );
    });

    it('should NOT trigger egress for other values', async () => {
      await (server as any).evaluateRules('stream.state', 'off');
      expect(mockPublisher.create).not.toHaveBeenCalled();
    });
  });
});
