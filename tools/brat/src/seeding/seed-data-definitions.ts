/**
 * Sprint 352: Persistence-Agnostic Seed Data Definitions
 *
 * Story S6.1: Define canonical seed data based on initial-seed-data-spec.md.
 * This is the single source of truth for seed data, used by both PostgreSQL
 * and Firestore seed writers.
 */

import * as crypto from 'crypto';
import { SeedDataSet, SeedingOptions } from './seed-data-types';

/**
 * Generate complete seed data set
 *
 * @param options - Seeding options
 * @returns Complete seed data set
 */
export function generateSeedData(options: SeedingOptions = {}): SeedDataSet {
  const botName = options.botName || 'BitBrat';

  return {
    routingRules: getInitialRoutingRules(botName),
    reflexes: getInitialReflexes(),
    personalities: getInitialPersonalities(botName),
    contextPacks: getInitialContextPacks(),
    apiTokens: getInitialApiTokens(options.apiToken),
  };
}

/**
 * Get initial routing rules (4 rules from spec)
 */
function getInitialRoutingRules(botName: string) {
  return [
    // 1. Initial Contextualization
    {
      id: 'initial-contextualization',
      enabled: true,
      priority: 100,
      description: 'Route initial events to auth, reflex, query-analysis, and event-router for contextualization stage',
      logic: { '==': [{ var: 'routing.stage' }, 'initial'] },
      routingSlip: [
        { service: 'auth', topic: 'internal.auth.v1' },
        { service: 'reflex', topic: 'internal.reflex.v1' },
        { service: 'query-analysis', topic: 'internal.query.analysis.v1' },
        { service: 'event-router', topic: 'internal.enriched.v1' },
      ],
      stage: 'contextualization',
    },

    // 2. Bot Mention Reaction
    {
      id: 'contextualization-reaction-bot',
      enabled: true,
      priority: 50,
      description: 'Route bot mentions to LLM bot',
      logic: {
        and: [
          { '==': [{ var: 'routing.stage' }, 'contextualization'] },
          { text_contains: [{ var: 'message.text' }, botName, true] },
        ],
      },
      routingSlip: [
        { service: 'llm-bot', topic: 'internal.llmbot.v1' },
      ],
      stage: 'reaction',
      enrichments: {
        annotations: [
          {
            id: 'a1',
            kind: 'personality',
            value: botName,
          },
          {
            id: 'a2',
            kind: 'prompt',
            value: "Create an appropriate answer to user {{username}}'s latest message.",
          },
        ],
      },
    },

    // 3. Adventure Command
    {
      id: 'contextualization-reaction-adventure',
      enabled: true,
      priority: 40,
      description: 'Route !adventure commands to story engine and LLM bot',
      logic: {
        and: [
          { '==': [{ var: 'routing.stage' }, 'contextualization'] },
          { re_test: [{ var: 'message.text' }, '^!adventure', 'i'] },
        ],
      },
      routingSlip: [
        { service: 'story-engine', topic: 'internal.story.enrich.v1' },
        { service: 'llm-bot', topic: 'internal.llmbot.v1' },
      ],
      stage: 'reaction',
      enrichments: {
        annotations: [
          {
            id: 'a1',
            kind: 'personality',
            value: botName,
          },
          {
            id: 'a2',
            kind: 'prompt',
            value: 'The user is in adventure mode, please react accordingly',
          },
        ],
      },
    },

    // 4. Chuck Norris Joke
    {
      id: 'contextualization-reaction-cnj',
      enabled: true,
      priority: 100,
      description: 'Create a Chuck Norris Joke for the user',
      logic: {
        and: [
          { '==': [{ var: 'routing.stage' }, 'contextualization'] },
          { re_test: [{ var: 'message.text' }, '^cnj', 'i'] },
        ],
      },
      routingSlip: [
        { service: 'llm-bot', topic: 'internal.llmbot.v1' },
      ],
      stage: 'reaction',
      enrichments: {
        annotations: [
          {
            id: 'a1',
            kind: 'prompt',
            value: 'Generate one original Chuck Norris joke. Do not reuse classic structures like roundhouse kicks, counting to infinity, or glaring-atoms tropes. Avoid tech-centric humor unless it\'s genuinely unexpected. Explore any domain—nature, mythology, sports, cooking, art, everyday life, or the absurd. Use a fresh comedic structure and keep it under 20 words with a surprising punchline.',
          },
        ],
      },
    },
  ];
}

/**
 * Get initial reflexes (1 reflex: !ping from spec)
 */
function getInitialReflexes() {
  return [
    {
      id: 'ping-reflex',
      name: 'Chat !ping responder',
      tags: ['chat-command', 'ping', 'twitch'],
      match: {
        type: 'exact' as const,
        field: 'message.text',
        pattern: '!ping',
        caseSensitive: false,
      },
      active: true,
      priority: 50,
      conditions: {
        eventTypes: ['chat.message.v1'],
        minAuthLevel: 0,
      },
      description: "Responds with 'Pong!' when a Twitch chat message is exactly '!ping'.",
      candidateTemplate: 'Pong!',
    },
  ];
}

/**
 * Get initial personalities (1 personality: default bot from spec)
 */
function getInitialPersonalities(botName: string) {
  return [
    {
      id: botName.toLowerCase(),
      name: botName,
      instructions: `You are ${botName}, a helpful AI assistant.`,
      description: `Default personality for ${botName}`,
      status: 'active' as const,
      version: 1,
    },
  ];
}

/**
 * Get initial context packs (3 packs from spec)
 *
 * Note: Content is auto-generated from buildInternalEventSchemaPack(),
 * buildRouterJsonLogicPack(), etc. For seeding purposes, we provide
 * placeholder content that will be replaced by actual generators.
 */
function getInitialContextPacks() {
  return [
    {
      id: 'schema.internal-event-v2',
      version: 1,
      title: 'Internal Event V2 Schema',
      priority: 1,
      format: 'markdown' as const,
      source: 'platform-core',
      content: '# Internal Event V2 Schema\n\nAuto-generated schema documentation.',
    },
    {
      id: 'router.jsonlogic-guide',
      version: 1,
      title: 'Event Router JsonLogic Guide',
      priority: 1,
      format: 'markdown' as const,
      source: 'platform-core',
      content: '# Event Router JsonLogic Guide\n\nAuto-generated JsonLogic documentation.',
    },
    {
      id: 'scheduler.guide',
      version: 1,
      title: 'Scheduler Usage Guide',
      priority: 2,
      format: 'markdown' as const,
      source: 'platform-core',
      content: '# Scheduler Usage Guide\n\nCron syntax and event definition guide.',
    },
  ];
}

/**
 * Get initial API tokens (1 token: admin from spec)
 */
function getInitialApiTokens(providedToken?: string) {
  // Generate or use provided token
  const token = providedToken || crypto.randomUUID();

  // Generate SHA-256 hash
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  return [
    {
      uid: 'brat-admin',
      description: 'Initial admin token for chat',
      token,
      tokenHash,
    },
  ];
}
