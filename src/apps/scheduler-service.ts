import { Bit } from '../common/base-server';
import { Express, Request, Response } from 'express';
import type {
  InternalEventV2,
  InternalEventType,
  MessageV1,
  AnnotationV1,
  CandidateV1,
  QOSV1,
  ExternalEventV1,
  Egress,
  Ingress,
  Identity,
} from '../types/events';
import { z } from "zod";
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import parser from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';
import { createMessagePublisher } from '../services/message-bus';
import {
  buildInternalEventSchemaPack,
  buildSchedulerGuidePack,
  SCHEMA_INTERNAL_EVENT_V2_PACK_ID,
  SCHEMA_INTERNAL_EVENT_V2_RESOURCE_URI,
  SCHEDULER_GUIDE_PACK_ID,
  SCHEDULER_GUIDE_RESOURCE_URI,
} from '../common/context';
import {
  createScheduleRepository,
  type IScheduleRepository,
  type ScheduleDoc,
  type ScheduledEventInput,
} from '../services/scheduler/repository';

const SERVICE_NAME = process.env.SERVICE_NAME || 'scheduler';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);
const COLLECTION_NAME = 'schedules';

// --- Topic governance (sprint-329, OD-1 Plan of Record) ---
// The scheduler may publish a scheduled event on any of the topics below (curated subset of the
// governed architecture.yaml topic catalog). When a schedule does not specify a `topic`, the event
// is published on DEFAULT_PUBLISH_TOPIC. Keep this list in lockstep with the scheduler's
// `topics.publishes` entry in architecture.yaml (Law #2).
export const DEFAULT_PUBLISH_TOPIC = 'internal.ingress.v1';
export const ALLOWED_PUBLISH_TOPICS = [
  'internal.ingress.v1',
  'internal.egress.v1',
] as const;

// --- Zod Schemas for MCP Tools ---

const ScheduleTypeSchema = z.enum(['once', 'cron']);

// ConnectorType mirror (src/types/events.ts) — kept in lockstep (G2/Law #2).
const ConnectorTypeSchema = z.enum(['twitch', 'discord', 'twilio', 'webhook', 'api', 'system']);

// Egress authoring shape mirrors src/types/events.ts `Egress`.
const EgressSchema = z.object({
  destination: z.string().describe("Destination/entry point for the message (e.g. 'twitch')"),
  type: z.enum(['chat', 'dm', 'event']).optional(),
  connector: ConnectorTypeSchema.describe("Delivery connector (e.g. 'twitch')"),
  channel: z.string().optional().describe("#channel or room ID"),
  metadata: z.record(z.any()).optional(),
});

// Ingress overrides (author-settable subset); server always owns ingressAt + source ('scheduler').
const IngressOverrideSchema = z.object({
  connector: ConnectorTypeSchema.optional(),
  channel: z.string().optional(),
});

// MessageV1 mirror (src/types/events.ts). `id` is server-fillable when omitted.
const MessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system', 'tool']).default('system'),
  text: z.string().optional(),
  language: z.string().optional(),
  rawPlatformPayload: z.record(z.any()).optional(),
});

// AnnotationV1 mirror (src/types/events.ts) — typed, not z.record(z.any()).
const AnnotationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  source: z.string(),
  createdAt: z.string(),
  confidence: z.number().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  score: z.number().optional(),
  payload: z.record(z.any()).optional(),
});

// CandidateV1 mirror (src/types/events.ts).
const CandidateSchema = z.object({
  id: z.string(),
  kind: z.string(),
  source: z.string(),
  createdAt: z.string(),
  status: z.enum(['proposed', 'selected', 'superseded', 'rejected']),
  priority: z.number(),
  confidence: z.number().optional(),
  text: z.string().optional(),
  format: z.string().optional(),
  reason: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// QOSV1 mirror (src/types/events.ts).
const QosSchema = z.object({
  persistenceTtlSec: z.number().optional(),
  tracer: z.boolean().optional(),
  maxResponseMs: z.number().optional(),
});

// ExternalEventV1 mirror (src/types/events.ts).
const ExternalEventSchema = z.object({
  id: z.string(),
  source: z.string(),
  kind: z.string(),
  version: z.string(),
  createdAt: z.string(),
  metadata: z.record(z.any()).optional(),
  rawPayload: z.record(z.any()).optional(),
});

// Full InternalEventV2 authoring shape (sprint-329). The author may set the event type plus the
// OD-2 author-settable subset; the server still owns v/correlationId/traceId/ingress.ingressAt/
// ingress.source/routing at execution time.
const EventDefinitionSchema = z.object({
  type: z.string().describe("InternalEventType for the produced event (e.g. 'llm.request.v1')"),
  egress: EgressSchema.optional().describe(
    "Where the event is delivered. Defaults to { destination: 'system', connector: 'system' } when unset. " +
    "Set { connector: 'twitch', destination: 'twitch', channel: '#<channel>' } to target Twitch."
  ),
  ingress: IngressOverrideSchema.optional().describe("Optional ingress overrides (connector/channel); ingressAt + source are server-owned"),
  identity: z.record(z.any()).optional().describe("Optional identity (defaults to the scheduler system identity)"),
  payload: z.record(z.any()).optional().describe("Payload for the InternalEventV2"),
  message: MessageSchema.optional().describe("Optional message (MessageV1)"),
  annotations: z.array(AnnotationSchema).optional().describe("Optional annotations (AnnotationV1[])"),
  candidates: z.array(CandidateSchema).optional().describe("Optional candidates (CandidateV1[])"),
  qos: QosSchema.optional().describe("Optional quality-of-service hints (QOSV1)"),
  externalEvent: ExternalEventSchema.optional().describe("Optional behavioral external event (ExternalEventV1)"),
  metadata: z.record(z.any()).optional().describe("Optional free-form event metadata"),
});

// Topic the event is published on. Optional; defaults to internal.ingress.v1. Validated against the
// curated governed allow-list (OD-1).
const TopicSchema = z
  .string()
  .refine((t) => (ALLOWED_PUBLISH_TOPICS as readonly string[]).includes(t), {
    message: `topic must be one of: ${ALLOWED_PUBLISH_TOPICS.join(', ')}`,
  })
  .describe(`Topic to publish on; defaults to ${DEFAULT_PUBLISH_TOPIC} when unset`);

export const CreateScheduleSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  schedule: z.object({
    type: ScheduleTypeSchema,
    value: z.string().describe("ISO timestamp for 'once', or Cron expression for 'cron'"),
  }),
  event: EventDefinitionSchema,
  topic: TopicSchema.optional(),
  enabled: z.boolean().default(true),
});

