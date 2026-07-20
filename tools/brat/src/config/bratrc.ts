/**
 * Sprint 349: ~/.bratrc Configuration Management
 *
 * Utilities for loading and saving ~/.bratrc (YAML format).
 * Stores current context, preferences, and history.
 *
 * File format:
 * ```yaml
 * current_context: staging
 * preferences:
 *   auto_confirm_deploys: false
 * history:
 *   last_contexts: [staging, local, prod]
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

/**
 * ~/.bratrc configuration structure
 */
export interface BratrcConfig {
  current_context?: string;
  preferences?: {
    auto_confirm_deploys?: boolean;
    default_log_level?: string;
    [key: string]: any;
  };
  history?: {
    last_contexts?: string[];
    [key: string]: any;
  };
}

/**
 * Default ~/.bratrc path
 */
export function getBratrcPath(): string {
  return path.join(os.homedir(), '.bratrc');
}

/**
 * Load ~/.bratrc configuration
 * Returns null if file doesn't exist or is invalid
 */
export function loadBratrc(): BratrcConfig | null {
  const bratrcPath = getBratrcPath();

  if (!fs.existsSync(bratrcPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(bratrcPath, 'utf8');
    const config = yaml.load(content) as BratrcConfig;
    return config || {};
  } catch (error) {
    // Return null on parse error (allows fallback to defaults)
    return null;
  }
}

/**
 * Save ~/.bratrc configuration atomically
 * Creates file if it doesn't exist
 */
export function saveBratrc(config: BratrcConfig): void {
  const bratrcPath = getBratrcPath();
  const tempPath = `${bratrcPath}.tmp`;

  try {
    // Write to temp file first
    const content = yaml.dump(config, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
    });
    fs.writeFileSync(tempPath, content, 'utf8');

    // Atomic rename (replaces existing file)
    fs.renameSync(tempPath, bratrcPath);
  } catch (error) {
    // Clean up temp file on error
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw new Error(`Failed to save ~/.bratrc: ${(error as Error).message}`);
  }
}

/**
 * Get current context from ~/.bratrc
 * Returns null if not set or file doesn't exist
 */
export function getCurrentContext(): string | null {
  const config = loadBratrc();
  return config?.current_context || null;
}

/**
 * Set current context in ~/.bratrc
 * Creates ~/.bratrc if it doesn't exist
 */
export function setCurrentContext(contextName: string): void {
  const config = loadBratrc() || {};
  config.current_context = contextName;

  // Update history (last 10 contexts)
  if (!config.history) {
    config.history = {};
  }
  if (!config.history.last_contexts) {
    config.history.last_contexts = [];
  }

  // Remove context from history if it exists
  config.history.last_contexts = config.history.last_contexts.filter(
    (ctx) => ctx !== contextName
  );

  // Add to front of history
  config.history.last_contexts.unshift(contextName);

  // Keep only last 10
  config.history.last_contexts = config.history.last_contexts.slice(0, 10);

  saveBratrc(config);
}

/**
 * Get last N contexts from history
 */
export function getContextHistory(limit: number = 10): string[] {
  const config = loadBratrc();
  return config?.history?.last_contexts?.slice(0, limit) || [];
}

/**
 * Get preference value from ~/.bratrc
 */
export function getPreference<T = any>(key: string, defaultValue?: T): T | undefined {
  const config = loadBratrc();
  const value = config?.preferences?.[key];
  return value !== undefined ? value : defaultValue;
}

/**
 * Set preference value in ~/.bratrc
 */
export function setPreference(key: string, value: any): void {
  const config = loadBratrc() || {};
  if (!config.preferences) {
    config.preferences = {};
  }
  config.preferences[key] = value;
  saveBratrc(config);
}

/**
 * Check if ~/.bratrc exists
 */
export function bratrcExists(): boolean {
  return fs.existsSync(getBratrcPath());
}

/**
 * Initialize ~/.bratrc with default values if it doesn't exist
 */
export function initBratrc(contextName: string = 'local'): void {
  if (bratrcExists()) {
    return; // Don't overwrite existing config
  }

  const defaultConfig: BratrcConfig = {
    current_context: contextName,
    preferences: {
      auto_confirm_deploys: false,
    },
    history: {
      last_contexts: [contextName],
    },
  };

  saveBratrc(defaultConfig);
}
