import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';

// Mock message bus
const publishJsonMock = jest.fn(async () => {});
jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: () => ({
    publishJson: publishJsonMock,
  }),
  createMessageSubscriber: () => ({
    subscribe: jest.fn(async () => () => {}),
  }),
}));

// Mock Firestore
const setMock = jest.fn(async () => {});
const updateMock = jest.fn(async () => {});
const deleteMock = jest.fn(async () => {});

const makeDoc = (id: string, data: any) => ({
  id,
  exists: true,
  data: () => data,
  ref: { update: updateMock },
});

const getMock = jest.fn();
const whereMock = jest.fn();

const dbMock = {
  collection: jest.fn((name: string) => ({
    doc: jest.fn((id: string) => ({
      get: async () => id === 'non-existent' ? { exists: false } : makeDoc(id, {}),
      set: setMock,
      update: updateMock,
      delete: deleteMock,
    })),
    where: whereMock,
    get: getMock,
  })),
};

jest.mock('../../src/common/resources/firestore-manager', () => ({
  FirestoreManager: class {
    setup() { return dbMock; }
    shutdown() {}
  }
}));

import { createApp } from '../../src/apps/scheduler-service';
import { BaseServer } from '../../src/common/base-server';

describe('Scheduler Service', () => {
  let app: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Force getResource to return our mocks
    jest.spyOn(BaseServer.prototype as any, 'getResource').mockImplementation((...args: any[]) => {
      const name = args[0];
      if (name === 'firestore') return dbMock;
      return undefined;
    });

    app = createApp();
    whereMock.mockReturnValue({
      where: jest.fn().mockReturnValue({
        get: async () => ({ size: 0, docs: [] })
      })
    });
  });

  describe('HTTP /tick', () => {
    it('processes due schedules', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 10000);
      
      const dueSchedule = {
        id: 'sched-1',
        title: 'Test Schedule',
        enabled: true,
        nextRun: Timestamp.fromDate(past),
        schedule: { type: 'cron', value: '* * * * *' },
        event: { type: 'test.event', payload: { foo: 'bar' } },
      };

      whereMock.mockReturnValue({
        where: jest.fn().mockReturnValue({
          get: async () => ({
            size: 1,
            docs: [makeDoc('sched-1', dueSchedule)]
          })
        })
      });

      const response = await request(app).post('/tick');
      expect(response.status).toBe(200);

      // Verify event was published
      expect(publishJsonMock).toHaveBeenCalled();
      const [event, attrs] = (publishJsonMock.mock.calls as any)[0];
      expect(event.type).toBe('test.event');
      expect(event.payload.foo).toBe('bar');
      expect(event.ingress.source).toBe('scheduler');
      expect(attrs.source).toBe('scheduler');

      // Verify schedule was updated
      expect(updateMock).toHaveBeenCalled();
      const updateData = (updateMock.mock.calls as any)[0][0];
      expect(updateData.lastRun).toBeDefined();
      expect(updateData.nextRun).toBeDefined();
      expect(updateData.nextRun.toDate().getTime()).toBeGreaterThan(now.getTime());
    });

    it('handles once-off schedules by disabling them after run', async () => {
      const past = new Date(Date.now() - 10000);
      const onceSchedule = {
        id: 'sched-once',
        enabled: true,
        nextRun: Timestamp.fromDate(past),
        schedule: { type: 'once', value: past.toISOString() },
        event: { type: 'once.event' },
      };

      whereMock.mockReturnValue({
        where: jest.fn().mockReturnValue({
          get: async () => ({
            size: 1,
            docs: [makeDoc('sched-once', onceSchedule)]
          })
        })
      });

      await request(app).post('/tick');
      
      expect(updateMock).toHaveBeenCalled();
      const updateData = (updateMock.mock.calls as any)[0][0];
      expect(updateData.enabled).toBe(false);
      expect(updateData.nextRun).toBeNull();
    });
  });

  describe('MCP Tools', () => {
    // Note: Testing MCP tools via HTTP SSE is complex, 
    // but we can verify they were registered if we had access to the mcpServer.
    // For now, the successful /tick test covers the core logic.
  });
});