const UpdateScheduleSchema = CreateScheduleSchema.partial();

const ScheduleIdSchema = z.object({
  id: z.string(),
});

// --- Internal Types ---
// ScheduledEventInput and ScheduleDoc are now defined in src/services/scheduler/repository.ts

class SchedulerServer extends Bit {
  private scheduleRepo: IScheduleRepository;

  constructor() {
    super({ serviceName: SERVICE_NAME, mcpExposure: 'platform+domain' });

    // Initialize repository (backend auto-detection via factory)
    const firestore = this.getResource<Firestore>('firestore');
    this.scheduleRepo = createScheduleRepository(firestore, COLLECTION_NAME);

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
    void this.onMessage('internal.scheduler.tick', async (_data, _attributes, ctx) => {
      this.getLogger().info('scheduler.tick.pubsub_received');
      try {
        await this.handleTick();
        await ctx.ack();
      } catch (e: any) {
        this.getLogger().error('scheduler.tick.pubsub_failed', { error: e.message });
        await ctx.ack(); // Avoid loops
      }
    });
  }

  private registerTools() {
    // Just-in-Time Context Provisioning (sprint-328, P0/P1 + sprint-338 P4 RAG): contribute the
    // scheduler usage guide and InternalEventV2 schema pack, expose both as MCP Resources for tool
    // turns, and bind them to create_schedule so an agent understands both how to use the scheduler
    // and that a "prompt" is an AnnotationV1 of kind 'prompt' on a type: 'llm.request.v1' event.
    const schedulerPack = buildSchedulerGuidePack();
    const schemaPack = buildInternalEventSchemaPack();

    this.registerContextPack(schedulerPack);
    this.registerContextPack(schemaPack);

    this.registerResource(
      SCHEDULER_GUIDE_RESOURCE_URI,
      schedulerPack.title,
      'Scheduler usage guide: schedule types, event structure, and common use cases.',
      async (uri) => ({
        contents: [{ uri, mimeType: 'text/markdown', text: String(schedulerPack.body) }],
      })
    );
    this.registerResource(
      SCHEMA_INTERNAL_EVENT_V2_RESOURCE_URI,
      schemaPack.title,
      'InternalEventV2 / AnnotationV1 contract explainer (generated from src/types/events.ts).',
      async (uri) => ({
        contents: [{ uri, mimeType: 'text/markdown', text: String(schemaPack.body) }],
      })
    );

    this.registerTool(
      "list_schedules",
      "List all scheduled events",
      z.object({
        enabledOnly: z.boolean().optional().default(false),
      }),
      async (args) => {
        const schedules = await this.scheduleRepo.list(args.enabledOnly);

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
        const schedule = await this.scheduleRepo.get(args.id);
        if (!schedule) {
          return {
            isError: true,
            content: [{ type: "text", text: `Schedule ${args.id} not found` }]
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(schedule, null, 2) }]
        };
      }
    );

    this.registerToolWithContext(
      "create_schedule",
      "Create a new scheduled event. The 'event' is a full InternalEventV2: a 'prompt' is NOT an event type \u2014 it is an AnnotationV1 of kind 'prompt' (event.annotations[]), and the driving event type is typically 'llm.request.v1'. You may set 'event.egress' to address a delivery target, e.g. { connector: 'twitch', destination: 'twitch', channel: '#<channel>' } (egress defaults to { connector: 'system', destination: 'system' } when unset). An optional top-level 'topic' selects the publish topic (one of: internal.ingress.v1, internal.egress.v1; defaults to internal.ingress.v1). See the context://schema/internal-event-v2 resource for the full contract.",
      CreateScheduleSchema,
      async (args) => {
        const id = uuidv4();
        const now = new Date();
        const nextRun = this.calculateNextRun(args.schedule.type, args.schedule.value);

        const doc: ScheduleDoc = {
          id,
          ...args,
          event: args.event as ScheduledEventInput,
          createdAt: now,
          updatedAt: now,
          nextRun: nextRun || undefined,
        };

        await this.scheduleRepo.create(doc);

        return {
          content: [{ type: "text", text: `Schedule created with ID: ${id}` }]
        };
      },
      [SCHEDULER_GUIDE_PACK_ID, SCHEMA_INTERNAL_EVENT_V2_PACK_ID]
    );

