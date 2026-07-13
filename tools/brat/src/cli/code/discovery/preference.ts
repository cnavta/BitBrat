import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

/**
 * User preferences for coding agents.
 *
 * Stored in ~/.bratrc (YAML format).
 */
export interface CodingAgentPreference {
  /** Preferred agent ID (e.g., 'claude-code', 'aider') */
  preferred?: string;

  /** Per-plugin configuration overrides */
  plugins?: Record<string, Record<string, any>>;
}

/**
 * Full user preferences structure (codingAgent is a subset).
 */
interface UserPreferences {
  codingAgent?: CodingAgentPreference;
  [key: string]: any;
}

/**
 * Get the path to the user preferences file (~/.bratrc).
 *
 * @returns Absolute path to ~/.bratrc
 */
export function getPreferencePath(): string {
  return path.join(os.homedir(), '.bratrc');
}

/**
 * Load coding agent preference from ~/.bratrc.
 *
 * Returns null if file doesn't exist or codingAgent section is not present.
 * Non-fatal failures (file read errors, parse errors) return null and log warning.
 *
 * @returns Coding agent preference or null
 */
export async function loadPreference(): Promise<CodingAgentPreference | null> {
  const prefPath = getPreferencePath();

  try {
    // Check if file exists
    await fs.access(prefPath, fs.constants.R_OK);

    // Read file
    const content = await fs.readFile(prefPath, 'utf-8');

    // Parse YAML
    const prefs = yaml.load(content) as UserPreferences;

    return prefs.codingAgent || null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - not an error
      return null;
    }

    // Other errors (permission, parse error) - log and return null
    console.warn(`Failed to load preferences from ${prefPath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Save coding agent preference to ~/.bratrc.
 *
 * Merges with existing preferences (doesn't overwrite the entire file).
 * Creates the file if it doesn't exist.
 *
 * @param preference - Coding agent preference to save
 * @throws Error if save fails
 */
export async function savePreference(preference: CodingAgentPreference): Promise<void> {
  const prefPath = getPreferencePath();

  try {
    // Load existing preferences (if any)
    let existing: UserPreferences = {};

    try {
      const content = await fs.readFile(prefPath, 'utf-8');
      existing = (yaml.load(content) as UserPreferences) || {};
    } catch (err) {
      // File doesn't exist or parse error - start fresh
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Failed to read existing preferences, will overwrite: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Merge coding agent preferences
    existing.codingAgent = preference;

    // Write back to file
    const content = yaml.dump(existing, {
      indent: 2,
      lineWidth: 120,
    });

    await fs.writeFile(prefPath, content, { mode: 0o600 }); // User-only read/write

  } catch (err) {
    throw new Error(`Failed to save preferences to ${prefPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Clear coding agent preference from ~/.bratrc.
 *
 * Removes the codingAgent section but preserves other preferences.
 * If the file becomes empty, it is deleted.
 *
 * @returns True if preference was cleared, false if it didn't exist
 */
export async function clearPreference(): Promise<boolean> {
  const prefPath = getPreferencePath();

  try {
    // Load existing preferences
    const content = await fs.readFile(prefPath, 'utf-8');
    const existing = (yaml.load(content) as UserPreferences) || {};

    if (!existing.codingAgent) {
      return false; // Nothing to clear
    }

    // Remove codingAgent section
    delete existing.codingAgent;

    // If file is now empty, delete it
    if (Object.keys(existing).length === 0) {
      await fs.unlink(prefPath);
      return true;
    }

    // Otherwise, write back without codingAgent
    const newContent = yaml.dump(existing, {
      indent: 2,
      lineWidth: 120,
    });

    await fs.writeFile(prefPath, newContent, { mode: 0o600 });
    return true;

  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false; // File doesn't exist
    }

    console.warn(`Failed to clear preference: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Get the preferred agent ID from user preferences.
 *
 * Convenience method to quickly check if user has a saved preference.
 *
 * @returns Agent ID or null if no preference set
 */
export async function getPreferredAgentId(): Promise<string | null> {
  const pref = await loadPreference();
  return pref?.preferred || null;
}

/**
 * Set the preferred agent ID in user preferences.
 *
 * Convenience method to save just the agent preference without plugin config.
 *
 * @param agentId - Agent ID to save as preferred
 */
export async function setPreferredAgentId(agentId: string): Promise<void> {
  const existing = (await loadPreference()) || {};
  existing.preferred = agentId;
  await savePreference(existing);
}
