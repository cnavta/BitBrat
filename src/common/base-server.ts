import express, { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { IConfig } from '../types';
import { buildConfig, safeConfig } from './config';
import { Logger } from './logging';

export type ExpressSetup = (app: Express, cfg: IConfig) => void;

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
}

/**
 * BaseServer
 * - Wraps Express application creation
 * - Automatically registers health endpoints (/healthz, /readyz, /livez) and root
 * - Accepts an optional setup(app) function to customize routes/middleware
 * - Provides helpers to read architecture.yaml and validate required env
 */
export class BaseServer {
  private readonly app: Express;
  private readonly serviceName: string;
  private readonly config: IConfig;
  private readonly logger: Logger;

  constructor(opts: BaseServerOptions = {}) {
    this.app = express();
    this.serviceName = opts.serviceName || process.env.SERVICE_NAME || 'service';

    // Build typed config once for the server lifetime
    this.config = buildConfig(process.env, opts.configOverrides || {});
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

    this.registerHealth(opts.healthPaths, opts.readinessCheck);

    if (typeof opts.setup === 'function') {
      opts.setup(this.app, this.config);
    }
  }

  /** Returns the underlying Express app instance */
  getApp(): Express {
    return this.app;
  }

  /** Returns the server's config */
  getConfig(): IConfig {
    return this.config;
  }

  /** Returns the server's service-scoped logger */
  public getLogger(): Logger {
    return this.logger;
  }

  /** Starts the HTTP server on the given port and optional host */
  async start(port: number, host = '0.0.0.0'): Promise<void> {
    await new Promise<void>((resolve) => {
      this.app.listen(port, host, () => resolve());
    });
    this.logger.info('listening', { host, port });
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
   */
  static ensureRequiredEnv(serviceName?: string): void {
    const required = BaseServer.computeRequiredKeysFromArchitecture(serviceName);
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
}
