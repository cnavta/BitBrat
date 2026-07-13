// Mock message bus to avoid NATS connection
jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: jest.fn(() => ({
    publishJson: jest.fn(async () => 'msg-id'),
    flush: jest.fn(async () => {}),
  })),
  createMessageSubscriber: jest.fn(() => ({
    subscribe: jest.fn(async () => async () => {}),
  })),
}));

// Mock OpenAI API with fixed embeddings
const mockEmbedding = Array(1536).fill(0).map((_, i) => Math.sin(i / 100));
jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    embeddings: {
      create: jest.fn(async () => ({
        data: [{ embedding: mockEmbedding }],
      })),
    },
  }));
  return MockOpenAI;
});

// Mock Firestore
const mockFirestoreData = new Map<string, any>();
const mockFirestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      set: jest.fn(async (data: any) => {
        mockFirestoreData.set(`${name}/${id}`, data);
      }),
      get: jest.fn(async () => ({
        exists: mockFirestoreData.has(`${name}/${id}`),
        data: () => mockFirestoreData.get(`${name}/${id}`),
      })),
    }),
    where: jest.fn((field: string, op: string, value: any) => {
      // Return query object with findNearest method
      return {
        findNearest: jest.fn((vectorField: string, vector: number[], opts: any) => {
          // Return query object with get method
          return {
            get: jest.fn(async () => {
              // Simulate vector search results with cosine distance
              const docs: any[] = [];
              mockFirestoreData.forEach((data, key) => {
                // Apply where filter first
                if (key.startsWith(`${name}/`) && field === 'active' && data.active === value) {
                  // Simulate cosine distance (for tests, return low distance = high similarity)
                  // In real Firestore Vector Search, _distance is added by the query
                  docs.push({
                    id: key.split('/')[1],
                    data: () => ({
                      ...data,
                      _distance: 0.1, // Low distance = high similarity (1 - 0.1 = 0.9 similarity)
                    }),
                  });
                }
              });
              return { docs };
            }),
          };
        }),
      };
    }),
  }),
};

jest.mock('../../src/common/firebase', () => ({
  getFirestore: () => mockFirestore,
}));

import { ContextPackServer } from '../../src/apps/context-pack-service';
import { InternalEventV2, INTERNAL_MCP_REGISTRATION_V1, INTERNAL_CONTEXT_V1 } from '../../src/types/events';
import { ContextPack } from '../../src/common/context';

