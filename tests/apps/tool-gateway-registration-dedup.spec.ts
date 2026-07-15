// Regression test: the tool-gateway must NOT rewrite the mcp_servers Firestore doc on every
// registration heartbeat. Bits re-publish their registration periodically; the gateway used to
// upsert Firestore each time (stamping a fresh updatedAt/correlationId), which fired the
// RegistryWatcher's onSnapshot and re-loaded every server on a tight loop ("continually reloading").
// The gateway now skips the write when the meaningful payload is unchanged.

const setMock = jest.fn(async () => {});
const docMock = jest.fn(() => ({ set: setMock }));
const collectionMock = jest.fn(() => ({ doc: docMock }));
const dbMock: any = { collection: collectionMock };

jest.mock('../../src/common/firebase', () => ({
  getFirestore: () => dbMock,
}));

import { ToolGatewayServer } from '../../src/apps/tool-gateway';
import { INTERNAL_MCP_REGISTRATION_V1 } from '../../src/types/events';

function makeEvent(payload: any, correlationId: string): any {
  return { type: INTERNAL_MCP_REGISTRATION_V1, correlationId, payload };
}

describe('Tool Gateway registration write dedup', () => {
  let server: ToolGatewayServer;

  beforeEach(() => {
    setMock.mockClear();
    docMock.mockClear();
    collectionMock.mockClear();
    server = new ToolGatewayServer();
  });

  const basePayload = {
    name: 'event-router',
    url: 'http://event-router.bitbrat.local:3000/sse',
    transport: 'sse',
    status: 'active',
  };

  it('writes Firestore once for repeated identical registrations (different correlationIds)', async () => {
    await (server as any).handleMcpRegistration(makeEvent({ ...basePayload }, 'reg-1'));
    await (server as any).handleMcpRegistration(makeEvent({ ...basePayload }, 'reg-2'));
    await (server as any).handleMcpRegistration(makeEvent({ ...basePayload }, 'reg-3'));

    // Wait for fire-and-forget writes to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it('is independent of payload property ordering', async () => {
    await (server as any).handleMcpRegistration(
      makeEvent({ name: 'event-router', url: basePayload.url, transport: 'sse', status: 'active' }, 'reg-1')
    );
    // Same fields, different key order -> still considered unchanged.
    await (server as any).handleMcpRegistration(
      makeEvent({ status: 'active', transport: 'sse', url: basePayload.url, name: 'event-router' }, 'reg-2')
    );

    // Wait for fire-and-forget writes to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it('writes again when the meaningful payload changes', async () => {
    await (server as any).handleMcpRegistration(makeEvent({ ...basePayload }, 'reg-1'));
    // URL change is meaningful -> must re-persist.
    await (server as any).handleMcpRegistration(
      makeEvent({ ...basePayload, url: 'http://event-router.bitbrat.local:4000/sse' }, 'reg-2')
    );

    // Wait for fire-and-forget writes to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(setMock).toHaveBeenCalledTimes(2);
  });
});
