import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Structure of the .bitbrat.json configuration file.
 */
export interface BitBratConfig {
  apiToken: string;
  codeFirstRun?: boolean;
}

/**
 * Read .bitbrat.json from the project root.
 *
 * @param projectRoot - Path to project root directory
 * @returns Parsed configuration object or null if file doesn't exist
 */
export async function readBitBratConfig(projectRoot: string): Promise<BitBratConfig | null> {
  const configPath = path.join(projectRoot, '.bitbrat.json');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content) as BitBratConfig;
  } catch (err) {
    // File doesn't exist or is invalid
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Write .bitbrat.json to the project root.
 *
 * @param projectRoot - Path to project root directory
 * @param config - Configuration object to write
 */
export async function writeBitBratConfig(
  projectRoot: string,
  config: BitBratConfig
): Promise<void> {
  const configPath = path.join(projectRoot, '.bitbrat.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Update specific fields in .bitbrat.json.
 *
 * Reads existing config, merges changes, and writes back.
 *
 * @param projectRoot - Path to project root directory
 * @param updates - Partial config object with fields to update
 */
export async function updateBitBratConfig(
  projectRoot: string,
  updates: Partial<BitBratConfig>
): Promise<void> {
  const existing = (await readBitBratConfig(projectRoot)) || { apiToken: '' };
  const merged = { ...existing, ...updates };
  await writeBitBratConfig(projectRoot, merged);
}

/**
 * Check if this is the first run of `brat code`.
 *
 * Returns true if:
 * - .bitbrat.json doesn't exist
 * - codeFirstRun is true
 * - codeFirstRun is missing (backwards compatibility)
 *
 * @param projectRoot - Path to project root directory
 * @returns True if this is the first run
 */
export async function isCodeFirstRun(projectRoot: string): Promise<boolean> {
  const config = await readBitBratConfig(projectRoot);

  // No config file = first run
  if (!config) {
    return true;
  }

  // Explicitly set to true = first run
  if (config.codeFirstRun === true) {
    return true;
  }

  // Missing flag (old setup) = treat as first run
  if (config.codeFirstRun === undefined) {
    return true;
  }

  // Explicitly set to false = not first run
  return false;
}

/**
 * Mark that `brat code` has been run.
 *
 * Sets codeFirstRun to false in .bitbrat.json.
 *
 * @param projectRoot - Path to project root directory
 */
export async function markCodeRunComplete(projectRoot: string): Promise<void> {
  await updateBitBratConfig(projectRoot, { codeFirstRun: false });
}
