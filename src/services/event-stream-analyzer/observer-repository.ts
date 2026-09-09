import type { IDocumentStore } from '../../common/persistence/interfaces';
import type { StreamObserver } from '../../types/sessi';
import { logger as globalLogger } from '../../common/logging';

/**
 * ObserverRepository
 *
 * Manages CRUD operations for StreamObserver configurations using PostgreSQL persistence.
 *
 * Collection: 'stream_observers'
 * Backend: PostgreSQL (via IDocumentStore abstraction)
 *
 * Phase 2: Database-backed observer lifecycle management
 */
export class ObserverRepository {
  private readonly collection = 'stream_observers';
  private logger: any;

  constructor(
    private documentStore: IDocumentStore,
    logger?: any
  ) {
    this.logger = logger || globalLogger;
  }

  /**
   * Create a new observer
   *
   * @param observer - StreamObserver configuration
   * @returns The created observer with timestamps
   */
  async create(observer: StreamObserver): Promise<StreamObserver> {
    const now = new Date().toISOString();
    const observerWithTimestamps: StreamObserver = {
      ...observer,
      createdAt: observer.createdAt || now,
      updatedAt: now
    };

    this.logger.info('observer_repository.create.start', {
      observerId: observer.id,
      active: observer.active,
      windowType: observer.window?.type
    });

    try {
      await this.documentStore.set(
        this.collection,
        observer.id,
        observerWithTimestamps
      );

      this.logger.info('observer_repository.create.success', {
        observerId: observer.id
      });

      return observerWithTimestamps;
    } catch (error: any) {
      this.logger.error('observer_repository.create.error', {
        observerId: observer.id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get an observer by ID
   *
   * @param id - Observer ID
   * @returns Observer if found, null otherwise
   */
  async get(id: string): Promise<StreamObserver | null> {
    this.logger.debug('observer_repository.get', { observerId: id });

    try {
      const observer = await this.documentStore.get<StreamObserver>(
        this.collection,
        id
      );

      if (!observer) {
        this.logger.debug('observer_repository.get.not_found', {
          observerId: id
        });
      }

      return observer;
    } catch (error: any) {
      this.logger.error('observer_repository.get.error', {
        observerId: id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * List observers with optional filters
   *
   * @param filters - Optional filters (active status)
   * @returns Array of matching observers
   */
  async list(filters?: { active?: boolean }): Promise<StreamObserver[]> {
    this.logger.debug('observer_repository.list', { filters });

    try {
      let observers: StreamObserver[];

      if (filters?.active !== undefined) {
        // Query with active filter
        observers = await this.documentStore.query<StreamObserver>(
          this.collection,
          {
            filters: [
              { field: 'active', operator: '==', value: filters.active }
            ],
            orderBy: { field: 'created_at', direction: 'desc' }
          }
        );
      } else {
        // Get all observers
        observers = await this.documentStore.getAll<StreamObserver>(
          this.collection
        );
      }

      this.logger.info('observer_repository.list.success', {
        count: observers.length,
        filters
      });

      return observers;
    } catch (error: any) {
      this.logger.error('observer_repository.list.error', {
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Update an existing observer
   *
   * @param id - Observer ID
   * @param changes - Partial observer updates
   */
  async update(id: string, changes: Partial<StreamObserver>): Promise<void> {
    this.logger.info('observer_repository.update.start', {
      observerId: id,
      changes: Object.keys(changes)
    });

    try {
      // Get existing observer first
      const existing = await this.get(id);
      if (!existing) {
        throw new Error(`Observer not found: ${id}`);
      }

      // Merge changes with existing data
      const updated: StreamObserver = {
        ...existing,
        ...changes,
        id, // Ensure ID doesn't change
        updatedAt: new Date().toISOString()
      };

      await this.documentStore.set(
        this.collection,
        id,
        updated
      );

      this.logger.info('observer_repository.update.success', {
        observerId: id
      });
    } catch (error: any) {
      this.logger.error('observer_repository.update.error', {
        observerId: id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Delete an observer
   *
   * @param id - Observer ID
   */
  async delete(id: string): Promise<void> {
    this.logger.info('observer_repository.delete', { observerId: id });

    try {
      await this.documentStore.delete(this.collection, id);

      this.logger.info('observer_repository.delete.success', {
        observerId: id
      });
    } catch (error: any) {
      this.logger.error('observer_repository.delete.error', {
        observerId: id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get count of active observers
   *
   * @returns Count of active observers
   */
  async getActiveCount(): Promise<number> {
    try {
      const activeObservers = await this.list({ active: true });
      return activeObservers.length;
    } catch (error: any) {
      this.logger.error('observer_repository.get_active_count.error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if an observer exists
   *
   * @param id - Observer ID
   * @returns True if observer exists
   */
  async exists(id: string): Promise<boolean> {
    const observer = await this.get(id);
    return observer !== null;
  }
}
