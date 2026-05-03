import { Request, Response } from 'express';
import { z } from 'zod';
import { McpServer } from '../common/mcp-server';
import { FirestoreManager } from '../common/resources/firestore-manager';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { INTERNAL_STORY_ENRICH_V1, InternalEventV2, AnnotationV1, INTERNAL_PERSISTENCE_SNAPSHOT_V1 } from '../types/events';

/**
 * StoryEngineMcpServer
 * Provides tools for interactive Choose Your Own Adventure storytelling.
 */
export class StoryEngineMcpServer extends McpServer {
  constructor() {
    super({
      serviceName: 'story-engine-mcp',
      healthPaths: ['/health'],
      resources: {
        firestore: new FirestoreManager(),
      },
    });
    this.setupMcpTools();
    this.setupEnrichmentConsumer();
  }

  private setupEnrichmentConsumer() {
    this.onMessage(INTERNAL_STORY_ENRICH_V1, async (data: InternalEventV2, _attributes, ctx) => {
      this.getLogger().info('Processing adventure enrichment', { 
        correlationId: data.correlationId,
        userId: data.identity.user?.id 
      });

      try {
        const userId = data.identity.user?.id;
        if (!userId) {
          this.getLogger().warn('Enrichment skipped: No userId in identity', { correlationId: data.correlationId });
          await this.next(data, 'SKIP');
          await ctx.ack();
          return;
        }

        const db = this.getFirestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const storyId = userDoc.data()?.active_story;

        if (!storyId) {
          this.getLogger().warn('Enrichment skipped: No active story for user', { userId, correlationId: data.correlationId });
          await this.next(data, 'SKIP');
          await ctx.ack();
          return;
        }

        const storyDoc = await db.collection('stories').doc(storyId).get();
        const storyData = storyDoc.data();

        if (!storyData) {
          this.getLogger().warn('Enrichment skipped: Story data missing', { storyId, correlationId: data.correlationId });
          await this.next(data, 'SKIP');
          await ctx.ack();
          return;
        }

        // Context Injection: Add adventure_context annotation
        const lastScene = storyData.history?.filter((h: any) => h.type === 'narrative_scene').pop();
        const worldState = storyData.worldState || {};
        
        const contextValue = {
          storyId,
          theme: storyData.theme,
          setting: storyData.setting,
          currentScene: lastScene?.scene || 'Story just started.',
          availableChoices: lastScene?.choices || [],
          worldStateSummary: JSON.stringify(worldState)
        };

        const annotation: AnnotationV1 = {
          id: uuidv4(),
          kind: 'instruction',
          label: 'adventure_context',
          value: JSON.stringify(contextValue),
          source: this.serviceName,
          createdAt: new Date().toISOString()
        };

        if (!data.annotations) data.annotations = [];
        data.annotations.push(annotation);

        await this.next(data, 'OK');
        await ctx.ack();
      } catch (error: any) {
        this.getLogger().error('Enrichment failed', { 
          correlationId: data.correlationId, 
          error: error.message 
        });
        await this.next(data, 'ERROR');
        await ctx.ack();
      }
    });
  }

  private getFirestore(): Firestore {
    const db = this.getResource<Firestore>('firestore');
    if (!db) {
      throw new Error('Firestore resource not initialized');
    }
    return db;
  }

