import { Request, Response } from 'express';
import { z } from 'zod';
import { McpServer } from '../common/mcp-server';
import { FirestoreManager } from '../common/resources/firestore-manager';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';

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

        return {
          content: [{ type: 'text', text: `Story started! ID: ${storyId}. Theme: ${theme}` }],
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

        const lastSnapshot = storyData.history?.[storyData.history.length - 1];

        return {
          content: [{ 
            type: 'text', 
            text: lastSnapshot ? `Scene: ${lastSnapshot.scene}\n\nChoices:\n${lastSnapshot.choices.join('\n')}` : 'Story started. Waiting for first narration.'
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
        
        return {
          content: [{ type: 'text', text: `Action "${action}" recorded. Narrating consequence...` }],
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
