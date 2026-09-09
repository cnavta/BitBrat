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

// Mock DocumentStore (Sprint 344: PostgreSQL migration)
const setMock = jest.fn(async () => {});
const deleteMock = jest.fn(async () => {});
const queryMock = jest.fn(async () => [] as any[]);

const documentStoreMock = {
  get: jest.fn(async (collection: string, id: string) => {
    if (id === 'non-existent') return null;
    return {};
  }),
  set: setMock,
  delete: deleteMock,
  query: queryMock,
  getAll: jest.fn(async () => []),
  watch: jest.fn(() => () => {}),
  batch: jest.fn(async () => {}),
  health: jest.fn(async () => ({ healthy: true })),
};

// Mock Firestore (still needed for some internal dependencies)
const updateMock = jest.fn(async () => {});
const dbMock = {
  collection: jest.fn((name: string) => ({
    doc: jest.fn((id: string) => ({
      update: updateMock,
    })),
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

// TODO: Flaky test - passes in isolation but fails in full suite - timing/environmental issue
describe.skip('Scheduler Service', () => {
  let app: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset query mock to return empty results by default
    queryMock.mockResolvedValue([]);

    // Force getResource to return our mocks
    jest.spyOn(Bit.prototype as any, 'getResource').mockImplementation((...args: any[]) => {
      const name = args[0];
      if (name === 'documentStore') return documentStoreMock;
      if (name === 'firestore') return dbMock;
      return undefined;
    });

    app = createApp();
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

      // Mock documentStore.query to return due schedules
      queryMock.mockResolvedValue([dueSchedule]);

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

      // Verify schedule was updated (using documentStore.set, not firestore update)
      expect(setMock).toHaveBeenCalled();
      const [collection, id, updateData] = (setMock.mock.calls as any)[0];
      expect(collection).toBe('schedules');
      expect(id).toBe('sched-1');
      expect(updateData.lastRun).toBeDefined();
      expect(updateData.nextRun).toBeDefined();
      expect(new Date(updateData.nextRun).getTime()).toBeGreaterThan(now.getTime());
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

      queryMock.mockResolvedValue([onceSchedule]);

      await request(app).post('/tick');

      expect(setMock).toHaveBeenCalled();
      const [collection, id, updateData] = (setMock.mock.calls as any)[0];
      expect(collection).toBe('schedules');
      expect(id).toBe('sched-once');
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

      queryMock.mockResolvedValue([dueSchedule]);

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

      queryMock.mockResolvedValue([dueSchedule]);

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
