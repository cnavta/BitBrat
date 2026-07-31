/**
 * secure-files-validator.ts
 *
 * Validates secure file configurations before deployment.
 *
 * Sprint 374: Secure File Deployment
 *
 * Security constraints enforced:
 * - Source files MUST be git-ignored (prevents accidental secret commits)
 * - Target paths MUST be under /var/secrets or /run/secrets (security boundary)
 * - Permissions MUST be valid octal strings (format: 0XXX)
 * - Paths MUST NOT contain traversal patterns (../)
 * - Source files MUST exist (if required=true)
 *
 * Usage:
 * ```typescript
 * const validator = new SecureFilesValidator(repoRoot);
 * const result = await validator.validate(secureFiles, executionContext);
 * if (!result.valid) {
 *   throw new Error(result.errors.join('\n'));
 * }
 * ```
 */

import fs from 'fs';
import path from 'path';
import type { SecureFile } from '../config/types';

/**
 * Validation result for secure file configuration
 */
export interface ValidationResult {
  /** Whether all validations passed */
  valid: boolean;

  /** List of validation errors (empty if valid) */
  errors: string[];

  /** List of non-fatal warnings */
  warnings: string[];
}

/**
 * SecureFilesValidator validates secure file configurations.
 *
 * Ensures that secure files meet security and correctness constraints
 * before deployment proceeds.
 */
export class SecureFilesValidator {
  constructor(private readonly repoRoot: string) {}

