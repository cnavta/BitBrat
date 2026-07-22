import type { Express } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { Bit } from '../common/base-server';
import type { PublisherResource } from '../common/resources/publisher-manager';
import type { IDocumentStore, QueryFilter } from '../common/persistence/interfaces';
import {
  DEFAULT_DISPOSITION_CONFIG,
  DISPOSITION_OBSERVATION_COLLECTION,
  dispositionObservationDocumentId,
  dispositionStateKey,
  getDispositionConfig,
  INTERNAL_USER_DISPOSITION_OBSERVATION_V1,
  INTERNAL_USER_DISPOSITION_UPDATED_V1,
  type DispositionConfig,
  type DispositionObservationEventV1,
  type DispositionUpdatedEventV1,
  type StoredDispositionObservation,
} from '../types/disposition';
import { INTERNAL_STATE_MUTATION_V1, type MutationProposal } from '../types/state';
import { computeDispositionSnapshot } from '../services/disposition/scoring';

const SERVICE_NAME = process.env.SERVICE_NAME || 'disposition-service';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

// =============================================================================
// Disposition Observation Storage Abstraction
// =============================================================================

/**
 * Interface for disposition observation storage operations.
 */
export interface IDispositionObservationStore {
  /**
   * Upsert a disposition observation.
   * @param docId - Document ID
   * @param observation - Stored observation data
   */
  upsert(docId: string, observation: StoredDispositionObservation): Promise<void>;

  /**
   * Query active observations for a user within a time window.
   * @param userKey - User identifier
   * @param cutoffIso - ISO timestamp for oldest observation to include
   * @param maxEvents - Maximum number of events to return
   * @returns Array of observations ordered by observedAt descending
   */
  queryActive(userKey: string, cutoffIso: string, maxEvents: number): Promise<DispositionObservationEventV1[]>;
}

/**
 * Firestore implementation of disposition observation store.
 */
export class FirestoreDispositionObservationStore implements IDispositionObservationStore {
  constructor(
    private readonly firestore: Firestore,
    private readonly collectionName: string = DISPOSITION_OBSERVATION_COLLECTION
  ) {}

  async upsert(docId: string, observation: StoredDispositionObservation): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(docId).set(observation, { merge: true });
  }

  async queryActive(userKey: string, cutoffIso: string, maxEvents: number): Promise<DispositionObservationEventV1[]> {
    const snapshot = await this.firestore
      .collection(this.collectionName)
      .where('userKey', '==', userKey)
      .where('observedAt', '>=', cutoffIso)
      .orderBy('observedAt', 'desc')
      .limit(maxEvents)
      .get();

    return snapshot.docs.map((doc) => doc.data() as DispositionObservationEventV1);
  }
}

/**
 * PostgreSQL implementation of disposition observation store via IDocumentStore.
 */
export class DocumentStoreDispositionObservationStore implements IDispositionObservationStore {
  constructor(
    private readonly store: IDocumentStore,
    private readonly tableName: string = 'disposition_observations'
  ) {}

  async upsert(docId: string, observation: StoredDispositionObservation): Promise<void> {
    await this.store.set(this.tableName, docId, observation);
  }

  async queryActive(userKey: string, cutoffIso: string, maxEvents: number): Promise<DispositionObservationEventV1[]> {
    const filters: QueryFilter[] = [
      { field: 'userKey', operator: '==', value: userKey },
      { field: 'observedAt', operator: '>=', value: cutoffIso },
    ];

    const records = await this.store.query(this.tableName, {
      filters,
      orderBy: { field: 'observedAt', direction: 'desc' },
      limit: maxEvents,
    });

    return records as DispositionObservationEventV1[];
  }
}

/**
 * Factory function to create disposition observation store based on backend detection.
 */
export function createDispositionObservationStore(
  dbOrStore?: any,
  collectionOrTable?: string
): IDispositionObservationStore {
  // Check if Firestore instance
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreDispositionObservationStore(dbOrStore, collectionOrTable);
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreDispositionObservationStore(dbOrStore, collectionOrTable);
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    const { createDocumentStore } = require('../common/persistence/factory');
    const store = createDocumentStore();
    return new DocumentStoreDispositionObservationStore(store, collectionOrTable || 'disposition_observations');
  }

  // Fallback to Firestore (legacy, deprecated - default is PostgreSQL via factory.ts)
  return new FirestoreDispositionObservationStore(undefined as any, collectionOrTable || DISPOSITION_OBSERVATION_COLLECTION);
}

export class DispositionServiceServer extends Bit {
  private readonly dispositionConfig: DispositionConfig;
  private readonly observationStore: IDispositionObservationStore;

