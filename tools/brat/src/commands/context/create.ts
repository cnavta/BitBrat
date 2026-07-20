/**
 * Sprint 349: brat context create
 *
 * Interactive wizard to create a new execution context in architecture.yaml.
 * Prompts for deployment type, runtime configuration, and writes to file.
 */

import { ContextResolver } from '../../context/context-resolver';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as readline from 'readline';
import { generateServiceConfigs, logGenerationResults } from '../../context/generate-service-configs';
import { cmdSeed } from '../../cli/seed';
import { getActiveServicesArray } from '../../context/parse-services';
import { getRequiredInfrastructure } from '../../context/parse-dependencies';
import { generateAndWriteDockerCompose } from '../../context/generate-docker-compose';

export interface ContextCreateOptions {
  /** Non-interactive mode with all values from flags */
  nonInteractive?: boolean;
  /** Deployment type */
  type?: 'docker-compose' | 'cloud-run' | 'k8s';
  /** Description */
  description?: string;
  /** Persistence driver */
  persistenceDriver?: 'postgres' | 'firestore';
  /** PostgreSQL host */
  pgHost?: string;
  /** PostgreSQL port */
  pgPort?: number;
  /** PostgreSQL database */
  pgDatabase?: string;
  /** PostgreSQL username */
  pgUsername?: string;
  /** PostgreSQL password */
  pgPassword?: string;
  /** Docker host (unix socket or ssh) */
  dockerHost?: string;
  /** Remote directory for SSH deployments */
  dockerRemoteDir?: string;
  /** GCP project ID */
  gcpProject?: string;
  /** GCP region */
  gcpRegion?: string;
  /** Gateway URL */
  gatewayUrl?: string;
  /** Gateway auth token */
  gatewayAuthToken?: string;
  /** Environment overlay path */
  envPath?: string;
  /** Tags (comma-separated) */
  tags?: string;
}

/**
 * Execute 'brat context create <name>' command
 */
