// Regression test: the event-router must self-publish its MCP registration on boot so the
// tool-gateway can discover it. The service entrypoint previously called app.listen() directly,
// bypassing Bit.start() and therefore publishRegistration() — leaving event-router absent from the
// tool-gateway's registered servers. This test asserts that starting the Bit publishes an
// INTERNAL_MCP_REGISTRATION_V1 event naming this service.

// Mock message bus (no real NATS/PubSub). Capture every publishJson call so we can assert the
// registration self-publish that Bit.start() performs once listening.
const publishJsonMock = jest.fn(async (..._args: any[]) => {});
jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: () => ({ publishJson: publishJsonMock }),
  createMessageSubscriber: () => ({ subscribe: jest.fn(async () => () => {}) }),
}));

// Mock Firestore so construction/start does not touch real Firestore.
const dbMock: any = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({ get: async () => ({ exists: false }), set: jest.fn(), update: jest.fn(), add: jest.fn() })),
  })),
};
jest.mock('../../src/common/resources/firestore-manager', () => ({
  FirestoreManager: class { setup() { return dbMock; } shutdown() {} },
}));
jest.mock('../../src/common/firebase', () => ({ getFirestore: () => dbMock }));

import { createServer as createRouter } from '../../src/apps/event-router-service';
import { INTERNAL_MCP_REGISTRATION_V1 } from '../../src/types/events';

describe('Event-router registry self-publish on start', () => {
  beforeEach(() => {
    publishJsonMock.mockClear();
  });

  it('publishes an INTERNAL_MCP_REGISTRATION_V1 event for itself once started', async () => {
    const server = createRouter();
    // Port 0 -> OS-assigned ephemeral port (no conflicts in CI).
    await server.start(0);
    try {
      const registration = publishJsonMock.mock.calls
        .map((c) => c[0] as any)
        .find((evt) => evt && evt.type === INTERNAL_MCP_REGISTRATION_V1);

      expect(registration).toBeDefined();
      expect(registration.payload?.name).toBe((server as any).serviceName);
      expect(registration.payload?.transport).toBe('sse');
      expect(typeof registration.payload?.url).toBe('string');
      expect(registration.payload?.status).toBe('active');
    } finally {
      await server.close('test');
    }
  });
});
