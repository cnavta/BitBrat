import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import type { InternalEventV2, InternalEventType, MessageV1, AnnotationV1 } from '../types/events';
import { McpServer } from "../common/mcp-server";
import { z } from "zod";
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import parser from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';
import { createMessagePublisher } from '../services/message-bus';

const SERVICE_NAME = process.env.SERVICE_NAME || 'scheduler';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);
const COLLECTION_NAME = 'schedules';

// --- Zod Schemas for MCP Tools ---

const ScheduleTypeSchema = z.enum(['once', 'cron']);

const EventDefinitionSchema = z.object({
  type: z.string().describe("InternalEventType for the produced event"),
  payload: z.record(z.any()).optional().describe("Payload for the InternalEventV2"),
  message: z.object({
    text: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system', 'tool']).default('system'),
  }).optional().describe("Optional message metadata"),
  annotations: z.array(z.record(z.any())).optional().describe("Optional annotations"),
});

const CreateScheduleSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  schedule: z.object({
    type: ScheduleTypeSchema,
    value: z.string().describe("ISO timestamp for 'once', or Cron expression for 'cron'"),
  }),
  event: EventDefinitionSchema,
  enabled: z.boolean().default(true),
});

const UpdateScheduleSchema = CreateScheduleSchema.partial();

const ScheduleIdSchema = z.object({
  id: z.string(),
});

// --- Internal Types ---