export async function executeContextCreate(contextName: string, options: ContextCreateOptions = {}): Promise<void> {
  const repoRoot = process.cwd();
  const resolver = new ContextResolver(repoRoot);

  try {
    // Check if context already exists
    const existing = await resolver.getRawContext(contextName);
    if (existing) {
      console.error(`Error: Context '${contextName}' already exists`);
      console.error(`Use 'brat context show ${contextName}' to view it`);
      process.exit(1);
    }

    // Interactive wizard or non-interactive mode
    const contextConfig = options.nonInteractive
      ? await buildNonInteractive(options)
      : await buildInteractive(contextName);

    // Write to architecture.yaml
    await writeContextToArchitecture(repoRoot, contextName, contextConfig);

    // Scaffold env directory and baseline files
    await scaffoldEnvironment(repoRoot, contextName, contextConfig);

    // Sprint 352 S6.5: Auto-seed database if persistence is configured
    const shouldSeed = await promptForSeeding(contextConfig);

    if (shouldSeed) {
      console.log();
      console.log('Seeding database with initial data...');
      console.log();

      try {
        const seedFlags = {
          context: contextName,
          botName: 'BitBrat', // Default, user can customize later
          dryRun: false,
          wipe: false,
          apiToken: undefined,
          json: false,
        };

        await cmdSeed({}, seedFlags);
      } catch (error: any) {
        console.error();
        console.error('⚠️  Warning: Database seeding failed');
        console.error(`   ${error.message}`);
        console.error();
        console.error('You can manually seed later with: brat seed');
        console.error();
      }
    }

    console.log();
    console.log(`✅ Context '${contextName}' created successfully`);
    console.log();
    console.log('Created:');
    console.log(`  - architecture.yaml: executionContexts.${contextName}`);
    console.log(`  - env/${contextName}/global.yaml`);
    console.log(`  - env/${contextName}/infra.yaml`);
    console.log(`  - env/${contextName}/<service>.yaml (18 service configs generated)`);
    if (shouldSeed) {
      console.log(`  - Database: Seeded with routing rules, reflexes, personalities`);
    }
    console.log();
    console.log('Next steps:');
    console.log(`  - Review: brat context show ${contextName}`);
    console.log(`  - Validate: brat context validate ${contextName}`);
    console.log(`  - Customize: Edit env/${contextName}/*.yaml files`);
    if (!shouldSeed) {
      console.log(`  - Seed: brat seed (populate database with initial data)`);
    }
    console.log(`  - Switch: brat use ${contextName}`);

  } catch (error: any) {
    console.error(`Error creating context: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Build context configuration interactively
 */
async function buildInteractive(contextName: string): Promise<any> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });
  };

  try {
    console.log();
    console.log(`Creating execution context: ${contextName}`);
    console.log('=' .repeat(60));
    console.log();

    // Description
    const description = await prompt('Description (optional): ');

    // Deployment type
    console.log();
    console.log('Deployment type:');
    console.log('  1. docker-compose (local or remote Docker)');
    console.log('  2. cloud-run (Google Cloud Run)');
    console.log('  3. k8s (Kubernetes)');
    const typeChoice = await prompt('Select deployment type [1-3]: ');
    const typeMap: Record<string, string> = { '1': 'docker-compose', '2': 'cloud-run', '3': 'k8s' };
    const deploymentType = typeMap[typeChoice] || 'docker-compose';

    let deployment: any = { type: deploymentType };

    // Docker-specific config
    if (deploymentType === 'docker-compose') {
      console.log();
      console.log('Docker configuration:');
      const dockerHost = await prompt('Docker host [unix:///var/run/docker.sock]: ') || 'unix:///var/run/docker.sock';
      deployment.docker = { host: dockerHost };

      if (dockerHost.startsWith('ssh://')) {
        const remoteDir = await prompt('Remote directory [/opt/BitBratPlatform]: ') || '/opt/BitBratPlatform';
        deployment.docker.remoteDir = remoteDir;
      }
    }

    // GCP-specific config
    if (deploymentType === 'cloud-run') {
      console.log();
      console.log('Google Cloud Platform configuration:');
      const gcpProject = await prompt('GCP project ID: ');
      const gcpRegion = await prompt('GCP region [us-central1]: ') || 'us-central1';
      deployment.gcp = { project: gcpProject, region: gcpRegion };
    }

    // K8s-specific config
    if (deploymentType === 'k8s') {
      console.log();
      console.log('Kubernetes configuration:');
      const cluster = await prompt('Cluster name or context: ');
      const namespace = await prompt('Namespace [default]: ') || 'default';
      deployment.k8s = { cluster, namespace };
    }

    // Persistence
    console.log();
    console.log('Persistence configuration:');
    console.log('  1. postgres (default, platform-agnostic)');
    console.log('  2. firestore (legacy, GCP-specific)');
    const persistenceChoice = await prompt('Select persistence driver [1-2]: ');
    const persistenceDriver = persistenceChoice === '2' ? 'firestore' : 'postgres';

    let persistence: any = { driver: persistenceDriver };

    if (persistenceDriver === 'postgres') {
      console.log();
      const autoDiscover = await prompt('Auto-discover PostgreSQL from docker-compose? [y/n]: ');
      if (autoDiscover.toLowerCase() === 'y') {
        persistence.autoDiscover = true;
      } else {
        const host = await prompt('PostgreSQL host [localhost]: ') || 'localhost';
        const port = await prompt('PostgreSQL port [5432]: ') || '5432';
        const database = await prompt('PostgreSQL database [bitbrat]: ') || 'bitbrat';
        const username = await prompt('PostgreSQL username [bitbrat]: ') || 'bitbrat';
        const password = await prompt('PostgreSQL password: ');

        persistence.connection = {
          host,
          port: parseInt(port, 10),
          database,
          username,
          password: password || '${POSTGRES_PASSWORD}',
        };
      }
    } else {
      // Firestore auto-discover or emulator
      const autoDiscover = await prompt('Auto-discover Firestore emulator? [y/n]: ');
      if (autoDiscover.toLowerCase() === 'y') {
        persistence.autoDiscover = true;
      }
    }

    // Gateway
    console.log();
    console.log('Gateway configuration:');
    const gatewayMode = await prompt('Gateway mode (autodiscover/explicit) [autodiscover]: ') || 'autodiscover';

    let gateway: any = {};
    if (gatewayMode === 'autodiscover') {
      gateway.autoDiscover = true;
      const fallbackPort = await prompt('Fallback port [3004]: ') || '3004';
      gateway.fallbackPort = parseInt(fallbackPort, 10);
    } else {
      const url = await prompt('Gateway URL (e.g., http://bitbrat.lan:3017): ');
      gateway.url = url;
    }

    const authToken = await prompt('Auth token (or ${ENV_VAR}) [${MCP_AUTH_TOKEN}]: ') || '${MCP_AUTH_TOKEN}';
    gateway.authToken = authToken;

    // Environment overlay
    console.log();
    const envPath = await prompt(`Environment overlay path [env/${contextName}]: `) || `env/${contextName}`;
    const envOverlay = {
      path: envPath,
      files: ['global.yaml', 'infra.yaml', '{service}.yaml'],
      secure: `.secure.${contextName}`,
    };

    // Tags
    console.log();
    const tagsInput = await prompt('Tags (comma-separated, optional): ');
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

    rl.close();

    // Assemble final context
    const context: any = {
      deployment,
      runtime: {
        gateway,
        persistence,
        envOverlay,
      },
    };

    if (description) context.description = description;
    if (tags.length > 0) context.tags = tags;

    return context;

  } catch (error) {
    rl.close();
    throw error;
  }
}

/**
 * Build context configuration from flags (non-interactive)
 */
async function buildNonInteractive(options: ContextCreateOptions): Promise<any> {
  const deploymentType = options.type || 'docker-compose';
  const context: any = {
    deployment: { type: deploymentType },
    runtime: {
      persistence: {
        driver: options.persistenceDriver || 'postgres',
      },
    },
  };

  if (options.description) {
    context.description = options.description;
  }

  // Deployment-specific config
  if (deploymentType === 'docker-compose' && options.dockerHost) {
    context.deployment.docker = { host: options.dockerHost };
    if (options.dockerRemoteDir) {
      context.deployment.docker.remoteDir = options.dockerRemoteDir;
    }
  } else if (deploymentType === 'cloud-run' && options.gcpProject) {
    context.deployment.gcp = {
      project: options.gcpProject,
      region: options.gcpRegion || 'us-central1',
    };
  }

  // Persistence config
  if (options.persistenceDriver === 'postgres') {
    if (options.pgHost) {
      context.runtime.persistence.connection = {
        host: options.pgHost,
        port: options.pgPort || 5432,
        database: options.pgDatabase || 'bitbrat',
        username: options.pgUsername || 'bitbrat',
        password: options.pgPassword || '${POSTGRES_PASSWORD}',
      };
    } else {
      context.runtime.persistence.autoDiscover = true;
    }
  } else {
    context.runtime.persistence.autoDiscover = true;
  }

  // Gateway config
  context.runtime.gateway = {};
  if (options.gatewayUrl) {
    context.runtime.gateway.url = options.gatewayUrl;
  } else {
    context.runtime.gateway.autoDiscover = true;
    context.runtime.gateway.fallbackPort = 3004;
  }

  if (options.gatewayAuthToken) {
    context.runtime.gateway.authToken = options.gatewayAuthToken;
  }

  // Env overlay
  if (options.envPath) {
    context.runtime.envOverlay = {
      path: options.envPath,
      files: ['global.yaml', 'infra.yaml', '{service}.yaml'],
    };
  }

  // Tags
  if (options.tags) {
    context.tags = options.tags.split(',').map(t => t.trim()).filter(Boolean);
  }

  return context;
}

/**
 * Write context to architecture.yaml
 */
async function writeContextToArchitecture(repoRoot: string, contextName: string, contextConfig: any): Promise<void> {
  const archPath = path.join(repoRoot, 'architecture.yaml');

  // Read existing architecture.yaml
  const content = fs.readFileSync(archPath, 'utf8');
  const arch = yaml.load(content) as any;

  // Ensure executionContexts exists
  if (!arch.executionContexts) {
    arch.executionContexts = {};
  }

  // Add new context
  arch.executionContexts[contextName] = contextConfig;

  // Write back to file
  const newContent = yaml.dump(arch, { indent: 2, lineWidth: 100, noRefs: true });
  fs.writeFileSync(archPath, newContent, 'utf8');
}

/**
 * Scaffold environment directory and baseline files
 * Sprint 352: Now also generates service-specific YAML files
 */
async function scaffoldEnvironment(repoRoot: string, contextName: string, contextConfig: any): Promise<void> {
  const envDir = path.join(repoRoot, 'env', contextName);

  // Create env/<contextName>/ directory
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
  }

  // Create global.yaml with baseline defaults
  const globalYaml = generateGlobalYaml(contextName, contextConfig);
  fs.writeFileSync(path.join(envDir, 'global.yaml'), globalYaml, 'utf8');

  // Create infra.yaml with baseline defaults
  const infraYaml = generateInfraYaml(contextName, contextConfig);
  fs.writeFileSync(path.join(envDir, 'infra.yaml'), infraYaml, 'utf8');

  // Sprint 352: Generate service-specific YAML files
  console.log();
  console.log('Generating service-specific configuration files...');
  const results = generateServiceConfigs({
    repoRoot,
    contextName,
    contextType: contextConfig.deployment.type,
    force: false,
    dryRun: false,
  });
  logGenerationResults(results);

  // Sprint 352 Epic 2: Generate Docker Compose file for docker-compose contexts
  if (contextConfig.deployment.type === 'docker-compose') {
    console.log();
    console.log('Generating Docker Compose configuration...');

    const activeServices = getActiveServicesArray(repoRoot);
    const infrastructure = getRequiredInfrastructure(repoRoot, activeServices);

    const composePath = generateAndWriteDockerCompose({
      repoRoot,
      contextName,
      activeServices,
      infrastructure,
    });

    console.log(`   Generated: ${composePath}`);
    console.log(`   Services: ${activeServices.length} application services`);
    console.log(`   Infrastructure: ${Array.from(infrastructure).join(', ')}`);
  }
}

/**
 * Generate global.yaml content with baseline defaults
 */
function generateGlobalYaml(contextName: string, contextConfig: any): string {
  const deploymentType = contextConfig.deployment.type;
  const persistenceDriver = contextConfig.runtime.persistence.driver;

  const config: any = {
    // Node environment
    NODE_ENV: contextName === 'local' ? 'development' : 'production',

    // Logging
    LOG_LEVEL: contextName === 'local' ? 'debug' : 'info',

    // Docker Compose
    COMPOSE_PROJECT_NAME: `bitbrat-${contextName}`, // Context-specific stack name

    // Message bus
    MESSAGE_BUS_DRIVER: 'nats', // Default to NATS (platform-agnostic)
    NATS_URL: 'nats://nats:4222',
    BUS_PREFIX: `${contextName}.`, // Message namespace for multi-context isolation

    // Persistence
    PERSISTENCE_DRIVER: persistenceDriver,
  };

  // Add postgres-specific config
  if (persistenceDriver === 'postgres') {
    const conn = contextConfig.runtime.persistence.connection;
    if (conn) {
      config.DATABASE_URL = `postgresql://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${conn.database}`;
    } else {
      // Auto-discover defaults
      config.POSTGRES_HOST = 'postgres';
      config.POSTGRES_PORT = '5432';
      config.POSTGRES_DB = 'bitbrat';
      config.POSTGRES_USER = 'bitbrat';
      config.POSTGRES_PASSWORD = '${POSTGRES_PASSWORD}';
    }
  }

  // Add firestore-specific config
  if (persistenceDriver === 'firestore') {
    config.FIRESTORE_EMULATOR_HOST = 'firestore:8080';
    config.GCP_PROJECT_ID = '${GCP_PROJECT_ID}';
  }

  // Add deployment-specific config
  if (deploymentType === 'cloud-run') {
    config.MESSAGE_BUS_DRIVER = 'pubsub';
    config.GCP_PROJECT_ID = contextConfig.deployment.gcp?.project || '${GCP_PROJECT_ID}';
    config.GCP_REGION = contextConfig.deployment.gcp?.region || 'us-central1';
  }

  const content = yaml.dump(config, { indent: 2, lineWidth: 100 });
  return `# Global environment variables for ${contextName} context
# Generated by 'brat context create ${contextName}'
# Customize as needed for your deployment

${content}`;
}

