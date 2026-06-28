// Integration tests for Just-in-Time Context Provisioning wiring (sprint-328).
// Covers: P0 resources + enriched descriptions on scheduler/event-router; P1/P2 bindings; additive
// + back-compat advertisement on INTERNAL_MCP_REGISTRATION_V1; gateway de-dup of the shared pack.

// Mock message bus (no real NATS/PubSub).
const publishJsonMock = jest.fn(async () => {});
jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: () => ({ publishJson: publishJsonMock }),
  createMessageSubscriber: () => ({ subscribe: jest.fn(async () => () => {}) }),
}));

// Mock Firestore manager so construction does not touch real Firestore.
const dbMock: any = { collection: jest.fn(() => ({ doc: jest.fn(() => ({ get: async () => ({ exists: false }), set: jest.fn(), update: jest.fn(), add: jest.fn() })) })) };
jest.mock('../../src/common/resources/firestore-manager', () => ({
  FirestoreManager: class { setup() { return dbMock; } shutdown() {} },
}));
jest.mock('../../src/common/firebase', () => ({ getFirestore: () => dbMock }));

import { createServer as createScheduler } from '../../src/apps/scheduler-service';
import { createServer as createRouter } from '../../src/apps/event-router-service';
import { ToolGatewayServer } from '../../src/apps/tool-gateway';
import {
  SCHEMA_INTERNAL_EVENT_V2_PACK_ID,
  SCHEMA_INTERNAL_EVENT_V2_RESOURCE_URI,
  ROUTER_JSONLOGIC_GUIDE_PACK_ID,
  ROUTER_JSONLOGIC_GUIDE_RESOURCE_URI,
} from '../../src/common/context';
import { INTERNAL_MCP_REGISTRATION_V1 } from '../../src/types/events';

describe('Scheduler context provisioning (P0/P1)', () => {
  const server = createScheduler();

  it('registers the context://schema/internal-event-v2 Resource resolving to a non-empty body', async () => {
    const uris = server.listResourceDescriptors().map((r) => r.uri);
    expect(uris).toContain(SCHEMA_INTERNAL_EVENT_V2_RESOURCE_URI);
    const body = await server.readRegisteredResource(SCHEMA_INTERNAL_EVENT_V2_RESOURCE_URI);
    const text = (body.contents?.[0] as any)?.text || '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('AnnotationV1');
  });

  it('enriches the create_schedule description with the prompt-annotation contract', () => {
    const desc = server.listToolDescriptors().find((t) => t.name === 'create_schedule')?.description || '';
    expect(desc).toContain('prompt');
    expect(desc).toContain('llm.request.v1');
  });

  it('binds create_schedule -> schema.internal-event-v2', () => {
    const bindings = server.listContextBindings();
    expect(bindings).toContainEqual({ pack: SCHEMA_INTERNAL_EVENT_V2_PACK_ID, when: { tools: ['create_schedule'] } });
    expect(server.listContextPacks().map((p) => p.id)).toContain(SCHEMA_INTERNAL_EVENT_V2_PACK_ID);
  });
});

describe('Event-router context provisioning (P0/P1/P2)', () => {
  const server = createRouter();

  it('registers the context://router/jsonlogic-guide Resource (non-empty body)', async () => {
    expect(server.listResourceDescriptors().map((r) => r.uri)).toContain(ROUTER_JSONLOGIC_GUIDE_RESOURCE_URI);
    const body = await server.readRegisteredResource(ROUTER_JSONLOGIC_GUIDE_RESOURCE_URI);
    const text = (body.contents?.[0] as any)?.text || '';
    expect(text).toContain('has_annotation');
  });

  it('binds create_rule -> [router.jsonlogic-guide, schema.internal-event-v2] and the rule-authoring task', () => {
    const bindings = server.listContextBindings();
    expect(bindings).toContainEqual({ pack: ROUTER_JSONLOGIC_GUIDE_PACK_ID, when: { tools: ['create_rule'] } });
    expect(bindings).toContainEqual({ pack: SCHEMA_INTERNAL_EVENT_V2_PACK_ID, when: { tools: ['create_rule'] } });
    expect(bindings).toContainEqual({ pack: ROUTER_JSONLOGIC_GUIDE_PACK_ID, when: { tasks: ['routing.create_rule'] } });
  });
});

describe('Tool-gateway JIT resolution + de-dup (P2)', () => {
  function regEvent(name: string, packs: any[], bindings: any[]) {
    return { v: '2', correlationId: `reg-${name}`, type: INTERNAL_MCP_REGISTRATION_V1, payload: { name, url: `http://${name}/sse`, transport: 'sse', status: 'active', context: { packs, bindings } } } as any;
  }

  it('injects the shared schema pack once across two bound tools (de-dup)', async () => {
    const gateway = new ToolGatewayServer();
    const scheduler = createScheduler();
    const router = createRouter();
    // Feed each Bit's real advertisement into the gateway.
    await (gateway as any).handleMcpRegistration(regEvent('scheduler', scheduler.listContextPacks(), scheduler.listContextBindings()));
    await (gateway as any).handleMcpRegistration(regEvent('event-router', router.listContextPacks(), router.listContextBindings()));

    const contexts = gateway.resolveContextForTools(['mcp:create_schedule', 'mcp:create_rule']);
    const subheaders = contexts.map((c) => c.subheader || '');
    const schemaCount = subheaders.filter((s) => s.includes(SCHEMA_INTERNAL_EVENT_V2_PACK_ID)).length;
    expect(schemaCount).toBe(1); // shared pack de-duped
    expect(subheaders.some((s) => s.includes(ROUTER_JSONLOGIC_GUIDE_PACK_ID))).toBe(true);
    await gateway.close('test');
  });

  it('is a no-op when no tools are bound (behavior-preserving)', () => {
    const gateway = new ToolGatewayServer();
    expect(gateway.resolveContextForTools(['mcp:unbound_tool'])).toEqual([]);
    expect(gateway.resolveContextForTools([])).toEqual([]);
  });

  it('parses an additive registration that omits context (back-compat)', async () => {
    const gateway = new ToolGatewayServer();
    const legacy = { v: '2', correlationId: 'reg-legacy', type: INTERNAL_MCP_REGISTRATION_V1, payload: { name: 'legacy', url: 'http://legacy/sse', transport: 'sse', status: 'active' } } as any;
    await expect((gateway as any).handleMcpRegistration(legacy)).resolves.not.toThrow();
    expect(gateway.resolveContextForTools(['mcp:create_schedule'])).toEqual([]);
    await gateway.close('test');
  });
});
