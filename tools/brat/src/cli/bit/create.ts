/**
 * Main command logic for brat bit create
 * Sprint 331: BL-331-105
 */

import fs from 'fs';
import path from 'path';
import { Logger } from '../../orchestration/logger';
import { loadArchitecture } from '../../config/loader';
import { validateBitName, validateProfileExposure, validateBitDoesNotExist } from './validation';
import { generateAppSource, generateTest, generateDockerfile, generateCompose, TemplateOptions } from './templates';
import { registerBitInArchitecture, RegistrationOptions } from './registry';

/**
 * Parse command-line flags
 * Handles both --key=value and --key value formats
 */
function parseFlags(rest: string[]): Record<string, any> {
  const flags: Record<string, any> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      // Handle --key=value format
      if (arg.includes('=')) {
        const [key, ...valueParts] = arg.slice(2).split('=');
        flags[key] = valueParts.join('='); // Rejoin in case value contains '='
      }
      // Handle --key value format
      else {
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

/**
 * Write file safely with optional force overwrite
 */
function writeFileSafe(filePath: string, content: string, force: boolean, logger: Logger): { skipped: boolean; path: string } {
  if (fs.existsSync(filePath) && !force) {
    return { skipped: true, path: filePath };
  }

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return { skipped: false, path: filePath };
}

/**
 * Command handler for brat bit create
 */
export async function cmdBitCreate(
  cmd: string[],
  rest: string[],
  flags: Record<string, any>,
  logger: Logger
): Promise<void> {
  // Parse arguments
  const parsedFlags = { ...flags, ...parseFlags(rest) };

  // Show help if requested or no name provided
  if (parsedFlags.help || parsedFlags.h) {
    printHelp();
    return;
  }

  // Get positional name argument (after 'bit' and 'create')
  const nameIndex = cmd.indexOf('create') + 1;
  const name = cmd[nameIndex] || parsedFlags.name;

  if (!name) {
    console.error('Error: Bit name is required');
    console.error('Usage: brat bit create <name> [options]');
    console.error('Run: brat bit create --help for more information');
    process.exit(2);
  }

  // Parse options with defaults
  const kind = parsedFlags.kind || 'pipeline-service';
  const profile = parsedFlags.profile || 'core';
  // Auto-default exposure based on profile if not explicitly provided
  let exposure = parsedFlags.exposure;
  if (!exposure) {
    // mcp-domain MUST use platform+domain
    exposure = profile === 'mcp-domain' ? 'platform+domain' : 'platform-only';
  }
  const stage = parsedFlags.stage;
  const port = parseInt(parsedFlags.port || '3000', 10);
  const entry = parsedFlags.entry || `src/apps/${name}-service.ts`;
  const description = parsedFlags.description || `Generated Bit: ${name}`;
  const active = parsedFlags.active === true || parsedFlags.active === 'true';
  const force = parsedFlags.force === true || parsedFlags.force === 'true';
  const register = parsedFlags.register === true || parsedFlags.register === 'true';

  const root = process.cwd();

  // Validate inputs
  logger.info({ name, profile, exposure, kind }, 'Validating Bit configuration');

  // 1. Validate name
  const nameResult = validateBitName(name);
  if (!nameResult.valid) {
    console.error('\n❌ Validation Error:\n');
    nameResult.errors.forEach(err => console.error(`  ${err}`));
    console.error('');
    process.exit(2);
  }

  // 2. Validate profile/exposure combination
  const profileResult = validateProfileExposure(profile, exposure);
  if (!profileResult.valid) {
    console.error('\n❌ Validation Error:\n');
    profileResult.errors.forEach(err => console.error(`  ${err}`));
    console.error('\nValid combinations:');
    console.error('  - core: platform-only | none');
    console.error('  - gateway: platform-only | platform+domain | none');
    console.error('  - llm: platform-only | none');
    console.error('  - mcp-domain: platform+domain (required)');
    console.error('');
    process.exit(2);
  }

  // 3. Validate uniqueness (if registering)
  if (register) {
    const arch = loadArchitecture(root);
    const existsResult = validateBitDoesNotExist(name, arch);
    if (!existsResult.valid) {
      console.error('\n❌ Validation Error:\n');
      existsResult.errors.forEach(err => console.error(`  ${err}`));
      console.error('');
      process.exit(2);
    }
  }

  // Generate templates
  logger.info('Generating files');

  const templateOpts: TemplateOptions = {
    name,
    profile: profile as any,
    exposure: exposure as any,
    kind: kind as any,
    port,
    entry,
  };

  const appSource = generateAppSource(templateOpts);
  const testSource = generateTest(name, entry);
  const dockerfile = generateDockerfile(name, entry);
  const compose = generateCompose(name, port, [], []);

  // Write files
  const results: Array<{ file: string; result: { skipped: boolean; path: string } }> = [];

  const appPath = path.join(root, entry);
  results.push({ file: 'App source', result: writeFileSafe(appPath, appSource, force, logger) });

  const testPath = appPath.replace(/\.ts$/, '.test.ts');
  results.push({ file: 'Test', result: writeFileSafe(testPath, testSource, force, logger) });

  const dockerfilePath = path.join(root, `Dockerfile.${name}`);
  results.push({ file: 'Dockerfile', result: writeFileSafe(dockerfilePath, dockerfile, force, logger) });

  const composePath = path.join(root, 'infrastructure', 'docker-compose', 'services', `${name}.compose.yaml`);
  results.push({ file: 'Docker Compose', result: writeFileSafe(composePath, compose, force, logger) });

  // Register in architecture.yaml if requested
  if (register) {
    try {
      const regOpts: RegistrationOptions = {
        name,
        profile,
        exposure,
        kind,
        entry,
        port,
        description,
        active,
        stage,
      };
      await registerBitInArchitecture(regOpts, root, logger);
      logger.info('Bit registered in architecture.yaml');
    } catch (error: any) {
      console.error('\n❌ Registration Error:\n');
      console.error(`  ${error.message}`);
      console.error('');
      process.exit(1);
    }
  }

  // Print summary
  console.log('\n✅ Bit creation complete\n');
  results.forEach(({ file, result }) => {
    const status = result.skipped ? '[EXISTS, SKIPPED]' : '[CREATED]';
    console.log(`  ${status} ${file}: ${path.relative(root, result.path)}`);
  });

  if (register) {
    console.log(`  [REGISTERED] architecture.yaml`);
  }

  console.log('\nNext steps:');
  console.log(`  1. Implement domain logic in ${entry}`);
  console.log(`  2. Run: npm run build`);
  console.log(`  3. Run: npm test -- ${name}`);
  if (!register) {
    console.log(`  4. Register in architecture.yaml (or use --register flag)`);
  }
  console.log('');
}

/**
 * Print help text for brat bit create command
 */
function printHelp(): void {
  console.log(`
brat bit create - Create a new Bit with modern configuration

Usage:
  brat bit create <name> [options]

Arguments:
  <name>                Bit name (required, kebab-case)

Options:
  --kind <k>            Service kind (default: pipeline-service)
                        Options: pipeline-service | gateway | mcp-server

  --profile <p>         Capability profile (default: core)
                        Options: core | gateway | llm | mcp-domain

  --exposure <e>        MCP exposure (default: platform-only)
                        Options: platform-only | platform+domain | none

  --stage <s>           Dataflow stage (optional)
                        Options: ingest | route | analyze | react | egress | persist

  --port <p>            HTTP port (default: 3000)

  --entry <path>        TypeScript entry point (default: src/apps/<name>-service.ts)

  --description <desc>  Human-readable description (default: "Generated Bit: <name>")

  --active              Mark Bit as active (deployable)

  --force               Overwrite existing files

  --register            Also register in architecture.yaml

  --help, -h            Show this help message

Examples:
  # Create a basic core Bit
  brat bit create my-service

  # Create a gateway with domain tools
  brat bit create api-gateway --profile gateway --exposure platform+domain --kind gateway

  # Create an MCP tool server
  brat bit create custom-tools --profile mcp-domain --kind mcp-server

  # Create and register in one step
  brat bit create my-service --register --active

Profile/Exposure Compatibility:
  core       → platform-only | none
  gateway    → platform-only | platform+domain | none
  llm        → platform-only | none
  mcp-domain → platform+domain (required)

For more information, see CLAUDE.md or documentation/tools/brat.md
`);
}
