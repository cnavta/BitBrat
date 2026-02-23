import { McpServer } from '../../src/common/mcp-server';
import { RuleMapper } from '../../src/services/router/rule-mapper';
import { Express } from 'express';
import request from 'supertest';
import { z } from 'zod';

// Mock McpServer as it's hard to test SSE with supertest easily
// We'll test the tool handlers directly or through a mock server that exposes them via JSON
class TestEventRouterServer extends McpServer {
  constructor(private mockDb: any) {
    super({ serviceName: 'event-router-test' });
    this.setupTestRoutes();
    this.registerAdminTools();
  }

  // Override to avoid actual SSE setup if needed, but here we want to test tools
  private setupTestRoutes() {
    this.onHTTPRequest({ path: '/test/tool/:name', method: 'POST' }, async (req, res) => {
      const toolName = req.params.name;
      const args = req.body;
      try {
        const result = await this.executeTool(toolName, args);
        res.json(result);
      } catch (e: any) {
        console.error('Test tool execute error:', e);
        res.status(500).json({ error: e.message });
      }
    });
  }

  // Same registerAdminTools as in event-router-service.ts
  private registerAdminTools() {
    const db = this.mockDb;

    this.registerTool(
      'list_rules',
      'List all active routing rules stored in Firestore.',
      z.object({}),
      async () => {
        const snap = await db.collection('configs/routingRules/rules').get();
        const rules = snap.docs.map((doc: any) => ({
          id: doc.id,
          description: doc.data().description,
          priority: doc.data().priority,
          enabled: doc.data().enabled,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(rules, null, 2) }] };
      }
    );

    this.registerTool(
      'create_rule',
      'Create a new routing rule with specific logic and routing slip.',
      z.object({
        logic: z.string(),
        services: z.array(z.string()),
        description: z.string().optional(),
        priority: z.number().optional().default(100),
        promptTemplate: z.string().optional(),
        responseTemplate: z.string().optional(),
        customAnnotation: z.object({
          key: z.string(),
          value: z.string(),
        }).optional(),
      }),
      async (params) => {
        try {
          const ruleDoc = RuleMapper.mapToRuleDoc(params);
          const res = await db.collection('configs/routingRules/rules').add({
            ...ruleDoc,
            createdAt: '2026-02-22T20:00:00Z',
          });
          return {
            content: [{ type: 'text', text: `Successfully created rule ${res.id}` }],
          };
        } catch (e: any) {
          return { content: [{ type: 'text', text: e.message }], isError: true };
        }
      }
    );
  }

  // Mock getResource
  public getResource(name: string): any {
    if (name === 'firestore') return this.mockDb;
    return super.getResource(name);
  }
}

describe('EventRouter MCP Tools Integration', () => {
  let mockDb: any;
  let server: TestEventRouterServer;
  let app: Express;

  beforeEach(() => {
    const docs = new Map();
    mockDb = {
      collection: (path: string) => ({
        get: async () => ({
          docs: Array.from(docs.entries()).map(([id, data]) => ({ id, data: () => data }))
        }),
        add: async (data: any) => {
          const id = 'new-rule-id-' + Math.random();
          docs.set(id, data);
          return { id };
        },
        doc: (id: string) => ({
            get: async () => ({
                exists: docs.has(id),
                id,
                data: () => docs.get(id)
            })
        })
      })
    };
    server = new TestEventRouterServer(mockDb);
    app = server.getApp() as any;
  });

  it('should create a rule via create_rule tool', async () => {
    const res = await request(app)
      .post('/test/tool/create_rule')
      .send({
        logic: 'true',
        services: ['llm-bot'],
        description: 'Test rule',
        promptTemplate: 'Hello'
      });

    expect(res.status).toBe(200);
    expect(res.body.content[0].text).toContain('Successfully created rule');
  });

  it('should list rules via list_rules tool', async () => {
    // Add a rule first
    await mockDb.collection('configs/routingRules/rules').add({
      enabled: true,
      priority: 10,
      description: 'Existing Rule',
      logic: 'true'
    });

    const res = await request(app)
      .post('/test/tool/list_rules')
      .send({});

    expect(res.status).toBe(200);
    const rules = JSON.parse(res.body.content[0].text);
    expect(rules).toHaveLength(1);
    expect(rules[0].description).toBe('Existing Rule');
  });
});
