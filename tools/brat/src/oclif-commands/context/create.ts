/**
 * oclif Command: context create
 * Sprint 360: CTX-003
 *
 * Interactive wizard to create a new execution context in architecture.yaml.
 * Supports both interactive prompts and non-interactive flag mode.
 *
 * Examples:
 *   brat context create prod
 *   brat context create staging --type docker-compose --non-interactive
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { executeContextCreate, ContextCreateOptions } from '../../commands/context/create';

export default class ContextCreate extends BratCommand {
  static description = 'Create a new execution context';

  static examples = [
    '<%= config.bin %> <%= command.id %> prod',
    '<%= config.bin %> <%= command.id %> staging --type docker-compose --non-interactive \\',
    '  --persistence-driver postgres --pg-host localhost \\',
    '  --description "Staging environment"',
  ];

  static args = {
    name: Args.string({
      description: 'Context name (lowercase, no spaces)',
      required: true,
    }),
  };

  static flags = {
    ...BratCommand.baseFlags,

    // Interactive mode toggle
    'non-interactive': Flags.boolean({
      description: 'Non-interactive mode (requires all configuration flags)',
      default: false,
    }),

    // Deployment configuration
    type: Flags.string({
      description: 'Deployment type',
      options: ['docker-compose', 'cloud-run', 'k8s'],
    }),
    description: Flags.string({
      description: 'Context description',
    }),
    tags: Flags.string({
      description: 'Comma-separated tags (e.g., staging,remote)',
    }),

    // Persistence configuration
    'persistence-driver': Flags.string({
      description: 'Persistence driver',
      options: ['postgres', 'firestore'],
    }),
    'pg-host': Flags.string({
      description: 'PostgreSQL host',
    }),
    'pg-port': Flags.integer({
      description: 'PostgreSQL port',
      default: 5432,
    }),
    'pg-database': Flags.string({
      description: 'PostgreSQL database name',
    }),
    'pg-username': Flags.string({
      description: 'PostgreSQL username',
    }),
    'pg-password': Flags.string({
      description: 'PostgreSQL password',
    }),

    // Docker configuration
    'docker-host': Flags.string({
      description: 'Docker host (unix:///var/run/docker.sock or ssh://user@host)',
    }),
    'docker-remote-dir': Flags.string({
      description: 'Remote directory for SSH deployments',
    }),

    // GCP configuration
    'gcp-project': Flags.string({
      description: 'GCP project ID (for cloud-run)',
    }),
    'gcp-region': Flags.string({
      description: 'GCP region (for cloud-run)',
    }),

    // Gateway configuration
    'gateway-url': Flags.string({
      description: 'Override gateway base URL',
    }),
    'gateway-auth-token': Flags.string({
      description: 'Gateway MCP authentication token',
    }),

    // Environment configuration
    'env-path': Flags.string({
      description: 'Environment overlay path (default: env/<context>)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ContextCreate);

    // Map flags to business logic options
    const options: ContextCreateOptions = {
      nonInteractive: flags['non-interactive'],
      type: flags.type as 'docker-compose' | 'cloud-run' | 'k8s' | undefined,
      description: flags.description,
      persistenceDriver: flags['persistence-driver'] as 'postgres' | 'firestore' | undefined,
      pgHost: flags['pg-host'],
      pgPort: flags['pg-port'],
      pgDatabase: flags['pg-database'],
      pgUsername: flags['pg-username'],
      pgPassword: flags['pg-password'],
      dockerHost: flags['docker-host'],
      dockerRemoteDir: flags['docker-remote-dir'],
      gcpProject: flags['gcp-project'],
      gcpRegion: flags['gcp-region'],
      gatewayUrl: flags['gateway-url'],
      gatewayAuthToken: flags['gateway-auth-token'],
      envPath: flags['env-path'],
      tags: flags.tags,
    };

    // Delegate to business logic
    await executeContextCreate(args.name, options);
  }
}