  constructor() {
    super({ serviceName: SERVICE_NAME });

    // Initialize repository (backend auto-detection via factory)
    // Use documentStore (PostgreSQL) or fallback to Firestore (legacy)
    const documentStore = this.getResource<any>('documentStore') || this.getResource<Firestore>('firestore');
    this.observationStore = createDispositionObservationStore(documentStore);

    this.dispositionConfig = getDispositionConfig(<T>(name: string, fallback: T) => {
      if (typeof fallback === 'boolean') {
        return this.getConfig<T>(name, { default: fallback, parser: ((value: any) => value === true || value === 'true') as any });
      }
      if (typeof fallback === 'number') {
        return this.getConfig<T>(name, { default: fallback, parser: ((value: any) => Number(value)) as any });
      }
      return this.getConfig<T>(name, { default: fallback });
    });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(_app: Express, _cfg: any) {
    _app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'ok', service: SERVICE_NAME });
    });

    try {
      const queue = SERVICE_NAME;
      await this.onMessage<DispositionObservationEventV1>(
        { destination: INTERNAL_USER_DISPOSITION_OBSERVATION_V1, queue, ack: 'explicit' },
        async (observation, _attributes, ctx) => {
          try {
            if (!this.dispositionConfig.enabled) {
              this.getLogger().info('disposition.disabled', { correlationId: observation?.correlationId });
              await ctx.ack();
              return;
            }

            if (!observation?.userKey || !observation?.correlationId || !observation?.observedAt) {
              this.getLogger().warn('disposition.observation.invalid', {
                correlationId: observation?.correlationId,
                userKey: observation?.userKey,
              });
              await ctx.ack();
              return;
            }

            await this.handleObservation(observation);
            await ctx.ack();
          } catch (error: any) {
            this.getLogger().error('disposition.observation.handler_error', {
              correlationId: observation?.correlationId,
              error: error?.message || String(error),
            });
            await ctx.ack();
          }
        }
      );
      this.getLogger().info('disposition.subscribe.ok', { destination: INTERNAL_USER_DISPOSITION_OBSERVATION_V1, queue });
    } catch (error: any) {
      this.getLogger().error('disposition.subscribe.error', { error: error?.message || String(error) });
    }
  }

  private async handleObservation(observation: DispositionObservationEventV1): Promise<void> {
    const nowIso = new Date().toISOString();
    const publisher = this.getResource<PublisherResource>('publisher');

    if (!publisher) throw new Error('Publisher not available');

    const expireAt = new Date(Date.parse(observation.observedAt) + this.dispositionConfig.windowMs + this.dispositionConfig.snapshotTtlMs).toISOString();
    const stored: StoredDispositionObservation = {
      ...observation,
      expireAt,
      sourcePlatform: observation.identity?.external?.platform,
      internalUserId: observation.identity?.userId,
    };

    const docId = dispositionObservationDocumentId(observation.userKey, observation.correlationId);
    await this.observationStore.upsert(docId, stored);
    this.getLogger().info('disposition.observation.persisted', {
      correlationId: observation.correlationId,
      userKey: observation.userKey,
      docId,
    });

    const active = await this.loadActiveObservations(observation.userKey, nowIso);
    const snapshot = computeDispositionSnapshot(active, this.dispositionConfig, nowIso);
    if (snapshot.band === 'insufficient-signal') {
      this.getLogger().info('disposition.window.low_signal', {
        correlationId: observation.correlationId,
        userKey: observation.userKey,
        messageCount: snapshot.window.messageCount,
      });
    }

    try {
      await this.publishStateMutation(publisher, observation, snapshot, nowIso);
      this.getLogger().info('disposition.snapshot.recomputed', {
        correlationId: observation.correlationId,
        userKey: observation.userKey,
        band: snapshot.band,
        messageCount: snapshot.window.messageCount,
      });
    } catch (error: any) {
      this.getLogger().error('disposition.snapshot.write_failed', {
        correlationId: observation.correlationId,
        userKey: observation.userKey,
        error: error?.message || String(error),
      });
      return;
    }

    if (this.dispositionConfig.publishUpdates) {
      const event: DispositionUpdatedEventV1 = {
        v: '1',
        correlationId: observation.correlationId,
        userKey: observation.userKey,
        snapshot,
        source: SERVICE_NAME,
        publishedAt: nowIso,
      };
      await this.publishJson(publisher, INTERNAL_USER_DISPOSITION_UPDATED_V1, event, {
        correlationId: observation.correlationId,
        type: INTERNAL_USER_DISPOSITION_UPDATED_V1,
      });
    }
  }

  private async loadActiveObservations(
    userKey: string,
    nowIso: string
  ): Promise<DispositionObservationEventV1[]> {
    const cutoff = new Date(Date.parse(nowIso) - this.dispositionConfig.windowMs).toISOString();
    return await this.observationStore.queryActive(userKey, cutoff, this.dispositionConfig.maxEvents);
  }

  private async publishStateMutation(
    publisher: PublisherResource,
    observation: DispositionObservationEventV1,
    snapshot: ReturnType<typeof computeDispositionSnapshot>,
    nowIso: string
  ): Promise<void> {
    const mutation: MutationProposal = {
      id: `${observation.correlationId}:disposition`,
      op: 'set',
      key: dispositionStateKey(observation.userKey),
      value: snapshot,
      actor: SERVICE_NAME,
      reason: 'disposition.snapshot.recomputed',
      ts: nowIso,
      ttl: Math.max(1, Math.ceil(this.dispositionConfig.snapshotTtlMs / 1000)),
      metadata: {
        correlationId: observation.correlationId,
        userKey: observation.userKey,
      },
    };

    await this.publishJson(publisher, INTERNAL_STATE_MUTATION_V1, mutation, {
      correlationId: observation.correlationId,
      type: INTERNAL_STATE_MUTATION_V1,
    });
  }

  private async publishJson(
    publisher: PublisherResource,
    topic: string,
    payload: unknown,
    attributes: Record<string, string>
  ): Promise<void> {
    const cfg: any = this.getConfig?.() || {};
    const prefix = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
    const subject = prefix && !topic.startsWith(prefix) ? `${prefix}${topic}` : topic;
    await publisher.create(subject).publishJson(payload, attributes);
  }
}

export function createApp() {
  const server = new DispositionServiceServer();
  return server.getApp();
}

if (require.main === module) {
  Bit.ensureRequiredEnv(SERVICE_NAME);
  const server = new DispositionServiceServer();
  void server.start(PORT);
}