describe('Context Pack RAG Integration', () => {
  let server: ContextPackServer;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.RAG_CONTEXT_ENABLED = 'true';
    process.env.RAG_CONTEXT_MAX_RESULTS = '5';
    process.env.RAG_CONTEXT_MIN_SIMILARITY = '0.7';
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(async () => {
    mockFirestoreData.clear();
    server = new ContextPackServer();
  });

  afterEach(async () => {
    await server.close('test');
  });

  describe('RAG-only discovery', () => {
    it('should discover packs via RAG when semantically relevant', async () => {
      // Seed Firestore with a pack NOT statically bound
      const ragOnlyPack: ContextPack = {
        id: 'scheduler.cron-syntax',
        version: '1',
        title: 'Cron Syntax Guide',
        priority: 2,
        format: 'markdown',
        body: '# Cron Syntax\n\nUse cron expressions to schedule tasks at specific intervals.',
        source: 'src/apps/scheduler-service.ts',
      };

      mockFirestoreData.set('context_packs/scheduler.cron-syntax', {
        id: ragOnlyPack.id,
        version: ragOnlyPack.version,
        title: ragOnlyPack.title,
        priority: ragOnlyPack.priority,
        format: ragOnlyPack.format,
        body: ragOnlyPack.body,
        source: ragOnlyPack.source,
        bitName: 'scheduler',
        active: true,
        embedding: mockEmbedding,
        embeddingText: `${ragOnlyPack.title}\n\n${String(ragOnlyPack.body).slice(0, 500)}`,
        updatedAt: new Date().toISOString(),
      });

      // Create event with semantically relevant query
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-rag-discovery',
        type: 'llm.request.v1',
        message: {
          id: 'msg-1',
          role: 'user',
          text: 'run a task every 5 minutes',
        },
        annotations: [],
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'api',
        },
        identity: {
          external: {
            id: 'test-user',
            platform: 'test',
          },
        },
        egress: {
          destination: 'test',
          connector: 'api',
        },
        routing: {
          stage: 'analysis',
          slip: [],
          history: [],
        },
      };

      // Process via context-pack enrichment
      await (server as any).enrichContextPacks(event);

      // Assert: Context pack annotation was added
      expect(event.annotations).toBeDefined();
      expect(event.annotations!.length).toBeGreaterThan(0);

      const contextAnnotation = event.annotations!.find(
        (a) => a.kind === 'context' && a.source === 'context-pack'
      );

      expect(contextAnnotation).toBeDefined();
      expect(contextAnnotation!.payload?.packId).toBe('scheduler.cron-syntax');
      expect(contextAnnotation!.label).toBe('Cron Syntax Guide');
    });
  });

  describe('Feature flag disabled', () => {
    it('should not add RAG packs when RAG_CONTEXT_ENABLED=false', async () => {
      process.env.RAG_CONTEXT_ENABLED = 'false';
      const newServer = new ContextPackServer();

      // Seed Firestore with a pack
      mockFirestoreData.set('context_packs/test.pack', {
        id: 'test.pack',
        version: '1',
        title: 'Test Pack',
        priority: 3,
        format: 'markdown',
        body: 'Test content',
        source: 'test',
        bitName: 'test',
        active: true,
        embedding: mockEmbedding,
        embeddingText: 'Test Pack\n\nTest content',
        updatedAt: new Date().toISOString(),
      });

      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-flag-disabled',
        type: 'llm.request.v1',
        message: {
          id: 'msg-2',
          role: 'user',
          text: 'test query',
        },
        annotations: [],
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'api',
        },
        identity: {
          external: {
            id: 'test-user',
            platform: 'test',
          },
        },
        egress: {
          destination: 'test',
          connector: 'api',
        },
        routing: {
          stage: 'analysis',
          slip: [],
          history: [],
        },
      };

      await (newServer as any).enrichContextPacks(event);

      // Assert: No context annotations added
      expect(event.annotations!.length).toBe(0);

      await newServer.close('test');
      process.env.RAG_CONTEXT_ENABLED = 'true';
    });
  });

  describe('Empty query handling', () => {
    it('should skip enrichment when no user query present', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-no-query',
        type: 'llm.request.v1',
        message: {
          id: 'msg-3',
          role: 'user',
        },
        annotations: [],
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'api',
        },
        identity: {
          external: {
            id: 'test-user',
            platform: 'test',
          },
        },
        egress: {
          destination: 'test',
          connector: 'api',
        },
        routing: {
          stage: 'analysis',
          slip: [],
          history: [],
        },
      };

      await (server as any).enrichContextPacks(event);

      // Assert: No annotations added
      expect(event.annotations!.length).toBe(0);
    });
  });

  describe('MCP registration and Firestore upsert', () => {
    it('should aggregate providers and upsert packs on MCP registration', async () => {
      const packs: ContextPack[] = [
        {
          id: 'test.pack1',
          version: '1',
          title: 'Test Pack 1',
          priority: 2,
          format: 'markdown',
          body: 'Test content 1',
          source: 'test-service.ts',
        },
      ];

      const registrationEvent: InternalEventV2 = {
        v: '2',
        correlationId: 'test-registration',
        type: INTERNAL_MCP_REGISTRATION_V1,
        payload: {
          name: 'test-service',
          url: 'http://test:3000/sse',
          context: {
            packs,
            bindings: [{ pack: 'test.pack1', when: { tools: ['test_tool'] } }],
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-service',
          connector: 'system',
        },
        identity: {
          external: {
            id: 'system',
            platform: 'system',
          },
        },
        egress: {
          destination: 'system',
          connector: 'system',
        },
        routing: {
          stage: 'meta',
          slip: [],
          history: [],
        },
      };

      await (server as any).handleMcpRegistration(registrationEvent);

      // Assert: Provider registered
      const providers = (server as any).contextProviders;
      expect(providers.has('test-service')).toBe(true);

      // Assert: Pack upserted to Firestore
      expect(mockFirestoreData.has('context_packs/test.pack1')).toBe(true);
      const storedPack = mockFirestoreData.get('context_packs/test.pack1');
      expect(storedPack.id).toBe('test.pack1');
      expect(storedPack.bitName).toBe('test-service');
      expect(storedPack.active).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle RAG failures gracefully (non-fatal)', async () => {
      // Mock OpenAI to throw error
      const openai = require('openai');
      openai.mockImplementationOnce(() => ({
        embeddings: {
          create: jest.fn(async () => {
            throw new Error('OpenAI API error');
          }),
        },
      }));

      const errorServer = new ContextPackServer();

      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-error',
        type: 'llm.request.v1',
        message: {
          id: 'msg-4',
          role: 'user',
          text: 'test query',
        },
        annotations: [],
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'api',
        },
        identity: {
          external: {
            id: 'test-user',
            platform: 'test',
          },
        },
        egress: {
          destination: 'test',
          connector: 'api',
        },
        routing: {
          stage: 'analysis',
          slip: [],
          history: [],
        },
      };

      // Should not throw
      await expect((errorServer as any).enrichContextPacks(event)).resolves.not.toThrow();

      // Assert: No annotations added (graceful degradation)
      expect(event.annotations!.length).toBe(0);

      await errorServer.close('test');
    });
  });

  describe('Annotation format', () => {
    it('should add context annotations with correct structure', async () => {
      mockFirestoreData.set('context_packs/test.annotation', {
        id: 'test.annotation',
        version: '2',
        title: 'Annotation Test Pack',
        priority: 1,
        format: 'markdown',
        body: '# Test\nContent here',
        source: 'test.ts',
        bitName: 'test',
        active: true,
        embedding: mockEmbedding,
        embeddingText: 'Annotation Test Pack\n\n# Test\nContent here',
        updatedAt: new Date().toISOString(),
      });

      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-annotation-format',
        type: 'llm.request.v1',
        message: {
          id: 'msg-5',
          role: 'user',
          text: 'test annotation format',
        },
        annotations: [],
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'api',
        },
        identity: {
          external: {
            id: 'test-user',
            platform: 'test',
          },
        },
        egress: {
          destination: 'test',
          connector: 'api',
        },
        routing: {
          stage: 'analysis',
          slip: [],
          history: [],
        },
      };

      await (server as any).enrichContextPacks(event);

      const annotation = event.annotations![0];

      // Assert: Annotation structure
      expect(annotation).toMatchObject({
        kind: 'context',
        source: 'context-pack',
        label: 'Annotation Test Pack',
      });

      expect(annotation.id).toBeDefined();
      expect(annotation.createdAt).toBeDefined();

      // Assert: Payload structure
      expect(annotation.payload).toMatchObject({
        packId: 'test.annotation',
        content: '# Test\nContent here',
        priority: 1,
      });

      expect(annotation.payload?.subheader).toContain('test.annotation');
      expect(annotation.payload?.subheader).toContain('v2');
    });
  });
});
