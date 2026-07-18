import express, { Express, Request, Response, RequestHandler, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { IConfig } from '../types';
// Options for env-backed getters
export type EnvParser<T> = (raw: string) => T;
export interface EnvGetOptions<T> {
  required?: boolean; // default true
  default?: T;
  parser?: EnvParser<T>;
}
import { buildConfig, safeConfig } from './config';
import {logger, Logger} from './logging';
import { runWithEventContext, type EventContext } from './event-context';
import type { ResourceManager, ResourceInstances, SetupContext } from './resources/types';
import { PublisherManager } from './resources/publisher-manager';
import { FirestoreManager } from './resources/firestore-manager';
import { DocumentStoreManager } from './resources/document-store-manager';
import { createMessageSubscriber, createMessagePublisher, type AttributeMap } from '../services/message-bus';
import type { MessageHandler, SubscribeOptions, UnsubscribeFn } from '../services/message-bus';
import { initializeTracing, shutdownTracing, getTracer, startActiveSpan, api } from './tracing';
import type { InternalEventV2, RoutingStep, RoutingStatus, SnapshotDeadletterV1, SnapshotDeliveryV1 } from '../types/events';
import { markSelectedCandidate } from './events/selection';
import { features } from './feature-flags';
import { publishPersistenceSnapshot } from './events/persistence-snapshots';
import type { PublisherResource } from './resources/publisher-manager';
// Bit model (sprint-324): MCP control-plane machinery folded down into the base abstraction.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolResult,
  GetPromptResult,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceResult,
  CallToolRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { INTERNAL_MCP_REGISTRATION_V1 } from '../types/events';
import { collectProfiles, enforceProfileContract } from './profiles/registry';
import type { ContextBinding, ContextPack, ContextProvider } from './context/types';
import { StaticContextProvider } from './context/provider';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type ExpressSetup = (app: Express, cfg: IConfig, resources?: ResourceInstances) => void | Promise<void>;

/**
 * Bit model: the MCP control-plane exposure level for a Bit.
 * - platform-only: serve just the universal bit.* control plane (Platform Ring).
 * - platform+domain: also serve the Bit's domain tools.
 * Absent/undefined means the MCP transport is not wired (legacy BaseServer behavior).
 */
export type McpExposure = 'platform-only' | 'platform+domain';

export interface BaseServerOptions {
  serviceName?: string;
  setup?: ExpressSetup;
  healthPaths?: string[]; // override default health paths if provided
  /** Optional overrides merged into env-derived config */
  configOverrides?: Partial<IConfig>;
  /** Optional configuration validator (throws on error) */
  validateConfig?: (cfg: IConfig) => void;
  /** Optional readiness check used to compute /readyz status (200 if true, 503 if false). */
  readinessCheck?: () => boolean | Promise<boolean>;
  /** Optional resource managers map. Merged over defaults (publisher, firestore). */
  resources?: Record<string, ResourceManager<any>>;
  /**
   * Bit model: explicit MCP control-plane exposure. When set, the Bit wires the MCP
   * transport (/sse + POST /message) and self-publishes its registration on start.
   * When omitted, the MCP transport is not wired (preserves legacy BaseServer behavior).
   */
  mcpExposure?: McpExposure;
}

/**
 * BaseServer
 * - Wraps Express application creation
 * - Automatically registers health endpoints (/healthz, /readyz, /livez) and root
 * - Accepts an optional setup(app) function to customize routes/middleware
 * - Provides helpers to read architecture.yaml and validate required env
 */
export class Bit {
  /**
   * Class-level configuration defaults for env-backed values.
   * Subclasses may override this to provide default values per CONFIG_KEY.
   * Example:
   *   static CONFIG_DEFAULTS = { PORT: 3000, LOG_LEVEL: 'info' };
   */
  protected static CONFIG_DEFAULTS: Record<string, any> = {};
  private readonly app: Express;
  protected readonly serviceName: string;
  private readonly config: IConfig;
  private readonly logger: Logger;
  private readonly resourceManagers: Record<string, ResourceManager<any>>;
  private readonly resources: ResourceInstances;
  private shutdownBound = false;
  private readonly unsubscribers: UnsubscribeFn[] = [];
  // Bit model (sprint-324, Phase 2): lifecycle hooks capability profiles can register into. Startup
  // hooks run at the very start of start() (before the HTTP listener binds, preserving the historical
  // "connect before listen" ordering); shutdown hooks run early in close() (before the unsubscribe
  // loop, matching the prior hand-rolled teardown order).
  private readonly startupHooks: Array<(port: number, host: string) => void | Promise<void>> = [];
  private readonly shutdownHooks: Array<(reason: string) => void | Promise<void>> = [];

  // ---------- Bit model: MCP control-plane state (folded down from McpServer) ----------
  /** The Bit's effective MCP exposure; undefined means the transport is not wired. */
  protected mcpExposure?: McpExposure;
  /** The MCP Server instance. Always constructed; transport is only wired when enabled. */
  protected mcpServer!: Server;
  protected readonly transports: Map<string, SSEServerTransport> = new Map();
  private readonly registeredTools: Map<string, { description: string; schema: any; handler: (args: any, extra?: any) => Promise<CallToolResult>; scopes?: string[] }> = new Map();
  private readonly registeredResources: Map<string, { name: string; description: string; handler: (uri: string, extra?: any) => Promise<ReadResourceResult> }> = new Map();
  private readonly registeredPrompts: Map<string, { description: string; args: { name: string; description?: string; required?: boolean }[]; handler: (name: string, args: Record<string, string>, extra?: any) => Promise<GetPromptResult> }> = new Map();
  // Just-in-Time Context Provisioning (sprint-328): packs contributed by this Bit + the bindings that
  // declare when each pack is relevant (by tool / task / eventType). Exposed via getContextProvider()
  // and advertised additively on the MCP registration event so the tool-gateway can resolve them.
  private readonly registeredContextPacks: Map<string, ContextPack> = new Map();
  private readonly registeredContextBindings: ContextBinding[] = [];

  /**
   * Creates an instance of BaseServer.
   * @param opts - Configuration options for the server.
   */
  constructor(opts: BaseServerOptions = {}) {
    this.app = express();
    this.app.use(express.json());
    this.serviceName = opts.serviceName || process.env.SERVICE_NAME || 'service';

    // Build typed config once for the server lifetime
    this.config = buildConfig(process.env, opts.configOverrides || {});
    // Initialize tracing (no-op if disabled)
    try { initializeTracing(this.serviceName); } catch { /* ignore */ }
    // Set global logger service name and create a pre-configured logger
    Logger.setServiceName(this.serviceName);
    this.logger = new Logger(this.config.logLevel);
    // Expose logger (and config/service) via app.locals for downstream access
    (this.app as any).locals = this.app.locals || {};
    (this.app as any).locals.logger = this.logger;
    (this.app as any).locals.config = this.config;
    (this.app as any).locals.serviceName = this.serviceName;

    // Allow service implementation to assert required config
    if (typeof opts.validateConfig === 'function') {
      opts.validateConfig(this.config);
    }

    // Initialize resources (defaults + overrides)
    this.resourceManagers = this.buildResourceManagers(opts.resources || {});
    this.resources = {} as ResourceInstances;
    (this.app as any).locals.resources = this.resources;
    this.initializeResources();
    this.registerSignalHandlers();

    // In test environments (e.g., Jest), SIGTERM/SIGINT may never fire.
    // Register best-effort cleanup hooks so open handles (subscribers, timers) don't keep the process alive.
    const isJest = Boolean((global as any).jest || process.env.JEST_WORKER_ID);
    if (isJest) {
      const shutdownOnExit = async (_code?: number) => {
        try { await this.close('process-exit'); } catch { /* ignore */ }
      };
      // beforeExit gives the runtime a chance to finish pending promises
      process.once('beforeExit', shutdownOnExit as any);
      process.once('exit', shutdownOnExit as any);
    }

    this.registerHealth(opts.healthPaths, opts.readinessCheck);

    if (typeof opts.setup === 'function') {
      opts.setup(this.app, this.config, this.resources);
    }

    // Bit model: fold the MCP control plane into the base abstraction. The MCP Server is always
    // constructed (cheap, in-memory) but the HTTP transport + self-registration are only wired when
    // exposure is set, so a plain Bit behaves exactly like the legacy BaseServer until promoted.
    this.initializeMcp(opts);

    // Bit model (sprint-324, Phase 2): compose the declared capability profiles over this Bit and
    // enforce the architecture.yaml profile: -> mixin contract, so declared intent cannot diverge
    // from runtime capability. Runs after initializeMcp so profiles may register bit.* control-plane
    // tools (e.g. bit.llm.*) onto an already-initialized MCP server.
    this.bootstrapProfiles();
  }

  /** Returns the underlying Express app instance */
  getApp(): Express {
    return this.app;
  }

  /**
   * Returns the full, validated service config object.
   * Overload 1 (public): getConfig() -> IConfig
   * Overload 2 (protected): getConfig<T>(name, opts?) -> fetches a single env-backed config value
   */
  public getConfig(): IConfig;
  public getConfig<T = string>(name: string, opts?: EnvGetOptions<T>): T;
  getConfig(nameOrNothing?: any, opts?: EnvGetOptions<any>): any {
    if (typeof nameOrNothing === 'string') {
      return this.readEnvValue(nameOrNothing, opts, true);
    }
    return this.config;
  }

  /**
   * Convenience accessor for secret-backed values. For phase 1, this simply reads
   * from process.env just like getConfig(name), because Cloud Run maps secrets to
   * environment variables at runtime.
   * Throws if required and missing.
   */
  protected getSecret<T = string>(name: string, opts?: EnvGetOptions<T>): T {
    // Do NOT use class defaults for secrets.
    return this.readEnvValue(name, opts, false);
  }

  /** Internal helper to read an env var with basic required/default handling */
  private readEnvValue<T = string>(name: string, opts?: EnvGetOptions<T>, useClassDefaults: boolean = true): T {
    const key = String(name || '').trim();
    if (!key) throw new Error('config_key_required');
    const raw = process.env[key];
    const has = typeof raw === 'string' && raw.length > 0;
    const required = opts?.required !== false;
    if (!has) {
      if (opts && 'default' in (opts as any)) return (opts as any).default as T;
      if (useClassDefaults) {
        const Ctor = this.constructor as typeof Bit;
        const clsDefaults = (Ctor && (Ctor as any).CONFIG_DEFAULTS) as Record<string, any> | undefined;
        if (clsDefaults && Object.prototype.hasOwnProperty.call(clsDefaults, key)) {
          const dv = clsDefaults[key];
          // If a parser is provided and the default is a string, allow parsing; otherwise, return as-is
          if (opts?.parser && typeof dv === 'string') return opts.parser(dv) as T;
          return dv as T;
        }
      }
      if (required) {
        const svc = this.serviceName || process.env.SERVICE_NAME || 'service';
        throw new Error(`[${svc}] Missing required configuration: ${key}`);
      }
      return undefined as unknown as T;
    }
    if (opts?.parser) return opts.parser(raw!);
    return raw as unknown as T;
  }

  /** Returns the server's service-scoped logger */
  public getLogger(): Logger {
    return this.logger;
  }

  /** Returns OpenTelemetry tracer if tracing is enabled */
  protected getTracer() {
    return getTracer();
  }

  /** Starts the HTTP server on the given port and optional host */
  async start(port: number, host = '0.0.0.0'): Promise<void> {
    // Bit model: run profile-registered startup hooks first (e.g. McpClientProfile's gateway
    // connect / registry-watcher dance), preserving the prior "connect before listen" ordering.
    for (const fn of this.startupHooks) {
      await fn(port, host);
    }
    this.app.locals.port = port;
    await new Promise<void>((resolve) => {
      this.app.listen(port, host, () => resolve());
    });
    this.logger.info('listening', { host, port });
    // Bit model: self-publish the MCP registration once listening, when the control plane is enabled.
    if (this.isMcpEnabled()) {
      await this.publishRegistration();
    }
  }

  /**
   * Public, idempotent shutdown to release resources and unsubscribe from message bus.
   * Safe to call multiple times.
   */
  public async close(reason: string = 'manual'): Promise<void> {
    if (this.shutdownBound) return; // idempotent
    this.shutdownBound = true;
    this.logger.info('base_server.shutdown.start', { reason });
    // Bit model: run profile-registered shutdown hooks first (e.g. McpClientProfile manager.shutdown
    // + registry-watcher stop), matching the prior hand-rolled teardown order (before unsubscribe).
    for (const fn of this.shutdownHooks.splice(0)) {
      try {
        await fn(reason);
      } catch (e: any) {
        this.logger.warn('bit.shutdown_hook.error', { error: e?.message || String(e) });
      }
    }
    // Attempt to unsubscribe from any message subscriptions first
    for (const fn of this.unsubscribers.splice(0)) {
      try {
        await fn();
        this.logger.info('base_server.unsubscribe.ok');
      } catch (e: any) {
        this.logger.warn('base_server.unsubscribe.error', { error: e?.message || String(e) });
      }
    }
    const keys = Object.keys(this.resourceManagers);
    for (const k of [...keys].reverse()) {
      const mgr = this.resourceManagers[k];
      const inst = (this.resources as any)[k];
      try {
        await Promise.resolve(mgr.shutdown(inst));
        this.logger.info('base_server.resource.shutdown.ok', { key: k });
      } catch (e: any) {
        this.logger.warn('base_server.resource.shutdown.error', { key: k, error: e?.message || String(e) });
      }
    }
    try { await shutdownTracing(); } catch {}
  }

  /**
   * Protected accessor for realized resources by name.
   * Usage: extend BaseServer and call this.getResource<T>('resourceName').
   * Returns undefined if the resource is not initialized yet or missing.
   */
  protected getResource<T>(name: string): T | undefined {
    const n = String(name || '').trim();
    if (!n) return undefined;
    return (this.resources as any)[n] as T | undefined;
  }

  // ==========================================================================
  // Bit model (sprint-324, Phase 2): capability composition (mixins over Bit).
  // Profiles register lifecycle hooks and tools at bootstrap; the declared
  // architecture.yaml profile: is enforced against the applied mixins.
  // ==========================================================================

  /**
   * Register a startup hook (Bit model). Runs at the very start of start(), before the HTTP listener
   * binds. Used by capability profiles (e.g. McpClientProfile) to perform their connect choreography
   * with the same ordering the services previously hand-rolled.
   */
  public onStartup(fn: (port: number, host: string) => void | Promise<void>): void {
    this.startupHooks.push(fn);
  }

  /**
   * Register a shutdown hook (Bit model). Runs early in close(), before the unsubscribe loop, so a
   * profile can tear down its own resources (e.g. MCP client manager) in the historical order.
   */
  public onShutdown(fn: (reason: string) => void | Promise<void>): void {
    this.shutdownHooks.push(fn);
  }

  /**
   * Resolve the Bit's declared capability profile from architecture.yaml. Precedence:
   * services.<name>.profile > defaults.services.profile > 'core'. Unlisted Bits (test fixtures)
   * resolve to 'core'.
   */
  protected resolveProfile(): string {
    try {
      const arch = (this.constructor as any).loadArchitectureYaml?.() || undefined;
      const svcNode = arch?.services?.[this.serviceName];
      const defaults = arch?.defaults?.services;
      return String(svcNode?.profile || defaults?.profile || 'core');
    } catch {
      return 'core';
    }
  }

  /**
   * Compose the capability profiles applied to this Bit's class (and ancestors) and enforce the
   * declared profile: -> mixin contract. An unknown profile value or a missing required mixin fails
   * fast with a clear error, so declared intent cannot diverge from runtime capability (ADR-002).
   */
  protected bootstrapProfiles(): void {
    const applied = collectProfiles(this.constructor as Function);
    const declared = this.resolveProfile();
    enforceProfileContract(declared, applied, this.serviceName);
    for (const profile of applied) {
      try {
        profile.install(this as any);
        this.logger.info('bit.profile.installed', { profile: profile.name });
      } catch (e: any) {
        this.logger.error('bit.profile.install_error', { profile: profile.name, error: e?.message || String(e) });
        throw e;
      }
    }
  }

  // ---------- Protected helpers: HTTP and Message subscription ----------

  /**
   * Register an HTTP endpoint on the internal Express app.
   * Overloads:
   * - onHTTPRequest(path, handler)
   * - onHTTPRequest({ path, method }, handler)
   */
  protected onHTTPRequest(path: string, handler: RequestHandler): void;
  protected onHTTPRequest(cfg: { path: string; method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' }, handler: RequestHandler): void;
  protected onHTTPRequest(arg1: string | { path: string; method?: string }, handler: RequestHandler): void {
    const cfg = typeof arg1 === 'string' ? { path: arg1, method: 'GET' } : { path: arg1.path, method: (arg1.method || 'GET').toUpperCase() };
    const method = String(cfg.method || 'GET').toUpperCase();
    const path = cfg.path;
    const app: any = this.app as any;
    const methodFn = (method === 'GET' ? app.get :
      method === 'POST' ? app.post :
      method === 'PUT' ? app.put :
      method === 'DELETE' ? app.delete :
      method === 'PATCH' ? app.patch : app.get).bind(app);
    this.logger.info('base_server.http.register', { service: this.serviceName, method, path });
    methodFn(path, (req: Request, res: Response, next: any) => {
      // req.body is already parsed by the global express.json() middleware in constructor.
      handler(req, res, next);
    });
  }

  /**
   * Subscribe to a message destination (topic/subject) using the message-bus abstraction.
   *
   * Hierarchical Timeout Strategy:
   * To prevent zombie executions, timeouts are coordinated across layers:
   * 1. Event/Bus (QoS): recommended 90,000ms (90s) - controlled by qos.maxResponseMs
   * 2. Application (LLM Bot): recommended 75,000ms (75s)
   * 3. Infrastructure (MCP Proxy): recommended 60,000ms (60s)
   *
   * Overloads:
   * - onMessage(destination, handler, options?)
   * - onMessage({ destination, queue, ack }, handler)
   */
  // Generic overloads: deliver parsed JSON object of type T to handler
  protected async onMessage<T = any>(
    destination: string,
    handler: (data: T, attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => Promise<void> | void,
    options?: SubscribeOptions
  ): Promise<void>;
  protected async onMessage<T = any>(
    cfg: { destination: string; queue?: string; ack?: 'auto' | 'explicit' },
    handler: (data: T, attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => Promise<void> | void
  ): Promise<void>;
  protected async onMessage<T = any>(
    arg1: string | { destination: string; queue?: string; ack?: 'auto' | 'explicit' },
    handler: (data: T, attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => Promise<void> | void,
    options?: SubscribeOptions
  ): Promise<void> {
    const skipSubscribe = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';
    if (skipSubscribe) {
      this.logger.debug('base_server.message.subscribe.skipped_by_env');
      return;
    }
    const cfg = typeof arg1 === 'string' ? { destination: arg1, queue: undefined as string | undefined, ack: undefined as any } : arg1;
    const subject = `${this.config.busPrefix || ''}${cfg.destination}`;
    const queue = (options && options.queue) || cfg.queue || this.serviceName;
    const ack = (options && options.ack) || cfg.ack || 'explicit';

    const subscriber = createMessageSubscriber();
    this.logger.info('base_server.message.subscribe.start', { subject, queue });

    // Helper to extract EventContext from message data
    // This function never throws - it gracefully handles malformed data
    const extractEventContext = (parsed: any): EventContext => {
      const eventCtx: EventContext = {};

      try {
        // Handle null/undefined parsed data
        if (!parsed || typeof parsed !== 'object') {
          this.logger.debug('base_server.message.context.malformed_data', { subject });
          return eventCtx;
        }

        // Extract correlationId (required for distributed tracing)
        if (parsed.correlationId && typeof parsed.correlationId === 'string') {
          eventCtx.correlationId = parsed.correlationId;
        } else {
          // Log missing correlationId at debug level (not a critical error)
          this.logger.debug('base_server.message.context.missing_correlation_id', { subject, type: parsed.type });
        }

        // Extract traceId (OpenTelemetry trace ID)
        if (parsed.traceId && typeof parsed.traceId === 'string') {
          eventCtx.traceId = parsed.traceId;
        }

        // Extract sessionId (user session identifier)
        if (parsed.metadata?.sessionId && typeof parsed.metadata.sessionId === 'string') {
          eventCtx.sessionId = parsed.metadata.sessionId;
        }

        // Extract userId (from identity.user.id)
        if (parsed.identity?.user?.id && typeof parsed.identity.user.id === 'string') {
          eventCtx.userId = parsed.identity.user.id;
        }

        // Extract requestId (HTTP request identifier)
        if (parsed.metadata?.requestId && typeof parsed.metadata.requestId === 'string') {
          eventCtx.requestId = parsed.metadata.requestId;
        }

        // Extract stage (reactive agent loop stage from routing)
        if (parsed.routing?.stage && typeof parsed.routing.stage === 'string') {
          eventCtx.stage = parsed.routing.stage;
        }
      } catch (e: any) {
        // Never throw - gracefully degrade to empty context
        this.logger.debug('base_server.message.context.extraction_error', {
          subject,
          error: e?.message || String(e)
        });
      }

      return eventCtx;
    };

    try {
      const unsubscribe = await subscriber.subscribe(
        subject,
        async (data, attributes, ctx) => {
          try {
            const tracer = this.getTracer();
            if (tracer) {
              const spanOptions: any = {};
              // Tracer logic: Force sampling if qos.tracer is true
              if ((data as any)?.qos?.tracer) {
                spanOptions.attributes = { 'bb.qos.tracer': true };
                // OpenTelemetry hint for sampling
                spanOptions.kind = api.SpanKind.CONSUMER;
              }

              await startActiveSpan(`msg ${subject}`, spanOptions, async () => {
                // Assume JSON payloads: parse Buffer/string into object for typed handler
                const parsed = JSON.parse((data as any)?.toString('utf8')) as T;

                // Tracer logging: Log full event on reception if qos.tracer is true
                if ((parsed as any)?.qos?.tracer) {
                  this.logger.debug('base_server.message.tracer.receive', { subject, event: parsed });
                }

                // Extract EventContext and wrap handler execution
                const eventCtx = extractEventContext(parsed);
                const handlerPromise = runWithEventContext(eventCtx, () =>
                  Promise.resolve(handler(parsed, attributes, ctx))
                );
                const maxResponseMs = (parsed as any)?.qos?.maxResponseMs;

                if (typeof maxResponseMs === 'number' && maxResponseMs > 0) {
                  const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => {
                      reject(new Error(`BB_QOS_TIMEOUT: Processing exceeded ${maxResponseMs}ms`));
                    }, maxResponseMs);
                  });

                  try {
                    await Promise.race([handlerPromise, timeoutPromise]);
                  } catch (e: any) {
                    if (e.message?.startsWith('BB_QOS_TIMEOUT')) {
                      this.logger.warn('base_server.message.qos.timeout', {
                        subject,
                        correlationId: (parsed as any)?.correlationId,
                        maxResponseMs
                      });
                      // Finalize as error if possible
                      const errEntry = {
                        source: this.serviceName,
                        message: e.message,
                        fatal: true,
                        at: new Date().toISOString()
                      };
                      if ((parsed as any).errors) {
                        (parsed as any).errors.push(errEntry);
                      } else {
                        (parsed as any).errors = [errEntry];
                      }
                      // Note: We don't throw here to allow catch block below to handle it as a normal (but logged) error
                      // or we could throw to trigger the error logging.
                      throw e;
                    }
                    throw e;
                  }
                } else {
                  await handlerPromise;
                }
              });
            } else {
              const parsed = JSON.parse((data as any)?.toString('utf8')) as T;

              // Tracer logging: Log full event on reception if qos.tracer is true
              if ((parsed as any)?.qos?.tracer) {
                this.logger.debug('base_server.message.tracer.receive', { subject, event: parsed });
              }

              // Extract EventContext and wrap handler execution
              const eventCtx = extractEventContext(parsed);
              const handlerPromise = runWithEventContext(eventCtx, () =>
                Promise.resolve(handler(parsed, attributes, ctx))
              );
              const maxResponseMs = (parsed as any)?.qos?.maxResponseMs;

              if (typeof maxResponseMs === 'number' && maxResponseMs > 0) {
                const timeoutPromise = new Promise((_, reject) => {
                  setTimeout(() => {
                    reject(new Error(`BB_QOS_TIMEOUT: Processing exceeded ${maxResponseMs}ms`));
                  }, maxResponseMs);
                });

                try {
                  await Promise.race([handlerPromise, timeoutPromise]);
                } catch (e: any) {
                  if (e.message?.startsWith('BB_QOS_TIMEOUT')) {
                    this.logger.warn('base_server.message.qos.timeout', {
                      subject,
                      correlationId: (parsed as any)?.correlationId,
                      maxResponseMs
                    });
                    const errEntry = {
                      source: this.serviceName,
                      message: e.message,
                      fatal: true,
                      at: new Date().toISOString()
                    };
                    if ((parsed as any).errors) {
                      (parsed as any).errors.push(errEntry);
                    } else {
                      (parsed as any).errors = [errEntry];
                    }
                    throw e;
                  }
                  throw e;
                }
              } else {
                await handlerPromise;
              }
            }
          } catch (e: any) {
            // Conservative default: ack to prevent redelivery storms; handlers may call nack themselves
            this.logger.error('base_server.message.handler_error', { subject, error: e?.message || String(e) });
            try { await ctx.ack(); } catch {}
          }
        },
        { ...(options || {}), queue, ack }
      );
      this.unsubscribers.push(unsubscribe);
      this.logger.info('base_server.message.subscribe.ok', { subject, queue });
    } catch (e: any) {
      this.logger.error('base_server.message.subscribe.error', { subject, error: e?.message || String(e) });
    }
  }

  /** Build combined resource managers: defaults overlaid with provided ones. */
  private buildResourceManagers(overrides: Record<string, ResourceManager<any>>): Record<string, ResourceManager<any>> {
    const defaults: Record<string, ResourceManager<any>> = {
      publisher: new PublisherManager(),
    };
    // Avoid initializing Firestore in Jest/CI test runs to prevent lingering async handles
    const isJest = Boolean((global as any).jest || process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test');
    if (!isJest) {
      logger.debug('base_server.resources.firestore.init');
      defaults.firestore = new FirestoreManager();

      // Register documentStore when using PostgreSQL persistence
      const persistenceDriver = process.env.PERSISTENCE_DRIVER;
      if (persistenceDriver === 'postgres' || persistenceDriver === 'postgresql') {
        logger.debug('base_server.resources.document_store.init', { driver: persistenceDriver });
        defaults.documentStore = new DocumentStoreManager();
      }
    }
    // Merge: overrides replace defaults by key and can add new keys
    const out: Record<string, ResourceManager<any>> = { ...defaults, ...overrides };
    return out;
  }

  /** Initialize all resources and expose realized instances */
  private initializeResources(): void {
    const keys = Object.keys(this.resourceManagers);
    this.logger.info('base_server.resources.init', { keys });
    const ctx: SetupContext = {
      config: this.config,
      logger: this.logger,
      serviceName: this.serviceName,
      env: { ...process.env },
      app: this.app,
    } as any;
    for (const k of keys) {
      const mgr = this.resourceManagers[k];
      try {
        const inst = mgr.setup(ctx);
        if (inst && typeof (inst as any).then === 'function') {
          // Promise returned — handle async setup
          (inst as any)
            .then((realized: any) => {
              (this.resources as any)[k] = realized;
              this.logger.info('base_server.resource.setup.ok', { key: k });
            })
            .catch((e: any) => {
              this.logger.warn('base_server.resource.setup.error', { key: k, error: e?.message || String(e) });
            });
        } else {
          (this.resources as any)[k] = inst;
          this.logger.info('base_server.resource.setup.ok', { key: k });
        }
      } catch (e: any) {
        this.logger.warn('base_server.resource.setup.error', { key: k, error: e?.message || String(e) });
      }
    }
  }

  /** Register SIGTERM/SIGINT handlers to shutdown resources in reverse order */
  private registerSignalHandlers(): void {
    const handler = async (signal: NodeJS.Signals) => {
      // Delegate to unified close() to ensure consistent, idempotent teardown
      await this.close(`signal:${signal}`);
    };
    process.once('SIGTERM', handler);
    process.once('SIGINT', handler);
  }

  private buildHealthBody() {
    return {
      status: 'ok',
      service: this.serviceName,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    };
  }

  private registerHealth(healthPaths?: string[], readinessCheck?: () => boolean | Promise<boolean>) {
    let health = '/healthz';
    let ready = '/readyz';
    let live = '/livez';

    if (healthPaths && healthPaths.length > 0) {
      health = healthPaths[0];
      ready = healthPaths[1] || health;
      live = healthPaths[2] || health;
    }

    this.app.get(health, (_req: Request, res: Response) => {
      res.status(200).json(this.buildHealthBody());
    });
    this.app.get(ready, async (_req: Request, res: Response) => {
      try {
        let ok = true;
        if (typeof readinessCheck === 'function') {
          ok = await readinessCheck();
        }
        const body = { ...this.buildHealthBody(), ready: ok } as any;
        res.status(ok ? 200 : 503).json(body);
      } catch (e: any) {
        res.status(503).json({ ...this.buildHealthBody(), ready: false });
      }
    });
    this.app.get(live, (_req: Request, res: Response) => {
      res.status(200).json(this.buildHealthBody());
    });

    // Root route for quick sanity
    this.app.get('/', (_req: Request, res: Response) => {
      res.status(200).json({ message: `${this.serviceName} up`, ...this.buildHealthBody() });
    });

    // Default debug endpoint for redacted configuration
    this.app.get('/_debug/config', (_req: Request, res: Response) => {
      try {
        const requiredEnv = Bit.computeRequiredKeysFromArchitecture(this.serviceName);
        res.status(200).json({
          service: this.serviceName,
          config: safeConfig(this.config),
          requiredEnv,
        });
      } catch (e: any) {
        this.logger.warn('debug_config_endpoint_error', { error: e?.message || String(e) });
        res.status(500).json({ error: 'debug_config_unavailable' });
      }
    });
  }

  // ---------- Static helpers: architecture.yaml + env validation ----------

  /**
   * Loads architecture.yaml from common candidate locations.
   * Returns the parsed YAML object or null if not found/failed.
   */
  static loadArchitectureYaml(): any | null {
    try {
      const candidates = [
        path.resolve(process.cwd(), 'architecture.yaml'),
        path.resolve(__dirname, '../../architecture.yaml'),
        path.resolve(__dirname, '../../../architecture.yaml'),
        path.resolve(__dirname, '../../../../architecture.yaml'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const src = fs.readFileSync(p, 'utf8');
          return yaml.load(src);
        }
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[Bit] Failed to read architecture.yaml:', e?.message || e);
    }
    return null;
  }

  /**
   * Computes required environment variable keys for a given service
   * from architecture.yaml: union(defaults.services.env, service.env, service.secrets)
   */
  static computeRequiredKeysFromArchitecture(serviceName?: string): string[] {
    const svc = serviceName || process.env.SERVICE_NAME || 'service';
    const arch = Bit.loadArchitectureYaml();
    if (!arch) return [];
    const svcNode = arch.services?.[svc] || {};
    const defaults = arch.defaults?.services || {};
    const defEnv = Array.isArray(defaults.env) ? defaults.env.map(String) : [];
    const svcEnv = Array.isArray(svcNode.env) ? svcNode.env.map(String) : [];
    const secrets = Array.isArray(svcNode.secrets) ? svcNode.secrets.map(String) : [];
    return Array.from(new Set<string>([...defEnv, ...svcEnv, ...secrets]));
  }

  /**
   * Ensures all required env keys (as computed from architecture.yaml) are present.
   * Exits the process with code 1 if any are missing.
   * In local development, some keys (Twilio, Discord, etc.) are treated as optional.
   */
  static ensureRequiredEnv(serviceName?: string): void {
    // Exclude runtime-provided keys (e.g., Cloud Run-provided) from required validation
    const runtimeProvided = new Set<string>(['K_REVISION']);

    // In local development, some integrations are optional even if listed in architecture.yaml
    const isLocal = process.env.BITBRAT_ENV === 'local' || !process.env.BITBRAT_ENV;
    const optionalLocally = isLocal ? new Set<string>([
      'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_CHAT_SERVICE_SID',
      'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET',
    ]) : new Set<string>();

    const required = Bit
      .computeRequiredKeysFromArchitecture(serviceName)
      .filter((k) => !runtimeProvided.has(k) && !optionalLocally.has(k));

    if (!required || required.length === 0) return;
    const missing = required.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[${serviceName || process.env.SERVICE_NAME || 'service'}] Missing required environment variables: ${missing.join(', ')}. ` +
          'These should be provided via env configs or Secret Manager in Cloud Run. Check architecture.yaml definitions.'
      );
      process.exit(1);
    }
  }

  /**
   * Protected helper: advance the event to the next routing destination.
   * - Finds the first pending step (status not in OK|SKIP).
   * - If no pending step, falls back to egressDestination when present.
   * - Publishes with standard attributes and emits tracing/logging.
   * - Idempotent per in-memory event instance: subsequent calls are no-ops unless the prior publish failed.
   */
  protected async next(event: InternalEventV2, stepStatus?: RoutingStatus): Promise<void> {
    // Optionally update the current step before dispatching
    if (stepStatus) {
      try { (this as any).updateCurrentStep?.(event, { status: stepStatus }); } catch {}
    }
    const NEXT_MARK = Symbol.for('bb.routing.next.dispatched');
    if ((event as any)[NEXT_MARK]) {
      this.logger.debug('routing.next.idempotent_noop', { correlationId: event?.correlationId });
      return;
    }
    (event as any)[NEXT_MARK] = true;

    const slip: RoutingStep[] = Array.isArray(event.routing?.slip) ? (event.routing.slip as RoutingStep[]) : [];
    // Only consider explicitly PENDING steps as dispatch targets. Steps marked ERROR should not be retried here.
    const idxPending = slip.findIndex((s) => s && s.status === 'PENDING');
    // If no pending step, fallback to egress
    if (idxPending < 0) {
      const destRaw = event.egress?.destination;
      const cfg: any = (this as any).getConfig?.() || {};
      const prefix: string = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
      const needsPrefix = (s: string) => !!prefix && !s.startsWith(prefix);
      const dest = destRaw ? (needsPrefix(destRaw) ? `${prefix}${destRaw}` : destRaw) : undefined;
      if (!dest) {
        this.logger.warn('routing.next.no_target', { correlationId: event?.correlationId });
        return;
      }

      // Standardize egress format: update type and mark selected candidate
      const egressEvent = markSelectedCandidate({
        ...event,
        type: 'egress.deliver.v1',
      });

      const pub = createMessagePublisher(dest);
      try {
        const spanOptions: any = {};
        if (egressEvent.qos?.tracer) {
          spanOptions.attributes = { 'bb.qos.tracer': true };
        }

        await startActiveSpan('routing.complete', spanOptions, async () => {
          // Tracer logging: Log full event before publication if qos.tracer is true
          if (egressEvent.qos?.tracer) {
            this.logger.debug('routing.complete.tracer.publish', { dest, event: egressEvent });
          }
          await pub.publishJson(egressEvent, this.buildRoutingAttributes(egressEvent));
        });
      } catch (e) {
        delete (event as any)[NEXT_MARK];
        throw e;
      }
      this.logger.info('routing.next.fallback_egress', { dest, correlationId: event?.correlationId });
      return;
    }

    // Determine which step to dispatch to: always the first pending step
    const step = slip[idxPending] as RoutingStep;
    // Minimal mutation for observability on the step we're dispatching to
    step.startedAt = step.startedAt || new Date().toISOString();
    // attempt is 0-based per contract
    step.attempt = (typeof step.attempt === 'number' ? step.attempt : -1) + 1;
    const subjectRaw = (step.nextTopic) as string;
    const cfg: any = (this as any).getConfig?.() || {};
    const prefix: string = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
    const needsPrefix = (s: string) => !!prefix && !s.startsWith(prefix);
    const subject = subjectRaw ? (needsPrefix(subjectRaw) ? `${prefix}${subjectRaw}` : subjectRaw) : '';
    if (!subject) {
      this.logger.warn('routing.next.step_missing_subject', { correlationId: event?.correlationId });
      return;
    }
    const pub = createMessagePublisher(subject);

    try {
      await startActiveSpan('routing.next', async () => {
        const spanOptions: any = {};
        if (event.qos?.tracer) {
          spanOptions.attributes = { 'bb.qos.tracer': true };
        }

        await startActiveSpan('routing.next', spanOptions, async () => {
          // Tracer logging: Log full event before publication if qos.tracer is true
          if (event.qos?.tracer) {
            this.logger.debug('routing.next.tracer.publish', { subject, event });
          }
          await pub.publishJson(event, this.buildRoutingAttributes(event, step));
        });
      });
    } catch (e) {
      // Clear idempotency mark to allow safe retry by caller
      delete (event as any)[NEXT_MARK];
      throw e;
    }

    this.logger.info('routing.next.published', {
      subject,
      stepIndex: slip.indexOf(step),
      attempt: step.attempt,
      correlationId: event?.correlationId,
    });
    await this.publishPersistenceSnapshot({
      kind: 'update',
      sourceTopic: subject,
      event,
      stepId: step.id,
      attempt: step.attempt,
      changeSummary: `routing advanced to ${subject}`,
      delivery: {
        destination: subject,
        status: 'ROUTED',
        deliveredAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Protected helper: bypass routing slip and publish directly to egressDestination.
   * - Idempotent per in-memory event instance.
   */
  protected async complete(event: InternalEventV2, stepStatus?: RoutingStatus): Promise<void> {
    // Optionally update the current step before dispatching to egress
    if (stepStatus) {
      try { (this as any).updateCurrentStep?.(event, { status: stepStatus }); } catch {}
    }
    const COMPLETE_MARK = Symbol.for('bb.routing.complete.dispatched');
    if ((event as any)[COMPLETE_MARK]) {
      this.logger.debug('routing.complete.idempotent_noop', { correlationId: event?.correlationId });
      return;
    }
    (event as any)[COMPLETE_MARK] = true;

    const destRaw = event.egress?.destination;
    const cfg: any = (this as any).getConfig?.() || {};
    const prefix: string = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
    const needsPrefix = (s: string) => !!prefix && !s.startsWith(prefix);
    const dest = destRaw ? (needsPrefix(destRaw) ? `${prefix}${destRaw}` : destRaw) : undefined;
    if (!dest) {
      this.logger.warn('routing.complete.no_egress', { correlationId: event?.correlationId });
      return;
    }

    // Standardize egress format: update type and mark selected candidate
    const egressEvent = markSelectedCandidate({
      ...event,
      type: 'egress.deliver.v1',
    });

    const pub = createMessagePublisher(dest);
    try {
      await startActiveSpan('routing.complete', async () => {
        await pub.publishJson(egressEvent, this.buildRoutingAttributes(egressEvent));
      });
    } catch (e) {
      delete (event as any)[COMPLETE_MARK];
      throw e;
    }
    this.logger.info('routing.complete.published', { dest, correlationId: event?.correlationId });
    await this.publishPersistenceSnapshot({
      kind: 'update',
      sourceTopic: dest,
      event: egressEvent,
      changeSummary: `routing completed to ${dest}`,
      delivery: {
        destination: dest,
        status: 'ROUTED',
        deliveredAt: new Date().toISOString(),
      },
    });
  }

  protected async publishPersistenceSnapshot(params: {
    kind: 'update' | 'final' | 'deadletter';
    sourceTopic: string;
    event: InternalEventV2;
    changeSummary?: string;
    delivery?: SnapshotDeliveryV1;
    deadletter?: SnapshotDeadletterV1;
    idempotencyKey?: string;
    capturedAt?: string;
    stepId?: string;
    attempt?: number;
  }): Promise<void> {
    try {
      const publisher = this.getResource<PublisherResource>('publisher');
      await publishPersistenceSnapshot({
        config: this.getConfig() as any,
        createPublisher: (subject: string) => publisher?.create(subject) || createMessagePublisher(subject),
        logger: this.logger as any,
        kind: params.kind,
        sourceService: this.serviceName,
        sourceTopic: params.sourceTopic,
        event: params.event,
        changeSummary: params.changeSummary,
        delivery: params.delivery,
        deadletter: params.deadletter,
        idempotencyKey: params.idempotencyKey,
        capturedAt: params.capturedAt,
        stepId: params.stepId,
        attempt: params.attempt,
      });
    } catch (error: any) {
      this.logger.warn('persistence.snapshot.publish_error', {
        correlationId: params.event?.correlationId,
        kind: params.kind,
        error: error?.message || String(error),
      });
    }
  }

  /**
   * Protected helper: update the current pending routing step with provided fields.
   * - Finds the first step whose status is not in OK|SKIP (i.e., pending in our semantics).
   * - Applies updates: status, error, notes/appendNote.
   * - If status transitions to a terminal state (OK|SKIP|ERROR), sets endedAt (if unset).
   * - Returns { index, step } or null when no pending step exists.
   */
  protected updateCurrentStep(
    event: InternalEventV2,
    update: {
      status?: 'PENDING' | 'OK' | 'ERROR' | 'SKIP';
      error?: { code: string; message?: string; retryable?: boolean } | null;
      notes?: string;
      appendNote?: string;
    }
  ): { index: number; step: RoutingStep } | null {
    const slip: RoutingStep[] = Array.isArray(event.routing?.slip) ? (event.routing.slip as RoutingStep[]) : [];
    if (!Array.isArray(slip) || slip.length === 0) {
      this.logger.debug('routing.step_update.no_slip', { correlationId: (event as any)?.correlationId });
      return null;
    }
    const idx = slip.findIndex((s) => s && s.status !== 'OK' && s.status !== 'SKIP');
    if (idx < 0) {
      this.logger.debug('routing.step_update.no_pending', { correlationId: (event as any)?.correlationId });
      return null;
    }
    const step = slip[idx] as RoutingStep;

    // Apply notes update
    if (typeof update.notes === 'string') {
      step.notes = update.notes;
    } else if (typeof update.appendNote === 'string' && update.appendNote) {
      step.notes = step.notes ? `${step.notes}\n${update.appendNote}` : update.appendNote;
    }

    // Apply error set/clear
    if (update.hasOwnProperty('error')) {
      (step as any).error = update.error ?? null;
    }

    // Apply status and manage endedAt for terminal
    if (update.status) {
      step.status = update.status as any;
      if (update.status === 'OK' || update.status === 'SKIP' || update.status === 'ERROR') {
        step.endedAt = step.endedAt || new Date().toISOString();
      }
    }

    this.logger.debug('routing.step_update.applied', {
      correlationId: (event as any)?.correlationId,
      stepIndex: idx,
      status: step.status,
    });
    return { index: idx, step };
  }

  // Internal: build standard message attributes for routing publishes
  private buildRoutingAttributes(event: InternalEventV2, step?: RoutingStep): AttributeMap {
    const attrs: AttributeMap = {
      correlationId: String((event as any).correlationId || ''),
      type: String((event as any).type || ''),
      source: this.serviceName,
    };
    // Inject current traceparent if tracing active; startActiveSpan should have set context. We also propagate any existing traceId.
    try {
      const tracer = this.getTracer();
      // Fall back to existing traceId if present via event
      const traceId = (event as any).traceId as string | undefined;
      if (tracer) {
        // startActiveSpan manages context injection during publish; we expose a hint via traceId if present
        if (traceId) attrs.traceparent = traceId;
      } else if (traceId) {
        attrs.traceparent = traceId;
      }
    } catch {
      // ignore tracing errors
    }
    if ((event as any).replyTo) attrs.replyTo = String((event as any).replyTo);
    if (step && step.attributes) {
      // Merge step attributes with last-writer-wins: step attrs first, then base overwrites reserved keys
      for (const [k, v] of Object.entries(step.attributes)) {
        attrs[k] = String(v);
      }
      // Ensure reserved keys are preserved
      attrs.correlationId = String((event as any).correlationId || '');
      attrs.type = String((event as any).type || '');
      attrs.source = this.serviceName;
    }
    return attrs;
  }

  // ==========================================================================
  // Bit model: MCP control plane (folded down from the former McpServer).
  // The MCP Server is always constructed; the HTTP transport (/sse + /message)
  // and registry self-publish are only wired when `mcpExposure` is set.
  // ==========================================================================

  /**
   * Resolve the Bit's effective MCP exposure (Bit model, sprint-324).
   * Precedence: explicit opts.mcpExposure (e.g. the McpServer shim) > the ratified
   * `services.<name>.mcp.exposure` in architecture.yaml > undefined (MCP-off). Only services that
   * explicitly declare an exposure are promoted, so test fixtures and unlisted Bits keep legacy
   * behavior. Subclasses may override to compute exposure differently.
   */
  protected resolveMcpExposure(opts: BaseServerOptions): McpExposure | undefined {
    // Explicit opts win (e.g. the McpServer shim selects platform+domain).
    if (opts.mcpExposure) return opts.mcpExposure;
    // Otherwise read the ratified declaration from architecture.yaml (Phase R / §6.3). Only services
    // that explicitly declare mcp.exposure are promoted; unlisted Bits (e.g. test fixtures) stay
    // MCP-off, preserving legacy behavior. Sensitive services were ratified as platform-only.
    try {
      const arch = (this.constructor as any).loadArchitectureYaml?.() || undefined;
      const svcNode = arch?.services?.[this.serviceName];
      const exposure = svcNode?.mcp?.exposure;
      if (exposure === 'platform-only' || exposure === 'platform+domain') return exposure;
    } catch { /* ignore — fall through to MCP-off */ }
    return undefined;
  }

  /** True when this Bit serves an MCP control-plane endpoint. */
  protected isMcpEnabled(): boolean {
    return this.mcpExposure === 'platform-only' || this.mcpExposure === 'platform+domain';
  }

  /** True when this Bit also serves its domain tools (not just the bit.* control plane). */
  protected isDomainExposed(): boolean {
    return this.mcpExposure === 'platform+domain';
  }

  /**
   * Construct the MCP Server and (when enabled) wire its HTTP transport. Called once at the end of
   * construction so the MCP routes are registered after any user-supplied setup(), matching the
   * historical McpServer ordering.
   */
  protected initializeMcp(opts: BaseServerOptions): void {
    this.mcpExposure = this.resolveMcpExposure(opts);

    const arch = (this.constructor as any).loadArchitectureYaml?.() || undefined;
    const svcNode = arch?.services?.[this.serviceName] || {};
    const description = svcNode.description || 'BitBrat MCP Server';
    const version = arch?.project?.version || '1.0.0';

    this.mcpServer = new Server(
      {
        name: this.serviceName,
        version: version,
        description: description,
      } as any,
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.setupDiscoveryHandlers();

    if (this.isMcpEnabled()) {
      // Platform Ring: the mandatory bit.* control plane is registered before any Business-Ring
      // (domain) tools, so it is guaranteed present and identical across every Bit.
      this.registerPlatformTools();
      this.setupMcpRoutes();
    }
  }

  /**
   * Register the mandatory bit.* platform toolset (the universal control plane Brat administers).
   * Each tool is backed by an existing platform primitive and carries RBAC scopes: read-only tools
   * use the low `bit:read` scope; mutating/operator tools require the elevated `bit:operate` scope.
   * Secrets are never returned (config is redacted via the same safeConfig() used by /_debug/config).
   */
  protected registerPlatformTools(): void {
    const READ = ['bit:read'];
    const OPERATE = ['bit:operate'];
    const ok = (data: any): CallToolResult => ({
      content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    });

    // bit.info — identity, version, declared profile/exposure, topics and secret *names* (no values).
    this.registerTool('bit.info', 'Bit identity: name, version, profile, exposure, declared topics and secret names.', z.object({}), async () => {
      const arch = (this.constructor as any).loadArchitectureYaml?.() || undefined;
      const svcNode = arch?.services?.[this.serviceName] || {};
      const defaults = arch?.defaults?.services || {};
      return ok({
        name: this.serviceName,
        version: arch?.project?.version || '0.0.0',
        profile: svcNode.profile || defaults.profile || 'core',
        exposure: this.mcpExposure,
        kind: svcNode.kind,
        topics: svcNode.topics || {},
        secrets: Array.isArray(svcNode.secrets) ? svcNode.secrets : [],
      });
    }, { scopes: READ });

    // bit.health / bit.readiness — structured status mirroring /healthz and /readyz.
    this.registerTool('bit.health', 'Structured health status (mirrors /healthz).', z.object({}), async () => ok(this.buildHealthBody()), { scopes: READ });
    this.registerTool('bit.readiness', 'Structured readiness status (mirrors /readyz).', z.object({}), async () => ok({ ...this.buildHealthBody(), ready: true }), { scopes: READ });

    // bit.config.get / bit.config.describe — effective config with secrets redacted.
    this.registerTool('bit.config.get', 'Effective configuration with secrets redacted.', z.object({}), async () => ok(safeConfig(this.config)), { scopes: READ });
    this.registerTool('bit.config.describe', 'Effective configuration plus the required env keys for this Bit (secrets redacted).', z.object({}), async () => ok({
      service: this.serviceName,
      config: safeConfig(this.config),
      requiredEnv: (this.constructor as any).computeRequiredKeysFromArchitecture?.(this.serviceName) || [],
    }), { scopes: READ });

    // bit.flags.get / bit.flags.set — live feature-flag inspect/toggle via the FeatureGate.
    this.registerTool('bit.flags.get', 'Inspect a feature flag (or list all known canonical keys).', z.object({ key: z.string().optional() }), async (args) => {
      if (args.key) return ok({ key: args.key, enabled: features.enabled(args.key), raw: features.rawValue(args.key) });
      return ok({ keys: features.keys() });
    }, { scopes: READ });
    this.registerTool('bit.flags.set', 'Set an in-memory feature-flag override (pass empty value to clear).', z.object({ key: z.string(), value: z.string() }), async (args) => {
      features.setOverride(args.key, args.value === '' ? undefined : args.value);
      return ok({ key: args.key, enabled: features.enabled(args.key) });
    }, { scopes: OPERATE });

    // bit.log.level — runtime log-level change.
    this.registerTool('bit.log.level', 'Change the runtime log level (error|warn|info|debug).', z.object({ level: z.enum(['error', 'warn', 'info', 'debug']) }), async (args) => {
      this.logger.setLevel(args.level as any);
      this.logger.info('bit.log.level.changed', { level: args.level });
      return ok({ level: args.level });
    }, { scopes: OPERATE });

    // bit.drain / bit.shutdown — graceful lifecycle via close(reason).
    this.registerTool('bit.drain', 'Gracefully drain and release resources (alias of shutdown).', z.object({ reason: z.string().optional() }), async (args) => {
      const reason = args.reason || 'bit.drain';
      setTimeout(() => { this.close(reason).catch(() => { /* ignore */ }); }, 0);
      return ok({ draining: true, reason });
    }, { scopes: OPERATE });
    this.registerTool('bit.shutdown', 'Gracefully shut the Bit down via close(reason).', z.object({ reason: z.string().optional() }), async (args) => {
      const reason = args.reason || 'bit.shutdown';
      setTimeout(() => { this.close(reason).catch(() => { /* ignore */ }); }, 0);
      return ok({ shuttingDown: true, reason });
    }, { scopes: OPERATE });

    // bit.restart — graceful close followed by a clean process exit so the orchestrator (Cloud Run
    // min-instances / local supervisor) respawns a fresh instance. Same RBAC as drain/shutdown.
    this.registerTool('bit.restart', 'Gracefully restart the Bit: close(reason) then exit for the orchestrator to respawn.', z.object({ reason: z.string().optional() }), async (args) => {
      const reason = args.reason || 'bit.restart';
      setTimeout(() => { this.restart(reason).catch(() => { /* ignore */ }); }, 0);
      return ok({ restarting: true, reason });
    }, { scopes: OPERATE });
  }

  /**
   * Graceful restart: release resources via close(reason), then exit the process so the orchestrator
   * (Cloud Run min-instances / local supervisor) starts a fresh instance. Overridable for tests or
   * for environments that perform an in-process re-exec. Set BIT_RESTART_NO_EXIT=1 to skip the exit
   * (e.g. in tests) and only perform the graceful close.
   */
  protected async restart(reason: string = 'bit.restart'): Promise<void> {
    this.logger.info('base_server.restart.start', { reason });
    try {
      await this.close(reason);
    } finally {
      if (String(process.env.BIT_RESTART_NO_EXIT || '') !== '1') {
        this.logger.info('base_server.restart.exit', { reason, code: 0 });
        process.exit(0);
      }
    }
  }

  /**
   * Create a new Server instance for each SSE connection.
   * The MCP SDK requires one Server instance per transport connection.
   *
   * This duplicates the registration logic from initializeMcp() but is necessary
   * because each SSE connection needs its own Server instance.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async getMcpServerForConnection(_req: Request): Promise<Server> {
    // Get version from architecture.yaml (same as initializeMcp)
    const arch = (this.constructor as any).loadArchitectureYaml?.() || undefined;
    const svcNode = arch?.services?.[this.serviceName] || {};
    const description = svcNode.description || 'BitBrat MCP Server';
    const version = arch?.project?.version || '1.0.0';

    // Create a new Server instance for this connection
    const server = new Server(
      {
        name: this.serviceName,
        version: version,
        description: description,
      } as any,
      {
        capabilities: {
          tools: this.registeredTools.size > 0 ? {} : undefined,
          resources: this.registeredResources.size > 0 ? {} : undefined,
          prompts: this.registeredPrompts.size > 0 ? {} : undefined,
        },
      }
    );

    // Copy all request handlers from the main server to this connection-specific server
    // This ensures all registered tools, resources, and prompts are available
    const mainServer = this.mcpServer as any;
    if (mainServer._requestHandlers) {
      server['_requestHandlers'] = new Map(mainServer._requestHandlers);
    }

    return server;
  }

  /**
   * Register a tool with type-safe Zod schema validation.
   */
  public registerTool<T extends z.ZodType>(
    name: string,
    description: string,
    schema: T,
    handler: (args: z.infer<T>, extra?: any) => Promise<CallToolResult>,
    options?: { scopes?: string[] }
  ) {
    this.registeredTools.set(name, { description, schema, handler, scopes: options?.scopes });
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const tool = this.registeredTools.get(request.params.name);
      if (!tool) throw new Error(`Tool not found: ${request.params.name}`);
      const args = tool.schema.parse(request.params.arguments);

      const meta = (request.params as any)._meta;
      const combinedExtra = {
        ...extra,
        userId: meta?.userId || extra?.requestInfo?.headers?.['x-user-id'] || extra?.requestInfo?.headers?.['x-bitbrat-user-id'],
        userRoles: meta?.userRoles || extra?.requestInfo?.headers?.['x-roles'] || extra?.requestInfo?.headers?.['x-bitbrat-roles']
      };

      return await this.traceMcpOperation(`tool:${request.params.name}`, () => tool.handler(args, combinedExtra));
    });
    this.getLogger().info("mcp_server.tool_registered", { name });
  }

  /**
   * Register a resource.
   */
  public registerResource(
    uri: string,
    name: string,
    description: string,
    handler: (uri: string, extra?: any) => Promise<ReadResourceResult>
  ) {
    this.registeredResources.set(uri, { name, description, handler });
    this.mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
      const resource = this.registeredResources.get(request.params.uri);
      if (!resource) throw new Error(`Resource not found: ${request.params.uri}`);

      const meta = (request.params as any)._meta;
      const combinedExtra = {
        ...extra,
        userId: meta?.userId || extra?.requestInfo?.headers?.['x-user-id'] || extra?.requestInfo?.headers?.['x-bitbrat-user-id'],
        userRoles: meta?.userRoles || extra?.requestInfo?.headers?.['x-roles'] || extra?.requestInfo?.headers?.['x-bitbrat-roles']
      };

      return await this.traceMcpOperation(`resource:${resource.name}`, () => resource.handler(request.params.uri, combinedExtra));
    });
    this.getLogger().info("mcp_server.resource_registered", { name, uri });
  }

  // ---------- Just-in-Time Context Provisioning (sprint-328) ----------

  /**
   * Contribute a Context Pack from this Bit. Packs are advertised on the MCP registration event and
   * exposed via getContextProvider(); they are NOT auto-registered as MCP Resources (a service may
   * still call registerResource to expose a pack body for tool turns).
   */
  public registerContextPack(pack: ContextPack): void {
    this.registeredContextPacks.set(pack.id, pack);
    this.getLogger().info('context.pack_registered', { id: pack.id, version: pack.version });
  }

  /**
   * Record a Context Pack binding (by tool / task / eventType). Used directly for task/eventType
   * bindings; tool bindings are usually recorded via registerToolWithContext.
   */
  public registerContextBinding(binding: ContextBinding): void {
    this.registeredContextBindings.push(binding);
  }

  /**
   * Register an MCP tool AND bind one or more Context Packs to it (by tool name). Behaves exactly
   * like registerTool when packIds is empty (no binding recorded), so existing callers are
   * unaffected. The bound packs are surfaced just-in-time when this tool is in the active set.
   */
  public registerToolWithContext<T extends z.ZodType>(
    name: string,
    description: string,
    schema: T,
    handler: (args: z.infer<T>, extra?: any) => Promise<CallToolResult>,
    packIds: string[] = [],
    options?: { scopes?: string[] }
  ): void {
    this.registerTool(name, description, schema, handler, options);
    for (const packId of packIds) {
      this.registeredContextBindings.push({ pack: packId, when: { tools: [name] } });
    }
  }

  /** All Context Packs contributed by this Bit. */
  public listContextPacks(): ContextPack[] {
    return Array.from(this.registeredContextPacks.values());
  }

  /** All Context Pack bindings recorded on this Bit. */
  public listContextBindings(): ContextBinding[] {
    return [...this.registeredContextBindings];
  }

  /** A ContextProvider view over this Bit's registered packs + bindings. */
  public getContextProvider(): ContextProvider {
    return new StaticContextProvider(this.listContextPacks(), this.listContextBindings());
  }

  /** Introspection: descriptors of the MCP Tools registered on this Bit (name/description). */
  public listToolDescriptors(): { name: string; description: string }[] {
    return Array.from(this.registeredTools.entries()).map(([name, { description }]) => ({ name, description }));
  }

  /** Introspection: descriptors of the MCP Resources registered on this Bit (uri/name/description). */
  public listResourceDescriptors(): { uri: string; name: string; description: string }[] {
    return Array.from(this.registeredResources.entries()).map(([uri, { name, description }]) => ({ uri, name, description }));
  }

  /** Introspection: read a registered MCP Resource body by uri (returns the ReadResourceResult). */
  public async readRegisteredResource(uri: string, extra?: any): Promise<ReadResourceResult> {
    const resource = this.registeredResources.get(uri);
    if (!resource) throw new Error(`Resource not found: ${uri}`);
    return resource.handler(uri, extra);
  }

  /**
   * Register a prompt.
   */
  public registerPrompt(
    name: string,
    description: string,
    args: { name: string; description?: string; required?: boolean }[],
    handler: (
      name: string,
      args: Record<string, string>,
      extra?: any
    ) => Promise<GetPromptResult>
  ) {
    this.registeredPrompts.set(name, { description, args, handler });
    this.mcpServer.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
      const prompt = this.registeredPrompts.get(request.params.name);
      if (!prompt) throw new Error(`Prompt not found: ${request.params.name}`);

      const meta = (request.params as any)._meta;
      const combinedExtra = {
        ...extra,
        userId: meta?.userId || extra?.requestInfo?.headers?.['x-user-id'] || extra?.requestInfo?.headers?.['x-bitbrat-user-id'],
        userRoles: meta?.userRoles || extra?.requestInfo?.headers?.['x-roles'] || extra?.requestInfo?.headers?.['x-bitbrat-roles']
      };

      return await this.traceMcpOperation(`prompt:${request.params.name}`, () =>
        prompt.handler(request.params.name, (request.params.arguments as Record<string, string>) || {}, combinedExtra)
      );
    });
    this.getLogger().info("mcp_server.prompt_registered", { name });
  }

  /**
   * Publish an MCP registration event to the internal message bus so the tool-gateway can
   * automatically discover this Bit. Runs on start when the control plane is enabled.
   */
  protected async publishRegistration() {
    const port = (this.getApp().locals as any).port ?? 3000;
    const defaultUrl = `http://${this.serviceName}.bitbrat.local:${port}/sse`;
    const externalUrl = process.env.MCP_EXTERNAL_URL || defaultUrl;

    // Read requiredRoles from architecture.yaml if present
    const arch = (this.constructor as any).loadArchitectureYaml?.() || undefined;
    const serviceConfig = arch?.services?.[this.serviceName];
    const requiredRoles = serviceConfig?.mcp?.requiredRoles;

    // Just-in-Time Context Provisioning (sprint-328): advertise this Bit's context packs + bindings
    // ADDITIVELY. Older consumers ignore unknown fields; the field is only present when non-empty so
    // a Bit with no packs produces a byte-for-byte unchanged payload (back-compat / envelope rules).
    const contextPacks = this.listContextPacks();
    const contextBindings = this.listContextBindings();
    const contextAdvertisement = (contextPacks.length > 0 || contextBindings.length > 0)
      ? { context: { packs: contextPacks, bindings: contextBindings } }
      : {};

    const registrationEvent = {
      v: '2',
      correlationId: `reg-${this.serviceName}-${Date.now()}`,
      type: INTERNAL_MCP_REGISTRATION_V1,
      payload: {
        name: this.serviceName,
        transport: 'sse',
        url: externalUrl,
        status: 'active',
        env: process.env.MCP_AUTH_TOKEN ? {
          Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}`
        } : {},
        ...(requiredRoles && { requiredRoles }),
        ...contextAdvertisement,
      },
      ingress: {
        ingressAt: new Date().toISOString(),
        source: this.serviceName,
        connector: 'system'
      },
      identity: {
        external: {
          id: this.serviceName,
          platform: 'system'
        }
      },
      egress: {
        destination: 'system',
        connector: 'system'
      },
      routing: {
        stage: 'meta',
        slip: [],
        history: []
      }
    };

    try {
      // Apply busPrefix to match subscriber expectations
      const prefix = this.config.busPrefix || '';
      const subject = `${prefix}${INTERNAL_MCP_REGISTRATION_V1}`;
      const pub = createMessagePublisher(subject);
      await pub.publishJson(registrationEvent, {
        source: this.serviceName,
        type: INTERNAL_MCP_REGISTRATION_V1
      });
      this.getLogger().info("mcp_server.registration.published", { url: externalUrl });
    } catch (error) {
      this.getLogger().error("mcp_server.registration.publish_failed", { error });
    }
  }

  private setupDiscoveryHandlers() {
    // tools/list
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Array.from(this.registeredTools.entries()).map(([name, { description, schema, scopes }]) => {
        const jsonSchema = zodToJsonSchema(schema);
        return {
          name,
          description,
          inputSchema: jsonSchema as any,
          scopes,
        };
      });
      return { tools };
    });

    // resources/list
    this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = Array.from(this.registeredResources.entries()).map(([uri, { name, description }]) => ({
        uri,
        name,
        description,
      }));
      return { resources };
    });

    // prompts/list
    this.mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = Array.from(this.registeredPrompts.entries()).map(([name, { description, args }]) => ({
        name,
        description,
        arguments: args,
      }));
      return { prompts };
    });
  }

  /**
   * Helper to wrap MCP operations in OpenTelemetry spans if available.
   */
  protected async traceMcpOperation<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const tracer = (this as any).getTracer?.();
    if (tracer && typeof tracer.startActiveSpan === "function") {
      return await tracer.startActiveSpan(
        `mcp.${operation}`,
        async (span: any) => {
          try {
            const result = await fn();
            return result;
          } catch (error) {
            span.recordException(error as Error);
            throw error;
          } finally {
            span.end();
          }
        }
      );
    }
    return await fn();
  }

  /**
   * Execute a registered tool by name with arguments.
   * Useful for internal calls and testing without going through SSE.
   */
  public async executeTool(name: string, args: any): Promise<CallToolResult> {
    const tool = this.registeredTools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    const validatedArgs = tool.schema.parse(args);
    return await this.traceMcpOperation(`tool:${name}`, () => tool.handler(validatedArgs));
  }

  private setupMcpRoutes() {
    const authMiddleware = (
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      const authToken = process.env.MCP_AUTH_TOKEN;
      if (authToken) {
        let providedToken = req.headers["x-mcp-token"] || req.query.token;

        // Also support Authorization: Bearer <token>
        const authHeader = req.headers["authorization"];
        if (!providedToken && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          providedToken = authHeader.substring(7);
        }

        if (providedToken !== authToken) {
          this.getLogger().warn("mcp_server.auth_failed", {
            path: req.path,
            ip: req.ip,
          });
          res.status(401).send("Unauthorized");
          return;
        }
      }
      next();
    };

    this.onHTTPRequest("/sse", (req: Request, res: Response) => {
      authMiddleware(req, res, async () => {
        this.getLogger().info("mcp_server.sse_connection_attempt", {
          sessionId: req.query.sessionId,
        });

        const transport = new SSEServerTransport("/message", res);
        this.transports.set(transport.sessionId, transport);

        transport.onclose = () => {
          this.getLogger().info("mcp_server.transport_closed", {
            sessionId: transport.sessionId,
          });
          this.transports.delete(transport.sessionId);
        };

        try {
          const sessionServer = await this.getMcpServerForConnection(req);
          await sessionServer.connect(transport);
          this.getLogger().info("mcp_server.connected", {
            sessionId: transport.sessionId,
          });
        } catch (error) {
          this.getLogger().error("mcp_server.connect_error", {
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            sessionId: transport.sessionId,
          });
          this.transports.delete(transport.sessionId);
          if (!res.headersSent) {
            res.status(500).send("Connection error");
          }
        }
      });
    });

    this.onHTTPRequest(
      { path: "/message", method: "POST" },
      (req: Request, res: Response) => {
        authMiddleware(req, res, async () => {
          const sessionId = req.query.sessionId as string;
          if (!sessionId) {
            if (!res.headersSent) {
              res.status(400).send("sessionId is required");
            }
            return;
          }

          const transport = this.transports.get(sessionId);
          if (transport) {
            try {
              await transport.handlePostMessage(req, res, req.body);
            } catch (error) {
              this.getLogger().error("mcp_server.message_handle_error", {
                error,
                sessionId,
              });
              if (!res.headersSent) {
                res.status(500).send("Error handling message");
              }
            }
          } else {
            this.getLogger().warn("mcp_server.session_not_found", { sessionId });
            if (!res.headersSent) {
              res.status(404).send("Session not found");
            }
          }
        });
      }
    );
  }
}

// Bit model (sprint-324, Phase 3 / BL-401): the deprecated `BaseServer` alias has been retired at the
// end of the migration window. All production and test code now extends/imports `Bit` directly. The
// `BaseServerOptions` constructor-options interface is retained as the canonical Bit options shape.
