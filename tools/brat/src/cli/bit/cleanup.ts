/**
 * Main command logic for brat bit cleanup
 * Sprint 23: Task 2.3
 *
 * Removes generated Bit files (source, test, Dockerfile, docker-compose).
 * Dry-run by default, requires --force to actually remove files.
 */

import fs from 'fs';
import path from 'path';
import { Logger } from '../../orchestration/logger';
import { loadArchitecture } from '../../config/loader';
import { getGitInfo, validateGitEnvironment } from './git-utils';

/**
 * Parse command-line flags
 */
function parseFlags(rest: string[]): Record<string, any> {
  const flags: Record<string, any> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        const [key, ...valueParts] = arg.slice(2).split('=');
        flags[key] = valueParts.join('=');
      } else {
        const key = arg.slice(2);
        if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
          flags[key] = rest[++i];
        } else {
          flags[key] = true;
        }
      }
    }
  }
  return flags;
}

interface CleanupFile {
  path: string;
  exists: boolean;
  size: number;
  type: 'source' | 'test' | 'dockerfile' | 'compose';
}

/**
 * Scan for files associated with a Bit
 */
function findBitFiles(name: string, root: string): CleanupFile[] {
  const files: CleanupFile[] = [];

  // App source (could be in various locations based on entry)
  const possibleSources = [
    path.join(root, `src/apps/${name}-service.ts`),
    path.join(root, `src/apps/${name}.ts`),
    path.join(root, `src/services/${name}-service.ts`),
  ];

  for (const sourcePath of possibleSources) {
    if (fs.existsSync(sourcePath)) {
      const stats = fs.statSync(sourcePath);
      files.push({
        path: sourcePath,
        exists: true,
        size: stats.size,
        type: 'source',
      });

      // Check for corresponding test file
      const testPath = sourcePath.replace(/\.ts$/, '.test.ts');
      if (fs.existsSync(testPath)) {
        const testStats = fs.statSync(testPath);
        files.push({
          path: testPath,
          exists: true,
          size: testStats.size,
          type: 'test',
        });
      }
      break; // Found source, stop looking
    }
  }

  // Dockerfile
  const dockerfilePath = path.join(root, `Dockerfile.${name}`);
  if (fs.existsSync(dockerfilePath)) {
    const stats = fs.statSync(dockerfilePath);
    files.push({
      path: dockerfilePath,
      exists: true,
      size: stats.size,
      type: 'dockerfile',
    });
  }

  // Docker compose
  const composePath = path.join(root, 'infrastructure', 'docker-compose', 'services', `${name}.compose.yaml`);
  if (fs.existsSync(composePath)) {
    const stats = fs.statSync(composePath);
    files.push({
      path: composePath,
      exists: true,
      size: stats.size,
      type: 'compose',
    });
  }

  return files;
}

/**
 * Check if Bit exists in architecture.yaml
 */
function isInArchitecture(name: string, root: string): boolean {
  try {
    const arch = loadArchitecture(root);
    return !!arch?.services?.[name];
  } catch (error) {
    return false;
  }
}

/**
 * Command handler for brat bit cleanup
 */