  private setupMcpTools() {
    this.registerTool(
      'start_story',
      'Initializes a new Choose Your Own Adventure story session.',
      z.object({
        userId: z.string().describe('The unique ID of the user starting the story.'),
        theme: z.string().describe('The theme of the adventure (e.g., "cyberpunk", "high fantasy").'),
        setting: z.string().optional().describe('Optional specific setting description.'),
      }),
      async (args) => {
        const { userId, theme, setting } = args;
        const db = this.getFirestore();
        const storyId = uuidv4();

        this.getLogger().info('Starting new story', { userId, theme, setting, storyId });

        const storyDoc = {
          id: storyId,
          userId,
          theme,
          setting: setting || 'standard',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          worldState: {},
          history: [],
        };

        await db.collection('stories').doc(storyId).set(storyDoc);
        await db.collection('users').doc(userId).set({
          active_story: storyId,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        // Persistence Snapshotting
        await this.publishPersistenceSnapshot({
          kind: 'update',
          sourceTopic: 'mcp.tool.start_story',
          event: {
            correlationId: uuidv4(),
            type: 'chat.message.v1', // Placeholder type
            identity: { external: { id: userId, platform: 'system' }, user: { id: userId } },
            message: { text: `Story started: ${theme}`, at: new Date().toISOString() },
            metadata: { storyId, theme, setting: setting || 'standard' },
            annotations: [],
            routing: { stage: 'meta', slip: [], history: [] }
          } as any,
          changeSummary: `Started new story: ${storyId}`
        });

        return {
          content: [{ 
            type: 'text', 
            text: `Story started! ID: ${storyId}. Theme: ${theme}.\n\n[SYSTEM]: Please begin the narration for this ${theme} adventure.` 
          }],
        };
      }
    );

    this.registerTool(
      'get_current_scene',
      'Retrieves the current scene and available choices for an active story.',
      z.object({
        userId: z.string().describe('The unique ID of the user.'),
      }),
      async (args) => {
        const { userId } = args;
        const db = this.getFirestore();

        this.getLogger().info('Retrieving current scene', { userId });

        const userDoc = await db.collection('users').doc(userId).get();
        const storyId = userDoc.data()?.active_story;

        if (!storyId) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'No active story found for this user. Start one with !adventure.' }],
          };
        }

        const storyDoc = await db.collection('stories').doc(storyId).get();
        const storyData = storyDoc.data();

        if (!storyData) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Active story data for ${storyId} is missing.` }],
          };
        }

        const lastScene = storyData.history
          ?.filter((h: any) => h.type === 'narrative_scene')
          .pop();

        return {
          content: [{ 
            type: 'text', 
            text: lastScene ? `Scene: ${lastScene.scene}\n\nChoices:\n${lastScene.choices.join('\n')}` : 'Story started. Waiting for first narration.'
          }],
        };
      }
    );

    this.registerTool(
      'process_action',
      'Processes a user action (numbered choice or free-text) and returns the consequence.',
      z.object({
        userId: z.string().describe('The unique ID of the user.'),
        action: z.string().describe('The action taken by the user (e.g. "1" or "I search the room").'),
      }),
      async (args) => {
        const { userId, action } = args;
        const db = this.getFirestore();

        this.getLogger().info('Processing action', { userId, action });

        const userDoc = await db.collection('users').doc(userId).get();
        const storyId = userDoc.data()?.active_story;

        if (!storyId) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'No active story found.' }],
          };
        }

        // Logic here is mainly to record the intent. The actual narration comes from llm-bot.
        // We append the action to history.
        const actionEntry = {
          type: 'user_action',
          action,
          timestamp: new Date().toISOString(),
        };

        await db.collection('stories').doc(storyId).update({
          history: FieldValue.arrayUnion(actionEntry),
          updatedAt: new Date().toISOString(),
        });

        // Persistence Snapshotting
        await this.publishPersistenceSnapshot({
          kind: 'update',
          sourceTopic: 'mcp.tool.process_action',
          event: {
            correlationId: uuidv4(),
            type: 'chat.message.v1',
            identity: { external: { id: userId, platform: 'system' }, user: { id: userId } },
            message: { text: action, at: new Date().toISOString() },
            metadata: { storyId, action },
            annotations: [],
            routing: { stage: 'meta', slip: [], history: [] }
          } as any,
          changeSummary: `Recorded action: ${action}`
        });
        
        return {
          content: [{ type: 'text', text: `Action "${action}" recorded. Narrating consequence...` }],
        };
      }
    );

    this.registerTool(
      'commit_scene',
      'Persists a narrative scene and updates the story state.',
      z.object({
        userId: z.string().describe('The unique ID of the user.'),
        scene: z.string().describe('The narrative text of the scene.'),
        choices: z.array(z.string()).describe('Available choices for the user.'),
        worldStateMutation: z.record(z.any()).optional().describe('Optional updates to the world state.'),
      }),
      async (args) => {
        const { userId, scene, choices, worldStateMutation } = args;
        const db = this.getFirestore();

        this.getLogger().info('Committing scene', { userId, choicesCount: choices.length });

        const userDoc = await db.collection('users').doc(userId).get();
        const storyId = userDoc.data()?.active_story;

        if (!storyId) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'No active story found.' }],
          };
        }

        const narrativeEntry = {
          type: 'narrative_scene',
          scene,
          choices,
          timestamp: new Date().toISOString(),
        };

        const updates: any = {
          history: FieldValue.arrayUnion(narrativeEntry),
          updatedAt: new Date().toISOString(),
        };

        if (worldStateMutation) {
          for (const [key, value] of Object.entries(worldStateMutation)) {
            updates[`worldState.${key}`] = value;
          }
        }

        await db.collection('stories').doc(storyId).update(updates);

        // Persistence Snapshotting
        await this.publishPersistenceSnapshot({
          kind: 'update',
          sourceTopic: 'mcp.tool.commit_scene',
          event: {
            correlationId: uuidv4(),
            type: 'chat.message.v1',
            identity: { external: { id: userId, platform: 'system' }, user: { id: userId } },
            message: { text: scene, at: new Date().toISOString() },
            metadata: { storyId, scene, choices, worldStateMutation },
            annotations: [],
            routing: { stage: 'meta', slip: [], history: [] }
          } as any,
          changeSummary: `Committed scene for story: ${storyId}`
        });

        return {
          content: [{ type: 'text', text: 'Scene committed successfully.' }],
        };
      }
    );

    this.registerTool(
      'update_world_state',
      'Manually updates specific world state variables (health, inventory, etc.).',
      z.object({
        userId: z.string().describe('The unique ID of the user.'),
        mutation: z.record(z.any()).describe('A map of state variables to update.'),
      }),
      async (args) => {
        const { userId, mutation } = args;
        const db = this.getFirestore();

        this.getLogger().info('Updating world state', { userId, mutation });

        const userDoc = await db.collection('users').doc(userId).get();
        const storyId = userDoc.data()?.active_story;

        if (!storyId) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'No active story found to update.' }],
          };
        }

        const updates: any = {};
        for (const [key, value] of Object.entries(mutation)) {
          updates[`worldState.${key}`] = value;
        }
        updates.updatedAt = new Date().toISOString();

        await db.collection('stories').doc(storyId).update(updates);

        // Persistence Snapshotting
        await this.publishPersistenceSnapshot({
          kind: 'update',
          sourceTopic: 'mcp.tool.update_world_state',
          event: {
            correlationId: uuidv4(),
            type: 'chat.message.v1',
            identity: { external: { id: userId, platform: 'system' }, user: { id: userId } },
            message: { text: 'World state updated', at: new Date().toISOString() },
            metadata: { storyId, mutation },
            annotations: [],
            routing: { stage: 'meta', slip: [], history: [] }
          } as any,
          changeSummary: `Updated world state for story: ${storyId}`
        });

        return {
          content: [{ type: 'text', text: `World state updated for ${userId}.` }],
        };
      }
    );
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await super.close(reason);
  }
}

if (require.main === module) {
  const server = new StoryEngineMcpServer();
  const port = parseInt(process.env.PORT || '8080', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start story-engine-mcp:', err);
    process.exit(1);
  });
}
