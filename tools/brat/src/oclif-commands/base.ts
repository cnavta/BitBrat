/**
 * BratCommand Base Class
 *
 * Abstract base class for all oclif-based brat commands.
 * Provides shared functionality:
 * - Pino logger integration with --verbose flag
 * - Execution context resolution with --context flag
 * - Dependency injection pattern for testability
 * - Access to architecture.yaml configuration
 *
 * All brat commands should extend this class instead of oclif Command directly.
 */

import { Command, Flags } from '@oclif/core';
import { createLogger, Logger } from '../orchestration/logger';
import { ContextResolver } from '../context/context-resolver';
import type { ResolvedContext } from '../context/types';
import * as path from 'path';

/**
 * Base dependency injection interface
 * Commands can extend this for their specific dependencies
 */
export interface BaseDeps {
  logger?: Logger;
  contextResolver?: ContextResolver;
}

/**
 * Abstract base class for all brat commands
 *
 * Usage:
 *   export default class MyCommand extends BratCommand {
 *     static description = 'My command description';
 *
 *     static flags = {
 *       myFlag: Flags.string({ description: 'My flag' })
 *     };
 *
 *     async run(): Promise<void> {
 *       const { flags } = await this.parse(MyCommand);
 *       this.logger.info('Running command', { flags });
 *       // Command implementation
 *     }
 *   }
 */
export abstract class BratCommand<T extends typeof Command = any> extends Command {
  /**
   * Global flags available to all commands
   */
  static baseFlags = {
    context: Flags.string({
      char: 'c',
      description: 'Execution context (local, staging, prod)',
      env: 'BITBRAT_CONTEXT',
      required: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Enable verbose debug logging',
      default: false,
    }),
  };

  /**
   * Pino logger instance
   * Configured with --verbose flag support
   */
  protected logger!: Logger;

  /**
   * Resolved execution context
   * Available after init() completes
   */
  protected context!: ResolvedContext;

  /**
   * Repository root directory
   */
  protected repoRoot!: string;

  /**
   * Dependency injection container
   * Can be overridden for testing
   */
  private deps?: BaseDeps;

  /**
   * Initialize the command
   * Sets up logger, context resolver, and resolves execution context
   */
  async init(): Promise<void> {
    await super.init();

    // Determine repository root
    // In compiled code, __dirname is dist/tools/brat/src/oclif-commands
    // Go up to dist/, then up one more to get to project root
    this.repoRoot = path.resolve(__dirname, '../../../../..');

    // Parse flags to get --verbose and --context
    const { flags } = await this.parse(this.constructor as typeof BratCommand);
    const verbose = (flags as any).verbose || false;
    const contextName = (flags as any).context;

    // Initialize logger with appropriate log level
    const logLevel = verbose ? 'debug' : (process.env.LOG_LEVEL || 'info');
    this.logger = this.getDeps().logger || createLogger({
      level: logLevel,
      pretty: process.env.NODE_ENV !== 'production',
      base: {
        command: this.id,
      },
    });

    // Resolve execution context
    try {
      const resolver = this.getDeps().contextResolver || new ContextResolver(this.repoRoot);
      this.context = await resolver.resolve(contextName);

      this.logger.debug({
        contextName: this.context.name,
        deploymentType: this.context.deployment.type,
      }, 'Context resolved');
    } catch (error) {
      this.logger.error({ error }, 'Failed to resolve execution context');
      throw error;
    }
  }

  /**
   * Get or create dependency injection container
   * Allows tests to inject mock dependencies
   *
   * @param overrides - Optional dependency overrides for testing
   * @returns Dependency container
   */
  protected getDeps(overrides?: Partial<BaseDeps>): BaseDeps {
    if (overrides) {
      this.deps = { ...this.deps, ...overrides };
    }

    if (!this.deps) {
      this.deps = {
        logger: undefined, // Will be created in init()
        contextResolver: undefined, // Will be created in init()
      };
    }

    return this.deps;
  }

  /**
   * Catch errors and log them appropriately
   * oclif will handle displaying errors to the user
   */
  protected async catch(error: Error & { exitCode?: number }): Promise<any> {
    // Log the error if logger is available
    if (this.logger) {
      this.logger.error({
        error: error.message,
        stack: error.stack,
        exitCode: error.exitCode,
      }, 'Command failed');
    }

    // Let oclif handle the error display
    return super.catch(error);
  }

  /**
   * Finalize the command
   * Log completion and cleanup resources
   */
  protected async finally(error: Error | undefined): Promise<any> {
    if (this.logger) {
      if (error) {
        this.logger.debug({
          command: this.id,
          error: error.message,
        }, 'Command completed with error');
      } else {
        this.logger.debug({
          command: this.id,
        }, 'Command completed successfully');
      }
    }

    return super.finally(error);
  }
}
