/**
 * Sprint 349: Environment Unification - Context Resolver
 *
 * Centralized context resolution for all brat commands.
 * Resolves execution context by name with priority:
 * 1. Explicit --context flag
 * 2. BITBRAT_CONTEXT environment variable
 * 3. ~/.bratrc current_context
 * 4. Default: 'local'
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as yaml from 'js-yaml';
import type { Architecture } from '../config/schema';
import type { ExecutionContext, ExecutionContexts } from '../config/execution-context-schema';
import type {
  ResolvedContext,
  ResolvedGateway,
  ResolvedPersistence,
  BratrcConfig,
} from './types';

/**
 * Context resolution error
 */
export class ContextResolutionError extends Error {
  constructor(message: string, public readonly contextName?: string) {
    super(message);
    this.name = 'ContextResolutionError';
  }
}

/**
 * ContextResolver
 *
 * Resolves execution contexts from architecture.yaml and provides
 * centralized context resolution for all brat commands.
 */
export class ContextResolver {
  private contextCache: Map<string, ResolvedContext> = new Map();
  private architectureCache?: ExecutionContexts;
  private architectureMtime?: number;

  constructor(private readonly repoRoot: string) {}

  /**
   * Resolve an execution context by name
   *
   * @param explicitContext - Explicit context name (from --context flag)
   * @returns Resolved context with all fields populated
   * @throws ContextResolutionError if context not found or resolution fails
   */
  async resolve(explicitContext?: string): Promise<ResolvedContext> {
    const contextName = this.resolveContextName(explicitContext);

    // Check cache
    const cached = this.contextCache.get(contextName);
    if (cached && !this.isArchitectureModified()) {
      return cached;
    }

    // Load execution contexts from architecture.yaml
    const contexts = await this.loadExecutionContexts();
    const context = contexts[contextName];

    if (!context) {
      throw new ContextResolutionError(
        `Unknown execution context: '${contextName}'. Available contexts: ${Object.keys(contexts).join(', ')}`,
        contextName
      );
    }

    // Resolve context (gateway URL, persistence, env vars)
    const resolved = await this.resolveContext(contextName, context);

    // Cache resolved context
    this.contextCache.set(contextName, resolved);

    return resolved;
  }

  /**
   * Resolve context name from explicit flag, env var, ~/.bratrc, or default
   *
   * Priority:
   * 1. Explicit --context flag
   * 2. BITBRAT_CONTEXT env var
   * 3. ~/.bratrc current_context
   * 4. Default: 'local'
   */
  private resolveContextName(explicitContext?: string): string {
    // Priority 1: Explicit --context flag
    if (explicitContext) {
      return explicitContext;
    }

    // Priority 2: BITBRAT_CONTEXT env var
    if (process.env.BITBRAT_CONTEXT) {
      return process.env.BITBRAT_CONTEXT;
    }

    // Priority 3: ~/.bratrc current_context
    const bratrc = this.loadBratrc();
    if (bratrc?.current_context) {
      return bratrc.current_context;
    }

    // Priority 4: Default to 'local'
    return 'local';
  }