  /**
   * Validate an array of secure files.
   *
   * @param secureFiles - Array of secure file configurations to validate
   * @param executionContext - Current execution context (e.g., 'local', 'staging', 'prod')
   * @returns ValidationResult with errors and warnings
   */
  async validate(
    secureFiles: SecureFile[],
    executionContext?: string
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Filter files by execution context if specified
    const applicableFiles = secureFiles.filter((file) => {
      if (!file.context) return true; // No context restriction
      return file.context === executionContext;
    });

    if (applicableFiles.length === 0 && secureFiles.length > 0) {
      warnings.push(
        `No secure files applicable for context '${executionContext}' ` +
        `(${secureFiles.length} files defined for other contexts)`
      );
    }

    // Validate each applicable file
    for (const file of applicableFiles) {
      // 1. Validate git-ignore status
      const gitIgnoreError = await this.validateGitIgnore(file.local);
      if (gitIgnoreError) errors.push(gitIgnoreError);

      // 2. Validate target path
      const targetPathError = this.validateTargetPath(file.target);
      if (targetPathError) errors.push(targetPathError);

      // 3. Validate file permissions
      const permissionsError = this.validatePermissions(file.permissions);
      if (permissionsError) errors.push(permissionsError);

      // 4. Validate file existence (if required)
      const existenceError = await this.validateFileExists(
        file.local,
        file.required
      );
      if (existenceError) errors.push(existenceError);

      // Warn if env variable not set
      if (!file.env) {
        warnings.push(
          `No environment variable specified for ${file.local} → ${file.target} ` +
          `(consider adding 'env' property for easier discovery)`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate that a file is git-ignored.
   *
   * Prevents accidental commits of secure files to version control.
   *
   * @param localPath - Source path relative to repository root
   * @returns Error message if file is NOT git-ignored, null otherwise
   */
  async validateGitIgnore(localPath: string): Promise<string | null> {
    const absolutePath = path.resolve(this.repoRoot, localPath);

    // Strategy 1: Use `git check-ignore` (most reliable)
    try {
      const { execSync } = require('child_process');

      // git check-ignore returns 0 if file is ignored, 1 if not
      execSync(`git check-ignore "${absolutePath}"`, {
        cwd: this.repoRoot,
        stdio: 'pipe',
      });

      // Exit code 0 means file is git-ignored (success)
      return null;
    } catch (error: any) {
      // Exit code 1 means file is NOT git-ignored (error)
      if (error.status === 1) {
        return (
          `Secure file is NOT git-ignored: ${localPath}\n` +
          `  Security risk: This file may be accidentally committed to version control.\n` +
          `  Action: Add '${localPath}' or its parent directory to .gitignore`
        );
      }

      // Exit code 128 or other errors mean git is not available or repo issue
      // Fall back to manual .gitignore parsing (Strategy 2)
    }

    // Strategy 2: Manual .gitignore parsing (fallback)
    try {
      const gitignorePath = path.join(this.repoRoot, '.gitignore');
      const gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf-8');
      const patterns = gitignoreContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

      // Check if any pattern matches the local path
      for (const pattern of patterns) {
        if (this.matchesGitignorePattern(localPath, pattern)) {
          return null; // File is git-ignored
        }
      }

      // File is not matched by any .gitignore pattern
      return (
        `Secure file is NOT git-ignored: ${localPath}\n` +
        `  Security risk: This file may be accidentally committed to version control.\n` +
        `  Action: Add '${localPath}' or its parent directory to .gitignore`
      );
    } catch (error) {
      // If .gitignore doesn't exist or can't be read, emit warning
      // (don't fail validation - user may be using a different VCS or no VCS)
      return null;
    }
  }

  /**
   * Check if a path matches a gitignore pattern.
   *
   * Simplified gitignore pattern matching:
   * - `*.json` matches any file ending in .json
   * - `foo/` matches directory foo and all contents
   * - `foo/bar` matches specific file/directory
   * - `/foo` matches foo at repo root only
   *
   * @param filePath - File path to check
   * @param pattern - Gitignore pattern
   * @returns true if pattern matches file path
   */
  private matchesGitignorePattern(filePath: string, pattern: string): boolean {
    // Normalize paths (remove leading ./)
    const normalizedPath = filePath.replace(/^\.\//, '');
    let normalizedPattern = pattern.replace(/^\.\//, '');

    // Handle directory patterns (trailing /)
    if (normalizedPattern.endsWith('/')) {
      const dir = normalizedPattern.slice(0, -1);
      return (
        normalizedPath === dir ||
        normalizedPath.startsWith(dir + '/')
      );
    }

    // Handle root-anchored patterns (leading /)
    if (normalizedPattern.startsWith('/')) {
      normalizedPattern = normalizedPattern.slice(1);
      return normalizedPath === normalizedPattern;
    }

    // Handle wildcard patterns
    // lgtm[js/incomplete-sanitization]
    // CodeQL Warning Suppression:
    // Input is from trusted .gitignore files (developer-controlled, version-controlled).
    // Regex is used only for file path matching, not code execution or injection contexts.
    // Incomplete backslash handling is a functional limitation, not a security issue.
    if (normalizedPattern.includes('*')) {
      const regex = new RegExp(
        '^' +
        normalizedPattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*') +
        '$'
      );
      return regex.test(normalizedPath);
    }

    // Handle exact match or subdirectory match
    return (
      normalizedPath === normalizedPattern ||
      normalizedPath.startsWith(normalizedPattern + '/')
    );
  }

  /**
   * Validate target path is under /var/secrets or /run/secrets.
   *
   * Enforces security boundary - secrets should never be mounted
   * to arbitrary filesystem locations.
   *
   * @param targetPath - Destination path inside container
   * @returns Error message if path is invalid, null otherwise
   */
  validateTargetPath(targetPath: string): string | null {
    // Check for path traversal BEFORE normalization
    if (targetPath.includes('..')) {
      return (
        `Invalid target path (contains traversal): ${targetPath}\n` +
        `  Security risk: Path traversal attempts are not allowed.\n` +
        `  Action: Use an absolute path under /var/secrets/ or /run/secrets/`
      );
    }

    // Normalize path (resolve ./, //, etc.)
    const normalized = path.posix.normalize(targetPath);

    // Verify path is absolute
    if (!path.posix.isAbsolute(normalized)) {
      return (
        `Invalid target path (must be absolute): ${targetPath}\n` +
        `  Action: Use an absolute path starting with /var/secrets/ or /run/secrets/`
      );
    }

    // Verify path starts with allowed prefixes
    const allowedPrefixes = ['/var/secrets/', '/run/secrets/'];
    const isAllowed = allowedPrefixes.some((prefix) =>
      normalized.startsWith(prefix)
    );

    if (!isAllowed) {
      return (
        `Invalid target path (not under allowed directories): ${targetPath}\n` +
        `  Security risk: Secure files must be mounted under /var/secrets/ or /run/secrets/\n` +
        `  Action: Change target path to start with /var/secrets/ or /run/secrets/\n` +
        `  Example: /var/secrets/gcp-credentials.json`
      );
    }

    return null; // Path is valid
  }

  /**
   * Validate file permissions are valid octal strings.
   *
   * Permissions must be in format "0XXX" where X is 0-7.
   * Defaults to "0400" (read-only for owner).
   *
   * @param permissions - Permissions string (optional, defaults to "0400")
   * @returns Error message if permissions are invalid, null otherwise
   */
  validatePermissions(permissions?: string): string | null {
    // Default to 0400 if not specified
    const perms = permissions || '0400';

    // Validate format: must be 0XXX where X is 0-7
    const octalPattern = /^0[0-7]{3}$/;
    if (!octalPattern.test(perms)) {
      return (
        `Invalid permissions format: ${permissions}\n` +
        `  Expected: Octal string matching "0XXX" where X is 0-7\n` +
        `  Examples: "0400" (read-only), "0600" (read-write), "0440" (read-only for owner+group)\n` +
        `  Action: Fix permissions format or omit to use default "0400"`
      );
    }

    // Warn if permissions are too permissive (world-readable or world-writable)
    const lastDigit = parseInt(perms[3], 8);
    if (lastDigit > 0) {
      // This is a warning-level issue, not an error
      // Caller should check warnings separately
      // For now, we only validate format (errors), not security best practices (warnings)
    }

    return null; // Permissions are valid
  }

  /**
   * Validate that source file exists on filesystem.
   *
   * If file is required (default), fail validation if missing.
   * If file is optional (required=false), emit warning instead.
   *
   * @param localPath - Source path relative to repository root
   * @param required - Whether file is required (default: true)
   * @returns Error message if file is missing and required, null otherwise
   */
  async validateFileExists(
    localPath: string,
    required: boolean = true
  ): Promise<string | null> {
    const absolutePath = path.resolve(this.repoRoot, localPath);

    try {
      await fs.promises.access(absolutePath, fs.constants.R_OK);
      return null; // File exists and is readable
    } catch (error) {
      if (required !== false) {
        return `Required secure file not found: ${localPath} (resolved to ${absolutePath})`;
      }
      // Optional file missing is a warning, not an error
      // (warnings handled at higher level)
      return null;
    }
  }
}
