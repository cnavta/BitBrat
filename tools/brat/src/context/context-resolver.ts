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
import { discoverGatewayPort, extractHostFromSSH } from './gateway-discovery';
import { discoverPostgresContainer } from './persistence-discovery';
import { EnvironmentResolver } from '../orchestration/docker/environment-resolver';

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
   * Load ephemeral execution contexts from .brat/ephemeral-contexts.yaml
   * Sprint 358: Agent-dev contexts stored separately from architecture.yaml
   *
   * @returns Ephemeral contexts or empty object if file doesn't exist
   */
  private loadEphemeralContexts(): ExecutionContexts {
    const ephemeralPath = path.join(this.repoRoot, '.brat', 'ephemeral-contexts.yaml');

    if (!fs.existsSync(ephemeralPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(ephemeralPath, 'utf8');
      const parsed = yaml.load(content) as any;
      return (parsed?.executionContexts || {}) as ExecutionContexts;
    } catch (error) {
      // Warn but don't fail - ephemeral contexts are optional
      console.warn(`Warning: Failed to load ephemeral contexts: ${(error as Error).message}`);
      return {};
    }
  }

  /**
   * Load execution contexts from architecture.yaml and .brat/ephemeral-contexts.yaml
   * Sprint 358: Ephemeral contexts (agent-dev) override permanent contexts on name collision
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

      const permanentContexts = arch.executionContexts || {};

      if (Object.keys(permanentContexts).length === 0) {
        throw new ContextResolutionError(
          'No execution contexts defined in architecture.yaml. ' +
          'Run \'brat migrate-contexts\' to migrate from deploymentTargets.'
        );
      }

      // Load ephemeral contexts (Sprint 358)
      const ephemeralContexts = this.loadEphemeralContexts();

      // Merge: ephemeral contexts override permanent on name collision
      const mergedContexts = {
        ...permanentContexts,
        ...ephemeralContexts,
      };

      // Cache merged contexts and mtime
      this.architectureCache = mergedContexts;
      this.architectureMtime = fs.statSync(archPath).mtimeMs;

      return mergedContexts;
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

    // Auto-discover from docker ps
    if (gatewayConfig?.autoDiscover && context.deployment.type === 'docker-compose') {
      const discoveredPort = await discoverGatewayPort(context.deployment.docker!.host);
      if (discoveredPort) {
        const host = this.extractHost(context.deployment.docker!.host);
        return {
          url: `ws://${host}:${discoveredPort}/ws/v1`,
          authToken: gatewayConfig.authToken,
        };
      }
    }

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
   */
  private async resolvePersistence(context: ExecutionContext, name: string): Promise<ResolvedPersistence> {
    const persistence = context.runtime.persistence;

    if (persistence.driver === 'postgres') {
      // Explicit connection config (highest priority)
      if (persistence.connection) {
        return {
          driver: 'postgres',
          connection: persistence.connection,
        };
      }

      // Auto-discover postgres container from Docker
      if (persistence.autoDiscover && context.deployment.type === 'docker-compose') {
        const discovered = await discoverPostgresContainer(context.deployment.docker!.host);
        if (discovered) {
          return discovered;
        }
      }

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
   * Loads and merges YAML files in order: global → infra → {service} → .secure.*
   */
  private async resolveEnvironmentVars(context: ExecutionContext, serviceName?: string): Promise<Record<string, string>> {
    const overlayConfig = context.runtime.envOverlay;
    if (!overlayConfig) {
      return {};
    }

    const merged: Record<string, string> = {};

    // Load files in order (later files override earlier)
    for (const filePattern of overlayConfig.files) {
      const fileName = serviceName ? filePattern.replace('{service}', serviceName) : filePattern;
      const filePath = path.join(this.repoRoot, overlayConfig.path, fileName);

      // Use EnvironmentResolver's loadYamlIfExists (private method, so we'll reimplement)
      const vars = this.loadYamlIfExists(filePath);
      Object.assign(merged, vars);
    }

    // Load .secure.* file last (highest priority)
    if (overlayConfig.secure) {
      const securePath = path.join(this.repoRoot, overlayConfig.secure);
      const secureVars = this.loadSecureEnv(securePath);
      Object.assign(merged, secureVars);
    }

    // Convert all values to strings (required by Record<string, string>)
    const stringified: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) {
      stringified[key] = String(value);
    }

    return stringified;
  }

  /**
   * Load YAML file if it exists (returns empty object on error)
   */
  private loadYamlIfExists(filePath: string): Record<string, any> {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        return (yaml.load(content) as Record<string, any>) || {};
      }
    } catch (error) {
      // Silently ignore errors (file doesn't exist or invalid YAML)
    }
    return {};
  }

  /**
   * Load .secure.* file (KEY=VALUE format)
   */
  private loadSecureEnv(filePath: string): Record<string, string> {
    const env: Record<string, string> = {};
    if (!fs.existsSync(filePath)) return env;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.startsWith('export ')) line = line.slice(7).trim();

        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) continue;

        const key = line.slice(0, eqIndex).trim();
        let value = line.slice(eqIndex + 1).trim();

        // Strip quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // Expand tilde
        if (value === '~') {
          value = os.homedir();
        } else if (value.startsWith('~/')) {
          value = path.join(os.homedir(), value.slice(2));
        }

        if (key) {
          env[key] = value;
        }
      }
    } catch (error) {
      // Silently ignore errors
    }

    return env;
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