  /**
   * Load ~/.bratrc configuration
   * Returns null if file doesn't exist or is invalid
   */
  private loadBratrc(): BratrcConfig | null {
    const bratrcPath = path.join(os.homedir(), '.bratrc');

    if (!fs.existsSync(bratrcPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(bratrcPath, 'utf8');
      return yaml.load(content) as BratrcConfig;
    } catch (error) {
      // Warn but don't fail - allow fallback to default context
      console.warn(`Warning: Failed to parse ~/.bratrc: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Load execution contexts from architecture.yaml
   */
  private async loadExecutionContexts(): Promise<ExecutionContexts> {
    // Check cache
    if (this.architectureCache && !this.isArchitectureModified()) {
      return this.architectureCache;
    }

    const archPath = path.join(this.repoRoot, 'architecture.yaml');

    if (!fs.existsSync(archPath)) {
      throw new ContextResolutionError(
        `architecture.yaml not found at ${archPath}. Run 'brat setup' to initialize.`
      );
    }

    try {
      const content = fs.readFileSync(archPath, 'utf8');
      const arch = yaml.load(content) as Architecture;

      if (!arch.executionContexts || Object.keys(arch.executionContexts).length === 0) {
        throw new ContextResolutionError(
          'No execution contexts defined in architecture.yaml. ' +
          'Run \'brat migrate-contexts\' to migrate from deploymentTargets.'
        );
      }

      // Cache contexts and mtime
      this.architectureCache = arch.executionContexts;
      this.architectureMtime = fs.statSync(archPath).mtimeMs;

      return arch.executionContexts;
    } catch (error) {
      if (error instanceof ContextResolutionError) {
        throw error;
      }
      throw new ContextResolutionError(
        `Failed to load architecture.yaml: ${(error as Error).message}`
      );
    }
  }

  /**
   * Check if architecture.yaml has been modified since last load
   */
  private isArchitectureModified(): boolean {
    if (!this.architectureMtime) {
      return true;
    }

    const archPath = path.join(this.repoRoot, 'architecture.yaml');
    if (!fs.existsSync(archPath)) {
      return true;
    }

    const currentMtime = fs.statSync(archPath).mtimeMs;
    return currentMtime !== this.architectureMtime;
  }

  /**
   * Resolve execution context (gateway, persistence, env vars)
   *
   * @param name - Context name
   * @param context - Execution context from architecture.yaml
   * @returns Fully resolved context
   */
  private async resolveContext(name: string, context: ExecutionContext): Promise<ResolvedContext> {
    return {
      name,
      description: context.description,
      deployment: context.deployment,
      runtime: {
        gateway: await this.resolveGateway(context, name),
        persistence: await this.resolvePersistence(context, name),
        envVars: await this.resolveEnvironmentVars(context, name),
      },
      tags: context.tags,
    };
  }

  /**
   * Resolve gateway URL (auto-discover or explicit)
   * Implemented in resolver-002
   */
  private async resolveGateway(context: ExecutionContext, name: string): Promise<ResolvedGateway> {
    const gatewayConfig = context.runtime.gateway;

    // Explicit URL (highest priority)
    if (gatewayConfig?.url) {
      return {
        url: gatewayConfig.url,
        authToken: gatewayConfig.authToken,
      };
    }

    // TODO (resolver-002): Auto-discover from docker ps
    // if (gatewayConfig?.autoDiscover && context.deployment.type === 'docker-compose') {
    //   const discoveredPort = await this.discoverGatewayPort(context.deployment.docker!.host);
    //   if (discoveredPort) {
    //     const host = this.extractHost(context.deployment.docker!.host);
    //     return { url: `ws://${host}:${discoveredPort}/ws/v1`, authToken: gatewayConfig.authToken };
    //   }
    // }

    // Fallback port
    if (gatewayConfig?.fallbackPort) {
      const host = this.extractHost(context.deployment.docker?.host || 'localhost');
      return {
        url: `ws://${host}:${gatewayConfig.fallbackPort}/ws/v1`,
        authToken: gatewayConfig?.authToken,
      };
    }

    throw new ContextResolutionError(
      `Cannot resolve gateway URL for context '${name}': ` +
      'No url, autoDiscover, or fallbackPort configured.',
      name
    );
  }

  /**
   * Resolve persistence configuration
   * Implemented in resolver-003
   */
  private async resolvePersistence(context: ExecutionContext, name: string): Promise<ResolvedPersistence> {
    const persistence = context.runtime.persistence;

    if (persistence.driver === 'postgres') {
      // Explicit connection config
      if (persistence.connection) {
        return {
          driver: 'postgres',
          connection: persistence.connection,
        };
      }

      // TODO (resolver-003): Auto-discover postgres container
      // if (persistence.autoDiscover && context.deployment.type === 'docker-compose') {
      //   const pgConfig = await this.discoverPostgresContainer(context.deployment.docker!.host);
      //   if (pgConfig) return pgConfig;
      // }

      throw new ContextResolutionError(
        `Cannot resolve PostgreSQL persistence for context '${name}': ` +
        'No connection config or autoDiscover enabled.',
        name
      );
    }

    if (persistence.driver === 'firestore') {
      return { driver: 'firestore' };
    }

    throw new ContextResolutionError(
      `Unknown persistence driver for context '${name}': ${persistence.driver}`,
      name
    );
  }

  /**
   * Resolve environment variables from overlays
   * Implemented in resolver-004
   */
  private async resolveEnvironmentVars(context: ExecutionContext, serviceName?: string): Promise<Record<string, string>> {
    const overlayConfig = context.runtime.envOverlay;
    if (!overlayConfig) {
      return {};
    }

    // TODO (resolver-004): Load and merge environment overlays
    // const envResolver = new EnvironmentResolver(this.repoRoot);
    // const merged: Record<string, string> = {};
    // for (const file of overlayConfig.files) {
    //   const fileName = serviceName ? file.replace('{service}', serviceName) : file;
    //   const filePath = path.join(this.repoRoot, overlayConfig.path, fileName);
    //   const vars = await envResolver.loadYamlIfExists(filePath);
    //   Object.assign(merged, vars);
    // }
    // if (overlayConfig.secure) {
    //   const secureVars = await envResolver.loadSecureLocal(overlayConfig.secure);
    //   Object.assign(merged, secureVars);
    // }
    // return merged;

    return {};
  }

  /**
   * Extract host from Docker host string
   * Examples:
   * - unix:///var/run/docker.sock → localhost
   * - ssh://root@bitbrat.lan → bitbrat.lan
   */
  private extractHost(dockerHost: string): string {
    if (dockerHost.includes('unix://')) {
      return 'localhost';
    }

    if (dockerHost.includes('ssh://')) {
      // ssh://user@host → host
      const match = dockerHost.match(/ssh:\/\/(?:[^@]+@)?([^/:]+)/);
      return match ? match[1] : 'localhost';
    }

    return 'localhost';
  }

  /**
   * Clear context cache (useful for testing)
   */
  clearCache(): void {
    this.contextCache.clear();
    this.architectureCache = undefined;
    this.architectureMtime = undefined;
  }

  /**
   * Get list of available context names
   */
  async listContexts(): Promise<string[]> {
    const contexts = await this.loadExecutionContexts();
    return Object.keys(contexts);
  }

  /**
   * Check if a context exists
   */
  async contextExists(name: string): Promise<boolean> {
    const contexts = await this.loadExecutionContexts();
    return name in contexts;
  }

  /**
   * Get raw execution context (unresolved)
   */
  async getRawContext(name: string): Promise<ExecutionContext | undefined> {
    const contexts = await this.loadExecutionContexts();
    return contexts[name];
  }
}
