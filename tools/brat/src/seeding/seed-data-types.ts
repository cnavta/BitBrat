/**
 * Sprint 352: Persistence-Agnostic Seed Data Types
 *
 * Story S6.1: Define types for seed data that work with both PostgreSQL and Firestore.
 * These types represent the canonical seed data structure independent of persistence layer.
 */

/**
 * Routing rule seed data
 */
export interface SeedRoutingRule {
  id: string;
  enabled: boolean;
  priority: number;
  description: string;
  logic: string; // JsonLogic expression as JSON string
  routing: {
    slip: Array<{
      v: string;
      id: string;
      nextTopic: string;
      attributes: Record<string, any>;
      maxAttempts: number;
    }>;
    stage: string;
  };
  enrichments?: {
    annotations: Array<{
      id: string;
      kind: string;
      value: string;
    }>;
  };
}

/**
 * Reflex seed data
 */
export interface SeedReflex {
  id: string;
  name: string;
  tags: string[];
  match: {
    type: 'exact' | 'regex' | 'contains';
    field: string;
    pattern: string;
    caseSensitive: boolean;
  };
  active: boolean;
  priority: number;
  conditions: {
    eventTypes: string[];
    minAuthLevel: number;
  };
  description: string;
  candidateTemplate: string;
}

/**
 * Personality seed data
 */
export interface SeedPersonality {
  id: string;
  name: string;
  text: string; // Full personality/identity prompt text
  status: 'active' | 'inactive' | 'archived';
  version: number;
  tags?: string[]; // Array of tags for categorization
  platform?: string; // Optional platform override (openai, ollama, vllm)
  model?: string; // Optional model override (gpt-4o, llama3, etc.)
}

/**
 * Context pack seed data
 */
export interface SeedContextPack {
  id: string;
  version: number;
  title: string;
  priority: number;
  format: 'markdown' | 'json' | 'yaml';
  source: string;
  content: string;
}

/**
 * API token seed data
 */
export interface SeedApiToken {
  userId: string; // User ID who owns this token
  description: string;
  token: string; // Plain text token (will be hashed for storage)
  tokenHash: string; // SHA-256 hash
}

/**
 * Complete seed data set
 */
export interface SeedDataSet {
  routingRules: SeedRoutingRule[];
  reflexes: SeedReflex[];
  personalities: SeedPersonality[];
  contextPacks: SeedContextPack[];
  apiTokens: SeedApiToken[];
}

/**
 * Seeding options
 */
export interface SeedingOptions {
  /** Context name (for substitutions like {botName}) */
  contextName?: string;
  /** Bot name (default: 'BitBrat') */
  botName?: string;
  /** Dry run (don't write to database) */
  dryRun?: boolean;
  /** Wipe existing data before seeding */
  wipe?: boolean;
  /** Override API token (if not provided, generates random) */
  apiToken?: string;
}
