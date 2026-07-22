import { Firestore, FieldValue } from 'firebase-admin/firestore';
import type { IDocumentStore } from '../../common/persistence/interfaces';

// =============================================================================
// Story Engine Repository Abstraction
// =============================================================================

/**
 * User document structure.
 */
export interface UserDoc {
  id: string;
  active_story?: string;
  updatedAt: string;
  [key: string]: any;
}

/**
 * Story document structure.
 */
export interface StoryDoc {
  id: string;
  userId: string;
  theme: string;
  setting: string;
  history: any[];
  worldState: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

/**
 * Interface for story engine storage operations.
 */
export interface IStoryRepository {
  /**
   * Get user by ID.
   */
  getUser(userId: string): Promise<UserDoc | null>;

  /**
   * Update user's active story.
   */
  setUserActiveStory(userId: string, storyId: string): Promise<void>;

  /**
   * Get story by ID.
   */
  getStory(storyId: string): Promise<StoryDoc | null>;

  /**
   * Create a new story.
   */
  createStory(story: StoryDoc): Promise<void>;

  /**
   * Append entry to story history array.
   * Handles FieldValue.arrayUnion for Firestore, JSONB array append for PostgreSQL.
   */
  appendToHistory(storyId: string, entry: any): Promise<void>;

  /**
   * Update story fields (for commit_scene and update_world_state).
   */
  updateStory(storyId: string, updates: Partial<StoryDoc>): Promise<void>;
}

/**
 * Firestore implementation of story repository.
 */
export class FirestoreStoryRepository implements IStoryRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly usersCollection: string = 'users',
    private readonly storiesCollection: string = 'stories'
  ) {}

  async getUser(userId: string): Promise<UserDoc | null> {
    const doc = await this.firestore.collection(this.usersCollection).doc(userId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as UserDoc;
  }

  async setUserActiveStory(userId: string, storyId: string): Promise<void> {
    await this.firestore.collection(this.usersCollection).doc(userId).set({
      active_story: storyId,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  async getStory(storyId: string): Promise<StoryDoc | null> {
    const doc = await this.firestore.collection(this.storiesCollection).doc(storyId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as StoryDoc;
  }

  async createStory(story: StoryDoc): Promise<void> {
    const { id, ...data } = story;
    await this.firestore.collection(this.storiesCollection).doc(id).set(data);
  }

  async appendToHistory(storyId: string, entry: any): Promise<void> {
    await this.firestore.collection(this.storiesCollection).doc(storyId).update({
      history: FieldValue.arrayUnion(entry),
      updatedAt: new Date().toISOString(),
    });
  }

  async updateStory(storyId: string, updates: Partial<StoryDoc>): Promise<void> {
    const { id, ...data } = updates as any;
    await this.firestore.collection(this.storiesCollection).doc(storyId).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * PostgreSQL implementation of story repository via IDocumentStore.
 */
export class DocumentStoreStoryRepository implements IStoryRepository {
  constructor(
    private readonly store: IDocumentStore,
    private readonly usersTable: string = 'users',
    private readonly storiesTable: string = 'stories'
  ) {}

  async getUser(userId: string): Promise<UserDoc | null> {
    const record = await this.store.get(this.usersTable, userId);
    if (!record) return null;
    return record as UserDoc;
  }

  async setUserActiveStory(userId: string, storyId: string): Promise<void> {
    // Fetch-modify-update pattern (upsert)
    const existing = await this.store.get(this.usersTable, userId);
    await this.store.set(this.usersTable, userId, {
      ...existing,
      id: userId,
      active_story: storyId,
      updatedAt: new Date().toISOString(),
    });
  }

  async getStory(storyId: string): Promise<StoryDoc | null> {
    const record = await this.store.get(this.storiesTable, storyId);
    if (!record) return null;
    return record as StoryDoc;
  }

  async createStory(story: StoryDoc): Promise<void> {
    await this.store.set(this.storiesTable, story.id, story);
  }

  async appendToHistory(storyId: string, entry: any): Promise<void> {
    // PostgreSQL: Fetch-modify-update for array append
    const story = await this.getStory(storyId);
    if (!story) {
      throw new Error(`Story ${storyId} not found`);
    }

    const updatedHistory = [...(story.history || []), entry];
    await this.store.set(this.storiesTable, storyId, {
      ...story,
      history: updatedHistory,
      updatedAt: new Date().toISOString(),
    });
  }

  async updateStory(storyId: string, updates: Partial<StoryDoc>): Promise<void> {
    const existing = await this.store.get(this.storiesTable, storyId);
    if (!existing) {
      throw new Error(`Story ${storyId} not found`);
    }

    await this.store.set(this.storiesTable, storyId, {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Factory function to create story repository based on backend detection.
 */
export function createStoryRepository(
  dbOrStore?: any,
  usersCollectionOrTable?: string,
  storiesCollectionOrTable?: string
): IStoryRepository {
  // Check if Firestore instance
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreStoryRepository(
      dbOrStore,
      usersCollectionOrTable || 'users',
      storiesCollectionOrTable || 'stories'
    );
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreStoryRepository(
      dbOrStore,
      usersCollectionOrTable || 'users',
      storiesCollectionOrTable || 'stories'
    );
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    throw new Error(
      'createStoryRepository: PostgreSQL driver selected but no IDocumentStore instance provided'
    );
  }

  // Fallback to Firestore (legacy, deprecated - default is PostgreSQL via factory.ts)
  return new FirestoreStoryRepository(
    undefined as any,
    usersCollectionOrTable || 'users',
    storiesCollectionOrTable || 'stories'
  );
}
