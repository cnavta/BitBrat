import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Compute cache key for base image to determine if rebuild is needed.
 *
 * Cache key based on:
 * - package.json content hash
 * - package-lock.json content hash
 * - src/ directory git tree hash (fast, only tracks committed files)
 * - Dockerfile.base content hash
 *
 * @param repoRoot - Repository root directory
 * @returns SHA256 hash string
 */
export function computeBaseCacheKey(repoRoot: string): string {
  const hasher = crypto.createHash('sha256');

  // Hash package.json
  const packagePath = path.join(repoRoot, 'package.json');
  if (fs.existsSync(packagePath)) {
    hasher.update(fs.readFileSync(packagePath, 'utf-8'));
  }

  // Hash package-lock.json
  const lockPath = path.join(repoRoot, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    hasher.update(fs.readFileSync(lockPath, 'utf-8'));
  }

  // Hash Dockerfile.base
  const dockerfilePath = path.join(repoRoot, 'Dockerfile.base');
  if (fs.existsSync(dockerfilePath)) {
    hasher.update(fs.readFileSync(dockerfilePath, 'utf-8'));
  }

  // Use git ls-tree for src/ (fast, only tracks committed files)
  // Falls back to direct hashing if git not available
  try {
    const srcTreeHash = execSync('git ls-tree HEAD src/', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    hasher.update(srcTreeHash);
  } catch {
    // Fallback: hash src/ directory contents directly (slower but works)
    const srcPath = path.join(repoRoot, 'src');
    if (fs.existsSync(srcPath)) {
      hashDirectory(srcPath, hasher);
    }
  }

  return hasher.digest('hex');
}

/**
 * Recursively hash directory contents (fallback when git not available).
 */
function hashDirectory(dirPath: string, hasher: crypto.Hash): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      hashDirectory(fullPath, hasher);
    } else if (entry.isFile()) {
      hasher.update(fs.readFileSync(fullPath));
    }
  }
}

/**
 * Load stored cache key from .base-image-cache-key file.
 *
 * @param repoRoot - Repository root directory
 * @returns Stored cache key or null if not found
 */
export function loadCachedKey(repoRoot: string): string | null {
  const cachePath = path.join(repoRoot, '.base-image-cache-key');

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    return fs.readFileSync(cachePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

/**
 * Store cache key to .base-image-cache-key file.
 *
 * @param repoRoot - Repository root directory
 * @param cacheKey - Cache key to store
 */
export function storeCacheKey(repoRoot: string, cacheKey: string): void {
  const cachePath = path.join(repoRoot, '.base-image-cache-key');
  fs.writeFileSync(cachePath, cacheKey + '\n', 'utf-8');
}

/**
 * Check if base image needs rebuilding by comparing cache keys.
 *
 * @param repoRoot - Repository root directory
 * @param forceRebuild - Force rebuild regardless of cache key
 * @returns true if rebuild needed, false otherwise
 */
export function shouldRebuildBase(repoRoot: string, forceRebuild: boolean = false): boolean {
  if (forceRebuild) {
    return true;
  }

  const currentKey = computeBaseCacheKey(repoRoot);
  const cachedKey = loadCachedKey(repoRoot);

  return currentKey !== cachedKey;
}
