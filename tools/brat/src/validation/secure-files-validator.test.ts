/**
 * secure-files-validator.test.ts
 *
 * Unit tests for SecureFilesValidator
 *
 * Sprint 374: Secure File Deployment
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SecureFilesValidator } from './secure-files-validator';
import type { SecureFile } from '../config/types';

describe('SecureFilesValidator', () => {
  let tmpDir: string;
  let validator: SecureFilesValidator;

  beforeEach(async () => {
    // Create temporary directory for tests
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'secure-files-test-'));
    validator = new SecureFilesValidator(tmpDir);

    // Create .gitignore file
    const gitignoreContent = `
# Secure files
.secure.local/
.secure.staging/
*.secret.json
/credentials.json
`;
    await fs.promises.writeFile(path.join(tmpDir, '.gitignore'), gitignoreContent);
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe('validate()', () => {
    it('should validate array of secure files', async () => {
      // Create test files
      const secureDir = path.join(tmpDir, '.secure.local');
      await fs.promises.mkdir(secureDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(secureDir, 'test.json'),
        '{"test": true}'
      );

      const secureFiles: SecureFile[] = [
        {
          local: '.secure.local/test.json',
          target: '/var/secrets/test.json',
          permissions: '0400',
          required: true,
        },
      ];

      const result = await validator.validate(secureFiles);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should filter files by execution context', async () => {
      // Create the local file so it validates successfully
      const secureDir = path.join(tmpDir, '.secure.local');
      await fs.promises.mkdir(secureDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(secureDir, 'local.json'),
        '{"local": true}'
      );

      const secureFiles: SecureFile[] = [
        {
          local: '.secure.local/local.json',
          target: '/var/secrets/local.json',
          context: 'local',
        },
        {
          local: '.secure.staging/staging.json',
          target: '/var/secrets/staging.json',
          context: 'staging',
        },
      ];

      const result = await validator.validate(secureFiles, 'local');

      // Should only validate the 'local' context file
      // The staging file should be ignored (no error for missing file)
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accumulate multiple errors', async () => {
      const secureFiles: SecureFile[] = [
        {
          local: 'not-ignored.json', // Not git-ignored
          target: '/tmp/bad-path.json', // Wrong target prefix
          permissions: '9999', // Invalid permissions
          required: true,
        },
      ];

      const result = await validator.validate(secureFiles);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('NOT git-ignored'))).toBe(true);
      expect(result.errors.some(e => e.includes('not under allowed directories'))).toBe(true);
      expect(result.errors.some(e => e.includes('Invalid permissions'))).toBe(true);
    });
  });

  describe('validateGitIgnore()', () => {
    it('should pass for file in ignored directory', async () => {
      const error = await validator.validateGitIgnore('.secure.local/credentials.json');
      expect(error).toBeNull();
    });

    it('should pass for file matching wildcard pattern', async () => {
      const error = await validator.validateGitIgnore('my-app.secret.json');
      expect(error).toBeNull();
    });

    it('should pass for file matching root-anchored pattern', async () => {
      const error = await validator.validateGitIgnore('credentials.json');
      expect(error).toBeNull();
    });

    it('should fail for file not in .gitignore', async () => {
      const error = await validator.validateGitIgnore('not-ignored.json');
      expect(error).not.toBeNull();
      expect(error).toContain('NOT git-ignored');
      expect(error).toContain('not-ignored.json');
    });

    it('should handle missing .gitignore gracefully', async () => {
      // Remove .gitignore
      await fs.promises.unlink(path.join(tmpDir, '.gitignore'));

      const error = await validator.validateGitIgnore('any-file.json');
      // Should not error when .gitignore is missing
      expect(error).toBeNull();
    });
  });

  describe('validateTargetPath()', () => {
    it('should pass for /var/secrets/ paths', () => {
      const error = validator.validateTargetPath('/var/secrets/credentials.json');
      expect(error).toBeNull();
    });

    it('should pass for /run/secrets/ paths', () => {
      const error = validator.validateTargetPath('/run/secrets/api-key.txt');
      expect(error).toBeNull();
    });

    it('should fail for paths outside allowed directories', () => {
      const error = validator.validateTargetPath('/tmp/credentials.json');
      expect(error).not.toBeNull();
      expect(error).toContain('not under allowed directories');
      expect(error).toContain('/var/secrets/');
    });

    it('should fail for relative paths', () => {
      const error = validator.validateTargetPath('relative/path.json');
      expect(error).not.toBeNull();
      expect(error).toContain('must be absolute');
    });

    it('should fail for paths with traversal', () => {
      const error = validator.validateTargetPath('/var/secrets/../etc/passwd');
      expect(error).not.toBeNull();
      expect(error).toContain('contains traversal');
    });

    it('should normalize paths before validation', () => {
      const error = validator.validateTargetPath('/var/secrets//./credentials.json');
      expect(error).toBeNull(); // Should normalize to /var/secrets/credentials.json
    });
  });

  describe('validatePermissions()', () => {
    it('should pass for valid octal permissions', () => {
      expect(validator.validatePermissions('0400')).toBeNull();
      expect(validator.validatePermissions('0600')).toBeNull();
      expect(validator.validatePermissions('0440')).toBeNull();
      expect(validator.validatePermissions('0000')).toBeNull();
      expect(validator.validatePermissions('0777')).toBeNull();
    });

    it('should pass for undefined permissions (uses default)', () => {
      const error = validator.validatePermissions(undefined);
      expect(error).toBeNull();
    });

    it('should fail for invalid format', () => {
      const error = validator.validatePermissions('777');
      expect(error).not.toBeNull();
      expect(error).toContain('Invalid permissions format');
      expect(error).toContain('0XXX');
    });

    it('should fail for non-octal digits', () => {
      const error = validator.validatePermissions('0888');
      expect(error).not.toBeNull();
      expect(error).toContain('Invalid permissions format');
    });

    it('should fail for non-numeric strings', () => {
      const error = validator.validatePermissions('read-only');
      expect(error).not.toBeNull();
      expect(error).toContain('Invalid permissions format');
    });
  });

  describe('validateFileExists()', () => {
    it('should pass for existing files', async () => {
      // Create test file
      const testFile = path.join(tmpDir, 'existing.json');
      await fs.promises.writeFile(testFile, '{}');

      const error = await validator.validateFileExists('existing.json', true);
      expect(error).toBeNull();
    });

    it('should fail for missing required files', async () => {
      const error = await validator.validateFileExists('missing.json', true);
      expect(error).not.toBeNull();
      expect(error).toContain('Required secure file not found');
      expect(error).toContain('missing.json');
    });

    it('should pass for missing optional files', async () => {
      const error = await validator.validateFileExists('missing.json', false);
      expect(error).toBeNull(); // Optional files don't error
    });

    it('should handle required=undefined as true', async () => {
      const error = await validator.validateFileExists('missing.json', undefined);
      expect(error).not.toBeNull();
      expect(error).toContain('Required secure file not found');
    });
  });

  describe('matchesGitignorePattern() (via validateGitIgnore)', () => {
    it('should match directory patterns (trailing /)', async () => {
      // .secure.local/ matches .secure.local/anything
      const error = await validator.validateGitIgnore('.secure.local/deep/path/file.json');
      expect(error).toBeNull();
    });

    it('should match wildcard patterns', async () => {
      // *.secret.json matches any-name.secret.json
      const error = await validator.validateGitIgnore('foo.secret.json');
      expect(error).toBeNull();
    });

    it('should match root-anchored patterns', async () => {
      // /credentials.json matches credentials.json at root only
      const error1 = await validator.validateGitIgnore('credentials.json');
      expect(error1).toBeNull();

      const error2 = await validator.validateGitIgnore('subdir/credentials.json');
      expect(error2).not.toBeNull(); // Should NOT match in subdirectory
    });

    it('should match exact file patterns', async () => {
      // Add exact pattern to .gitignore
      await fs.promises.appendFile(
        path.join(tmpDir, '.gitignore'),
        '\nspecific-file.json\n'
      );

      const error1 = await validator.validateGitIgnore('specific-file.json');
      expect(error1).toBeNull();

      // Our implementation matches "specific-file.json" in subdirs too (pattern starts dir match)
      const error2 = await validator.validateGitIgnore('subdir/specific-file.json');
      // This will NOT match because "subdir/specific-file.json" does not start with "specific-file.json"
      // To match in subdirs, use "*/specific-file.json" or "**/specific-file.json"
      expect(error2).not.toBeNull();
    });
  });

  describe('Integration tests', () => {
    it('should validate complete realistic secure file configuration', async () => {
      // Create test files
      const secureDir = path.join(tmpDir, '.secure.local');
      await fs.promises.mkdir(secureDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(secureDir, 'gcp-credentials.json'),
        JSON.stringify({ type: 'service_account' })
      );
      await fs.promises.writeFile(
        path.join(secureDir, 'api-key.txt'),
        'secret-api-key'
      );

      const secureFiles: SecureFile[] = [
        {
          local: '.secure.local/gcp-credentials.json',
          target: '/var/secrets/gcp-credentials.json',
          env: 'GOOGLE_APPLICATION_CREDENTIALS',
          permissions: '0400',
          required: true,
          context: 'local',
        },
        {
          local: '.secure.local/api-key.txt',
          target: '/run/secrets/api-key.txt',
          env: 'API_KEY_FILE',
          permissions: '0600',
          required: false,
          context: 'local',
        },
      ];

      const result = await validator.validate(secureFiles, 'local');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accumulate all validation errors for invalid configuration', async () => {
      const secureFiles: SecureFile[] = [
        {
          local: 'public/not-secret.json', // Not git-ignored
          target: '/tmp/bad.json', // Wrong directory
          permissions: 'invalid', // Bad format
          required: true, // File doesn't exist
        },
      ];

      const result = await validator.validate(secureFiles);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors.join('\n')).toContain('NOT git-ignored');
      expect(result.errors.join('\n')).toContain('not under allowed directories');
      expect(result.errors.join('\n')).toContain('Invalid permissions');
    });
  });
});