interface ScheduleDoc {
  id: string;
  title: string;
  description?: string;
  schedule: {
    type: 'once' | 'cron';
    value: string;
  };
  event: {
    type: InternalEventType;
    payload?: Record<string, any>;
    message?: Partial<MessageV1>;
    annotations?: AnnotationV1[];
  };
  enabled: boolean;
  lastRun?: Timestamp;
  nextRun?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

class SchedulerServer extends McpServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any);
    this.registerTools();
  }

  private async setupApp(app: Express) {
    // Listen for the "tick" event from Cloud Scheduler (via Pub/Sub or HTTP)
    // We'll support both for flexibility.
    
    // HTTP Trigger (POST /tick)
    this.onHTTPRequest({ path: '/tick', method: 'POST' }, async (req: Request, res: Response) => {
      this.getLogger().info('scheduler.tick.http_received');
      await this.handleTick();
      res.status(200).send('OK');
    });

    // Pub/Sub Trigger (internal.scheduler.tick)
    void this.onMessage('internal.scheduler.tick', async () => {
      this.getLogger().info('scheduler.tick.pubsub_received');
      await this.handleTick();
    });
  }

  private registerTools() {
    this.registerTool(
      "list_schedules",
      "List all scheduled events",
      z.object({
        enabledOnly: z.boolean().optional().default(false),
      }),
      async (args) => {
        const firestore = this.getResource<Firestore>('firestore');
        if (!firestore) throw new Error("Firestore not available");

        let query: any = firestore.collection(COLLECTION_NAME);
        if (args.enabledOnly) {
          query = query.where('enabled', '==', true);
        }

        const snapshot = await query.get();
        const schedules = snapshot.docs.map((doc: any) => ({
          id: doc.id,
          ...doc.data()
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(schedules, null, 2) }]
        };
      }
    );

    this.registerTool(
      "get_schedule",
      "Get details of a specific scheduled event",
      ScheduleIdSchema,
      async (args) => {
        const firestore = this.getResource<Firestore>('firestore');
        if (!firestore) throw new Error("Firestore not available");

        const doc = await firestore.collection(COLLECTION_NAME).doc(args.id).get();
        if (!doc.exists) {
          return {
            isError: true,
            content: [{ type: "text", text: `Schedule ${args.id} not found` }]
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ id: doc.id, ...doc.data() }, null, 2) }]
        };
      }
    );

    this.registerTool(
      "create_schedule",
      "Create a new scheduled event",
      CreateScheduleSchema,
      async (args) => {
        const firestore = this.getResource<Firestore>('firestore');
        if (!firestore) throw new Error("Firestore not available");

        const id = uuidv4();
        const nextRun = this.calculateNextRun(args.schedule.type, args.schedule.value);

        const doc: ScheduleDoc = {
          id,
          ...args,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          nextRun: nextRun ? Timestamp.fromDate(nextRun) : undefined,
        } as any;

        await firestore.collection(COLLECTION_NAME).doc(id).set(doc);

        return {
          content: [{ type: "text", text: `Schedule created with ID: ${id}` }]
        };
      }
    );

    this.registerTool(
      "update_schedule",
      "Update an existing scheduled event",
      UpdateScheduleSchema.extend({ id: z.string() }),
      async (args) => {
        const { id, ...updates } = args;
        const firestore = this.getResource<Firestore>('firestore');
        if (!firestore) throw new Error("Firestore not available");

        const docRef = firestore.collection(COLLECTION_NAME).doc(id);
        const doc = await docRef.get();
        if (!doc.exists) {
          return {
            isError: true,
            content: [{ type: "text", text: `Schedule ${id} not found` }]
          };
        }

        const data = doc.data() as ScheduleDoc;
        const newUpdates: any = {
          ...updates,
          updatedAt: Timestamp.now(),
        };

        if (updates.schedule) {
          const nextRun = this.calculateNextRun(updates.schedule.type, updates.schedule.value);
          newUpdates.nextRun = nextRun ? Timestamp.fromDate(nextRun) : null;
        } else if (updates.enabled === true && !data.nextRun) {
            // Re-calculate if being enabled and no nextRun exists
            const nextRun = this.calculateNextRun(data.schedule.type, data.schedule.value);
            newUpdates.nextRun = nextRun ? Timestamp.fromDate(nextRun) : null;
        }

        await docRef.update(newUpdates);

        return {
          content: [{ type: "text", text: `Schedule ${id} updated` }]
        };
      }
    );

    this.registerTool(
      "delete_schedule",
      "Remove a scheduled event",
      ScheduleIdSchema,
      async (args) => {
        const firestore = this.getResource<Firestore>('firestore');
        if (!firestore) throw new Error("Firestore not available");

        await firestore.collection(COLLECTION_NAME).doc(args.id).delete();

        return {
          content: [{ type: "text", text: `Schedule ${args.id} deleted` }]
        };
      }
    );
  }

  private calculateNextRun(type: 'once' | 'cron', value: string): Date | null {
    try {
      if (type === 'once') {
        const d = new Date(value);
        return d > new Date() ? d : null;
      } else {
        const interval = parser.parseExpression(value);
        return interval.next().toDate();
      }
    } catch (e) {
      this.getLogger().error('scheduler.calculate_next_run.error', { type, value, error: e });
      return null;
    }
  }

  private async handleTick() {
    const firestore = this.getResource<Firestore>('firestore');
    if (!firestore) {
      this.getLogger().error('scheduler.tick.firestore_missing');
      return;
    }

    const now = Timestamp.now();
    const snapshot = await firestore.collection(COLLECTION_NAME)
      .where('enabled', '==', true)
      .where('nextRun', '<=', now)
      .get();

    this.getLogger().info('scheduler.tick.executing', { count: snapshot.size });

    const publisher = createMessagePublisher('internal.ingress.v1');

    for (const doc of snapshot.docs) {
      const data = doc.data() as ScheduleDoc;
      try {
        await this.executeSchedule(data, publisher);
        
        // Update nextRun
        const nextRun = this.calculateNextRun(data.schedule.type, data.schedule.value);
        await doc.ref.update({
          lastRun: now,
          nextRun: nextRun ? Timestamp.fromDate(nextRun) : null,
          enabled: data.schedule.type === 'once' ? false : data.enabled,
          updatedAt: now,
        });
      } catch (e) {
        this.getLogger().error('scheduler.execute.error', { id: doc.id, error: e });
      }
    }
  }

  private async executeSchedule(schedule: ScheduleDoc, publisher: any) {
    const now = new Date().toISOString();
    const correlationId = uuidv4();
    const event: InternalEventV2 = {
      v: '2',
      correlationId,
      traceId: uuidv4(),
      type: schedule.event.type,
      ingress: {
        ingressAt: now,
        source: 'scheduler',
      },
      identity: {
        external: {
          id: 'scheduler',
          platform: 'system',
        }
      },
      egress: { destination: 'system' },
      payload: schedule.event.payload || {},
      message: schedule.event.message ? {
        id: uuidv4(),
        role: schedule.event.message.role || 'system',
        text: schedule.event.message.text,
      } : undefined,
      annotations: schedule.event.annotations,
    };

    this.getLogger().info('scheduler.executing_event', { 
        id: schedule.id, 
        type: event.type, 
        correlationId: event.correlationId 
    });
    
    await publisher.publishJson(event, {
        source: 'scheduler',
        type: event.type,
        correlationId: event.correlationId
    });
  }
}

export function createApp() {
  const server = new SchedulerServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new SchedulerServer();
  void server.start(PORT);
}