export async function cmdBitCleanup(
  cmd: string[],
  rest: string[],
  flags: Record<string, any>,
  logger: Logger
): Promise<void> {
  const parsedFlags = { ...flags, ...parseFlags(rest) };

  // Show help if requested
  if (parsedFlags.help || parsedFlags.h) {
    printHelp();
    return;
  }

  // Get positional name argument
  const nameIndex = cmd.indexOf('cleanup') + 1;
  const name = cmd[nameIndex] || parsedFlags.name;

  if (!name) {
    console.error('Error: Bit name is required');
    console.error('Usage: brat bit cleanup <name> [options]');
    console.error('Run: brat bit cleanup --help for more information');
    process.exit(2);
  }

  const force = parsedFlags.force === true || parsedFlags.force === 'true';
  const removeFromArch = parsedFlags['remove-from-arch'] === true || parsedFlags['remove-from-arch'] === 'true';

  // Validate git environment
  const gitValidation = validateGitEnvironment();
  if (!gitValidation.valid) {
    console.error('\n❌ Environment Error:\n');
    gitValidation.errors.forEach(err => console.error(`  ${err}`));
    console.error('');
    process.exit(2);
  }

  const gitInfo = getGitInfo();
  const root = gitInfo.repoRoot!;

  // Find files
  const files = findBitFiles(name, root);
  const inArchitecture = isInArchitecture(name, root);

  // Check if anything to clean up
  if (files.length === 0 && !inArchitecture) {
    console.log(`\n✅ No files found for Bit '${name}'\n`);
    console.log('Nothing to clean up.');
    console.log('');
    return;
  }

  // Display what will be removed
  if (!force) {
    console.log('\n🔍 DRY-RUN MODE - No files will be removed\n');
  } else {
    console.log('\n🗑️  CLEANUP MODE - Files will be permanently deleted\n');
  }

  console.log(`  Bit name: ${name}`);
  console.log(`  Repository root: ${root}\n`);

  if (files.length > 0) {
    console.log('  Files to remove:');
    files.forEach(file => {
      const relativePath = path.relative(root, file.path);
      const sizeKB = (file.size / 1024).toFixed(2);
      const icon = force ? '  [REMOVING]' : '  [WOULD REMOVE]';
      console.log(`${icon} ${relativePath} (${sizeKB} KB)`);
    });
  } else {
    console.log('  No files found on filesystem');
  }

  if (inArchitecture) {
    if (removeFromArch) {
      const icon = force ? '  [REMOVING]' : '  [WOULD REMOVE]';
      console.log(`${icon} Entry in architecture.yaml`);
    } else {
      console.log('  [SKIPPED] Entry in architecture.yaml (use --remove-from-arch to remove)');
    }
  }

  // Execute cleanup if --force
  if (force) {
    console.log('');
    let removedCount = 0;
    let errorCount = 0;

    // Remove files
    for (const file of files) {
      try {
        fs.unlinkSync(file.path);
        removedCount++;
        logger.info({ path: file.path }, 'File removed');
      } catch (error: any) {
        errorCount++;
        console.error(`  ❌ Failed to remove ${file.path}: ${error.message}`);
        logger.error({ path: file.path, error: error.message }, 'File removal failed');
      }
    }

    // Remove from architecture.yaml if requested
    if (inArchitecture && removeFromArch) {
      try {
        const archPath = path.join(root, 'architecture.yaml');
        const yaml = require('js-yaml');
        const archContent = fs.readFileSync(archPath, 'utf8');
        const arch = yaml.load(archContent);

        if (arch?.services?.[name]) {
          delete arch.services[name];
          const newContent = yaml.dump(arch, { lineWidth: -1, noRefs: true });
          fs.writeFileSync(archPath, newContent, 'utf8');
          console.log(`  ✅ Removed '${name}' from architecture.yaml`);
          logger.info({ service: name }, 'Removed from architecture.yaml');
        }
      } catch (error: any) {
        errorCount++;
        console.error(`  ❌ Failed to remove from architecture.yaml: ${error.message}`);
        logger.error({ error: error.message }, 'architecture.yaml update failed');
      }
    }

    console.log('');
    if (errorCount === 0) {
      console.log(`✅ Cleanup complete - Removed ${removedCount} file(s)\n`);
    } else {
      console.log(`⚠️  Cleanup completed with errors - Removed ${removedCount} file(s), ${errorCount} error(s)\n`);
      process.exit(1);
    }
  } else {
    console.log('\n✅ Dry-run complete - No files removed');
    console.log('   Run with --force to actually remove files\n');
  }
}

/**
 * Print help text for brat bit cleanup command
 */
function printHelp(): void {
  console.log(`
brat bit cleanup - Remove generated Bit files

Usage:
  brat bit cleanup <name> [options]

Arguments:
  <name>                Bit name to clean up (required)

Options:
  --force               Actually remove files (default is dry-run)

  --remove-from-arch    Also remove entry from architecture.yaml
                        (only applies when --force is used)

  --help, -h            Show this help message

Behavior:
  - Default mode: Dry-run (shows what would be removed, no changes)
  - With --force: Permanently deletes files (cannot be undone!)
  - Removes: source, test, Dockerfile, docker-compose files
  - Skips architecture.yaml unless --remove-from-arch specified

Examples:
  # Preview what would be removed (dry-run)
  brat bit cleanup test-service

  # Actually remove files
  brat bit cleanup test-service --force

  # Remove files AND architecture.yaml entry
  brat bit cleanup test-service --force --remove-from-arch

Safety:
  - Dry-run by default prevents accidental deletion
  - architecture.yaml preserved unless explicitly requested
  - Git uncommitted changes can be recovered with 'git restore'

For more information, see CLAUDE.md
`);
}
