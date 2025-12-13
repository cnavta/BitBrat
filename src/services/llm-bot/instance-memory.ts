// Instance-scoped short-term memory store for llm-bot
// Bounded by per-key limits and global key count; supports TTL eviction.
import type { BaseServer } from '../../common/base-server';

export type ChatMessage = { role: 'system'|'user'|'assistant'; content: string; createdAt: string };

type MemoryEntry = {
  turns: ChatMessage[];
  updatedAt: number; // ms epoch
};

export type MemoryLimits = {
  maxKeys: number;           // e.g., 1000
  maxMessagesPerKey: number; // e.g., 32
  maxCharsPerKey: number;    // e.g., 16000
  ttlMs: number;             // e.g., 30 * 60 * 1000
};

export class InstanceMemoryStore {
  private map = new Map<string, MemoryEntry>();
  private locks = new Map<string, Promise<void>>();
  constructor(private limits: MemoryLimits) {}

  private approxChars(msgs: ChatMessage[]) { return msgs.reduce((n, m) => n + (m.content?.length || 0), 0); }

  private trimTurns(turns: ChatMessage[]): ChatMessage[] {
    let out = turns.slice();
    // Trim by chars (drop oldest first)
    while (this.approxChars(out) > this.limits.maxCharsPerKey && out.length > 0) out.shift();
    // Trim by count (keep last N)
    if (out.length > this.limits.maxMessagesPerKey) out = out.slice(-this.limits.maxMessagesPerKey);
    return out;
  }

  private evictExpiredAndExcess() {
    const now = Date.now();
    // TTL eviction
    if (this.limits.ttlMs >= 0) {
      for (const [k, v] of this.map) {
        if (now - v.updatedAt > this.limits.ttlMs) this.map.delete(k);
      }
    }
    // LRU eviction if too many keys
    if (this.map.size > this.limits.maxKeys) {
      const entries = Array.from(this.map.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const toDrop = this.map.size - this.limits.maxKeys;
      for (let i = 0; i < toDrop; i++) this.map.delete(entries[i][0]);
    }
  }

  private withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) || Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((res) => (release = res));
    this.locks.set(key, prev.then(() => next));
    return prev.then(fn).finally(() => { (release as any)(); this.locks.delete(key); });
  }

  async read(key: string): Promise<ChatMessage[]> {
    this.evictExpiredAndExcess();
    const e = this.map.get(key);
    if (!e) return [];
    if (this.limits.ttlMs >= 0 && Date.now() - e.updatedAt > this.limits.ttlMs) { this.map.delete(key); return []; }
    return e.turns.slice();
  }

  async append(key: string, newTurns: ChatMessage[]): Promise<void> {
    return this.withKeyLock(key, async () => {
      const prior = this.map.get(key)?.turns || [];
      const merged = this.trimTurns([...prior, ...newTurns]);
      this.map.set(key, { turns: merged, updatedAt: Date.now() });
      this.evictExpiredAndExcess();
    });
  }

  async reset(key: string): Promise<void> { this.map.delete(key); }

  /** For testing/metrics */
  size(): number { return this.map.size; }
}

// Singleton for the process lifetime
let __store: InstanceMemoryStore | null = null;
export function getInstanceMemoryStore(server?: BaseServer): InstanceMemoryStore {
  if (!__store) {
    const readNum = (key: string, def: number) =>
      server
        ? server.getConfig<number>(key, { default: def, parser: (v) => Number(String(v)) })
        : Number(process.env[key] || String(def));
    const maxKeys = readNum('LLM_BOT_INSTANCE_MEM_MAX_KEYS', 1000);
    const maxMessagesPerKey = readNum('LLM_BOT_INSTANCE_MEM_MAX_MSGS', 32);
    const maxCharsPerKey = readNum('LLM_BOT_INSTANCE_MEM_MAX_CHARS', 16000);
    const ttlMs = readNum('LLM_BOT_INSTANCE_MEM_TTL_MS', 30 * 60 * 1000);
    __store = new InstanceMemoryStore({ maxKeys, maxMessagesPerKey, maxCharsPerKey, ttlMs });
  }
  return __store;
}

// Test-only utility to reset the singleton between tests
export function __resetInstanceMemoryStoreForTests() { __store = null; }
