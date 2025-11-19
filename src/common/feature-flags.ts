/**
 * Centralized feature flags/gates with env-as-input philosophy.
 * - Supports namespaced canonical keys (e.g., 'twitch.enabled', 'memory.publish').
 * - Maps canonical keys to existing env var names for backward compatibility.
 * - Provides boolean parsing with lenient support for common truthy/falsey strings.
 * - Allows in-memory overrides for tests.
 */

export type EnvProvider = { [key: string]: string | undefined };

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

function parseBool(val: string | undefined, fallback = false): boolean {
  if (val == null) return fallback;
  const v = String(val).trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return fallback; // malformed → fallback
}

import manifest from './feature-flags.manifest.json';

type FlagManifest = {
  name: string;
  version: number;
  description?: string;
  updated?: string;
  flags: Array<{ key: string; description?: string; env?: string[]; default?: boolean }>;
};

const MF = manifest as unknown as FlagManifest;

/**
 * Canonical → env var synonyms mapping (priority order left→right).
 * Derived from the JSON manifest to keep a single source of truth.
 */
const CANONICAL_TO_ENVS: Record<string, string[]> = Object.fromEntries(
  (MF.flags || []).map((f) => [f.key, Array.isArray(f.env) ? f.env : []])
);

/**
 * Default values for canonical feature keys when env is absent or malformed.
 * Derived from the JSON manifest to make it the source of truth.
 */
const DEFAULTS: Record<string, boolean> = Object.fromEntries(
  (MF.flags || []).map((f) => [f.key, f.default === undefined ? false : Boolean(f.default)])
);

export class FeatureGate {
  private env: EnvProvider;
  private overrides: Map<string, string> = new Map();
  private cache: Map<string, boolean> = new Map();

  constructor(env: EnvProvider = process.env) {
    this.env = env;
  }

  /**
   * Returns the boolean state of a feature by canonical key.
   */
  enabled(key: string, fallback?: boolean): boolean {
    const raw = this.rawValue(key);

    // If we have a cached value and either the key is known in manifest or a raw value exists,
    // return the cached value. For completely unknown keys with no raw value, do not cache across different fallbacks.
    const hasManifestDefault = Object.prototype.hasOwnProperty.call(DEFAULTS, key);
    if ((hasManifestDefault || raw !== undefined) && this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const def = (hasManifestDefault ? DEFAULTS[key] : (fallback ?? false));
    const val = parseBool(raw, def);

    // Only cache when the key is known in manifest or there is a concrete raw value.
    if (hasManifestDefault || raw !== undefined) {
      this.cache.set(key, val);
    }
    return val;
  }

  /**
   * Returns the raw string value of a feature (first match among overrides, canonical env synonyms).
   */
  rawValue(key: string): string | undefined {
    const ov = this.overrides.get(key);
    if (ov !== undefined) return ov;
    const envNames = CANONICAL_TO_ENVS[key] || [];
    for (const name of envNames) {
      const v = this.env[name];
      if (v != null) return v;
    }
    return undefined;
  }

  /**
   * Sets an in-memory override (for tests or temporary runtime changes). Pass undefined to clear.
   */
  setOverride(key: string, value: string | undefined): void {
    this.cache.delete(key);
    if (value === undefined) {
      this.overrides.delete(key);
    } else {
      this.overrides.set(key, value);
    }
  }

  /** Clears caches and overrides (useful in tests). */
  reset(): void {
    this.overrides.clear();
    this.cache.clear();
  }

  /** Rebind the env provider (useful when tests replace process.env). Clears caches. */
  setEnvProvider(env: EnvProvider): void {
    this.env = env;
    this.cache.clear();
    this.overrides.clear();
  }

  /** List all known canonical keys. */
  keys(): string[] { return Object.keys(CANONICAL_TO_ENVS); }
}

// Singleton default gate for convenience
export const features = new FeatureGate();

// Convenience helpers
export function isFeatureEnabled(key: string, fallback?: boolean): boolean {
  return features.enabled(key, fallback);
}