/**
 * Generate infra.yaml content with baseline defaults
 */
function generateInfraYaml(contextName: string, contextConfig: any): string {
  const deploymentType = contextConfig.deployment.type;
  const persistenceDriver = contextConfig.runtime.persistence.driver;

  const config: any = {};

  // Message bus configuration
  if (deploymentType === 'docker-compose') {
    config.NATS_URL = 'nats://nats:4222';
    config.NATS_CLUSTER_ID = 'bitbrat-cluster';
  } else if (deploymentType === 'cloud-run') {
    // Pub/Sub uses project-level config from global.yaml
  }

  // Persistence configuration
  if (persistenceDriver === 'postgres') {
    if (deploymentType === 'docker-compose') {
      config.POSTGRES_HOST = 'postgres';
      config.POSTGRES_PORT = '5432';
    }
  } else if (persistenceDriver === 'firestore') {
    if (deploymentType === 'docker-compose') {
      config.FIRESTORE_EMULATOR_HOST = 'firestore:8080';
    }
  }

  const content = yaml.dump(config, { indent: 2, lineWidth: 100 });
  return `# Infrastructure-specific environment variables for ${contextName} context
# Generated by 'brat context create ${contextName}'
# Customize as needed for your infrastructure

${content}`;
}

/**
 * Determine whether to seed the database
 * Sprint 352 S6.5: Auto-detect persistence and prompt/auto-seed
 *
 * @param contextConfig - Context configuration
 * @returns True if database should be seeded
 */
async function promptForSeeding(contextConfig: any): Promise<boolean> {
  const persistenceDriver = contextConfig.runtime?.persistence?.driver;

  // Only seed if persistence is configured
  if (!persistenceDriver) {
    return false;
  }

  // For docker-compose contexts with postgres/firestore, auto-seed
  if (contextConfig.deployment.type === 'docker-compose') {
    return true;
  }

  // For cloud deployments, skip auto-seeding (user should seed manually after infrastructure is ready)
  return false;
}
