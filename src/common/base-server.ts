import express, { Express, Request, Response, RequestHandler } from 'express';
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
import type { ResourceManager, ResourceInstances, SetupContext } from './resources/types';
import { PublisherManager } from './resources/publisher-manager';
import { FirestoreManager } from './resources/firestore-manager';
import { createMessageSubscriber, createMessagePublisher, type AttributeMap } from '../services/message-bus';
import type { MessageHandler, SubscribeOptions, UnsubscribeFn } from '../services/message-bus';
import { initializeTracing, shutdownTracing, getTracer, startActiveSpan } from './tracing';
import type { InternalEventV2, RoutingStep } from '../types/events';
import type { RoutingStatus } from '../types/events';
import { markSelectedCandidate } from './events/selection';

export type ExpressSetup = (app: Express, cfg: IConfig, resources?: ResourceInstances) => void | Promise<void>;

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
}

/**
 * BaseServer
 * - Wraps Express application creation
 * - Automatically registers health endpoints (/healthz, /readyz, /livez) and root
 * - Accepts an optional setup(app) function to customize routes/middleware
 * - Provides helpers to read architecture.yaml and validate required env
 */
export class BaseServer {
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
        const Ctor = this.constructor as typeof BaseServer;
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
    await new Promise<void>((resolve) => {
      this.app.listen(port, host, () => resolve());
    });
    this.logger.info('listening', { host, port });
  }

  /**
   * Public, idempotent shutdown to release resources and unsubscribe from message bus.
   * Safe to call multiple times.
   */
  public async close(reason: string = 'manual'): Promise<void> {
    if (this.shutdownBound) return; // idempotent
    this.shutdownBound = true;
    this.logger.info('base_server.shutdown.start', { reason });
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
      // Ensure req.body is parsed if it's a POST/PUT/PATCH and body-parser isn't globally active
      // or if it was already parsed, use it.
      // BaseServer usually handles this via express.json() in initializeExpress, but let's be safe.
      handler(req, res, next);
    });
  }

  /**
   * Subscribe to a message destination (topic/subject) using the message-bus abstraction.
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
    try {
      const unsubscribe = await subscriber.subscribe(
        subject,
        async (data, attributes, ctx) => {
          try {
            const tracer = this.getTracer();
            if (tracer) {
              await startActiveSpan(`msg ${subject}`, async () => {
                // Assume JSON payloads: parse Buffer/string into object for typed handler
                const parsed = JSON.parse((data as any)?.toString('utf8')) as T;
                await Promise.resolve(handler(parsed, attributes, ctx));
              });
            } else {
              const parsed = JSON.parse((data as any)?.toString('utf8')) as T;
              await Promise.resolve(handler(parsed, attributes, ctx));
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
    const [health, ready, live] = healthPaths && healthPaths.length >= 3
      ? healthPaths
      : ['/healthz', '/readyz', '/livez'];

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
        const requiredEnv = BaseServer.computeRequiredKeysFromArchitecture(this.serviceName);
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
      console.error('[BaseServer] Failed to read architecture.yaml:', e?.message || e);
    }
    return null;
  }

  /**
   * Computes required environment variable keys for a given service
   * from architecture.yaml: union(defaults.services.env, service.env, service.secrets)
   */
  static computeRequiredKeysFromArchitecture(serviceName?: string): string[] {
    const svc = serviceName || process.env.SERVICE_NAME || 'service';
    const arch = BaseServer.loadArchitectureYaml();
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

    const required = BaseServer
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

    const slip: RoutingStep[] = Array.isArray(event.routingSlip) ? (event.routingSlip as RoutingStep[]) : [];
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
        await startActiveSpan('routing.complete', async () => {
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
        await pub.publishJson(event, this.buildRoutingAttributes(event, step));
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
    const slip: RoutingStep[] = Array.isArray((event as any).routingSlip) ? ((event as any).routingSlip as RoutingStep[]) : [];
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
}
