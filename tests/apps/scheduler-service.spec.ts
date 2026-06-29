import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';

// Mock message bus. createMessagePublisher's argument IS the publish topic (subject), so we capture
// it to assert per-schedule topic selection (sprint-329).
const publishJsonMock = jest.fn(async () => {});
const createMessagePublisherMock = jest.fn((_subject: string) => ({
  publishJson: publishJsonMock,
}));
jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: (subject: string) => createMessagePublisherMock(subject),
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

import {
  createApp,
  CreateScheduleSchema,
  DEFAULT_PUBLISH_TOPIC,
} from '../../src/apps/scheduler-service';
import { Bit } from '../../src/common/base-server';

describe('Scheduler Service', () => {
  let app: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Force getResource to return our mocks
    jest.spyOn(Bit.prototype as any, 'getResource').mockImplementation((...args: any[]) => {
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

      // No topic on the schedule -> published on the default topic.
      expect(createMessagePublisherMock).toHaveBeenCalledWith(DEFAULT_PUBLISH_TOPIC);

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

    it('honors author-supplied Twitch egress and the chosen topic (sprint-329)', async () => {
      const past = new Date(Date.now() - 10000);
      const twitchEgress = { connector: 'twitch', destination: 'twitch', channel: '#mychannel' };
      const dueSchedule = {
        id: 'sched-twitch',
        title: 'Scream on Twitch',
        enabled: true,
        nextRun: Timestamp.fromDate(past),
        schedule: { type: 'once', value: past.toISOString() },
        topic: 'internal.egress.v1',
        event: {
          type: 'egress.deliver.v1',
          egress: twitchEgress,
          message: { role: 'system', text: 'Scream!!!' },
        },
      };

      whereMock.mockReturnValue({
        where: jest.fn().mockReturnValue({
          get: async () => ({ size: 1, docs: [makeDoc('sched-twitch', dueSchedule)] })
        })
      });

      await request(app).post('/tick');

      expect(publishJsonMock).toHaveBeenCalled();
      const [event] = (publishJsonMock.mock.calls as any)[0];
      // Egress is passed through EXACTLY (no `system` overwrite).
      expect(event.egress).toEqual(twitchEgress);
      expect(event.message.text).toBe('Scream!!!');
      // Published on the schedule's chosen topic.
      expect(createMessagePublisherMock).toHaveBeenCalledWith('internal.egress.v1');
      // Server-owned envelope fields are still set by the scheduler.
      expect(event.v).toBe('2');
      expect(typeof event.correlationId).toBe('string');
      expect(event.ingress.source).toBe('scheduler');
      expect(event.routing).toEqual({ stage: 'initial', slip: [], history: [] });
    });

    it('falls back to system egress only when the schedule does not specify one', async () => {
      const past = new Date(Date.now() - 10000);
      const dueSchedule = {
        id: 'sched-default-egress',
        title: 'No egress',
        enabled: true,
        nextRun: Timestamp.fromDate(past),
        schedule: { type: 'once', value: past.toISOString() },
        event: { type: 'system.timer.v1' },
      };

      whereMock.mockReturnValue({
        where: jest.fn().mockReturnValue({
          get: async () => ({ size: 1, docs: [makeDoc('sched-default-egress', dueSchedule)] })
        })
      });

      await request(app).post('/tick');

      const [event] = (publishJsonMock.mock.calls as any)[0];
      expect(event.egress).toEqual({ destination: 'system', connector: 'system' });
      expect(createMessagePublisherMock).toHaveBeenCalledWith(DEFAULT_PUBLISH_TOPIC);
    });
  });

  describe('CreateScheduleSchema (sprint-329)', () => {
    const baseEvent = { type: 'llm.request.v1' };
    const baseSchedule = {
      title: 'T',
      schedule: { type: 'once', value: new Date().toISOString() },
    };

    it('accepts a full event with Twitch egress', () => {
      const parsed = CreateScheduleSchema.safeParse({
        ...baseSchedule,
        event: {
          type: 'egress.deliver.v1',
          egress: { connector: 'twitch', destination: 'twitch', channel: '#x' },
          payload: { foo: 'bar' },
        },
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects a malformed event.type', () => {
      const parsed = CreateScheduleSchema.safeParse({
        ...baseSchedule,
        event: { type: 123 as any },
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects an invalid egress.connector', () => {
      const parsed = CreateScheduleSchema.safeParse({
        ...baseSchedule,
        event: { type: 'egress.deliver.v1', egress: { connector: 'pager', destination: 'x' } as any },
      });
      expect(parsed.success).toBe(false);
    });

    it('accepts a known topic and rejects an unknown topic', () => {
      expect(
        CreateScheduleSchema.safeParse({ ...baseSchedule, event: baseEvent, topic: 'internal.egress.v1' }).success
      ).toBe(true);
      expect(
        CreateScheduleSchema.safeParse({ ...baseSchedule, event: baseEvent, topic: 'internal.bogus.v1' }).success
      ).toBe(false);
    });

    it('accepts an omitted topic (defaults applied at execution)', () => {
      const parsed = CreateScheduleSchema.safeParse({ ...baseSchedule, event: baseEvent });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.topic).toBeUndefined();
      }
    });
  });
});