    this.registerTool(
      "update_schedule",
      "Update an existing scheduled event",
      UpdateScheduleSchema.extend({ id: z.string() }),
      async (args) => {
        const { id, ...updates } = args;

        const existing = await this.scheduleRepo.get(id);
        if (!existing) {
          return {
            isError: true,
            content: [{ type: "text", text: `Schedule ${id} not found` }]
          };
        }

        const newUpdates: Partial<ScheduleDoc> = {
          ...updates,
          event: updates.event ? (updates.event as ScheduledEventInput) : undefined,
          updatedAt: new Date(),
        };

        if (updates.schedule) {
          const nextRun = this.calculateNextRun(updates.schedule.type, updates.schedule.value);
          newUpdates.nextRun = nextRun || undefined;
        } else if (updates.enabled === true && !existing.nextRun) {
          // Re-calculate if being enabled and no nextRun exists
          const nextRun = this.calculateNextRun(existing.schedule.type, existing.schedule.value);
          newUpdates.nextRun = nextRun || undefined;
        }

        await this.scheduleRepo.update(id, newUpdates);

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
        await this.scheduleRepo.delete(args.id);

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
    const now = new Date();
    const dueSchedules = await this.scheduleRepo.getDueSchedules(now);

    this.getLogger().info('scheduler.tick.executing', { count: dueSchedules.length });

    // Publishers are created/cached per distinct topic so each schedule is emitted on its own
    // topic (default internal.ingress.v1). Subject IS the publish topic (message-bus contract).
    const publishers = new Map<string, ReturnType<typeof createMessagePublisher>>();
    const getPublisher = (topic: string) => {
      let publisher = publishers.get(topic);
      if (!publisher) {
        publisher = createMessagePublisher(topic);
        publishers.set(topic, publisher);
      }
      return publisher;
    };

    for (const schedule of dueSchedules) {
      try {
        const topic = schedule.topic ?? DEFAULT_PUBLISH_TOPIC;
        await this.executeSchedule(schedule, getPublisher(topic));

        // Update nextRun
        const nextRun = this.calculateNextRun(schedule.schedule.type, schedule.schedule.value);
        await this.scheduleRepo.update(schedule.id, {
          lastRun: now,
          nextRun: nextRun ?? null,
          enabled: schedule.schedule.type === 'once' ? false : schedule.enabled,
          updatedAt: now,
        });
      } catch (e) {
        this.getLogger().error('scheduler.execute.error', { id: schedule.id, error: e });
      }
    }
  }

  private async executeSchedule(schedule: ScheduleDoc, publisher: any) {
    const now = new Date().toISOString();
    const correlationId = uuidv4();
    const authored = schedule.event;

    // Server-owned envelope fields (OD-2): v, correlationId, traceId, ingress.ingressAt/source, and
    // routing are ALWAYS set here and cannot be overridden by the author. The author-supplied
    // egress/identity/payload/message/annotations/candidates/qos/externalEvent/metadata (and the
    // ingress connector/channel overrides) are honored as-is.
    const event: InternalEventV2 = {
      v: '2',
      correlationId,
      traceId: uuidv4(),
      type: authored.type,
      ingress: {
        ingressAt: now,
        source: 'scheduler',
        connector: authored.ingress?.connector ?? 'system',
        ...(authored.ingress?.channel ? { channel: authored.ingress.channel } : {}),
      },
      identity: authored.identity ?? {
        external: {
          id: 'scheduler',
          platform: 'system',
        }
      },
      // Honor author-supplied egress; fall back to `system` ONLY when unset.
      egress: authored.egress ?? { destination: 'system', connector: 'system' },
      payload: authored.payload || {},
      message: authored.message ? {
        id: authored.message.id ?? uuidv4(),
        role: authored.message.role || 'system',
        text: authored.message.text,
        ...(authored.message.language ? { language: authored.message.language } : {}),
        ...(authored.message.rawPlatformPayload ? { rawPlatformPayload: authored.message.rawPlatformPayload } : {}),
      } : undefined,
      annotations: authored.annotations,
      candidates: authored.candidates,
      qos: authored.qos,
      externalEvent: authored.externalEvent,
      metadata: authored.metadata,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
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

export function createServer() {
  return new SchedulerServer();
}

export function createApp() {
  const server = new SchedulerServer();
  return server.getApp();
}

if (require.main === module) {
  Bit.ensureRequiredEnv(SERVICE_NAME);
  const server = new SchedulerServer();
  void server.start(PORT);
}
