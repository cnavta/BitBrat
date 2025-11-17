import express, { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export type ExpressSetup = (app: Express) => void;

export interface BaseServerOptions {
  serviceName?: string;
  setup?: ExpressSetup;
  healthPaths?: string[]; // override default health paths if provided
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

  constructor(opts: BaseServerOptions = {}) {
    this.app = express();
    this.serviceName = opts.serviceName || process.env.SERVICE_NAME || 'service';

    this.registerHealth(opts.healthPaths);

    if (typeof opts.setup === 'function') {
      opts.setup(this.app);
    }
  }

  /** Returns the underlying Express app instance */
  getApp(): Express {
    return this.app;
  }

  /** Starts the HTTP server on the given port and optional host */
  async start(port: number, host = '0.0.0.0'): Promise<void> {
    await new Promise<void>((resolve) => {
      this.app.listen(port, host, () => resolve());
    });
    // eslint-disable-next-line no-console
    console.log(`[${this.serviceName}] listening on ${host}:${port}`);
  }

  private buildHealthBody() {
    return {
      status: 'ok',
      service: this.serviceName,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    };
  }

  private registerHealth(healthPaths?: string[]) {
    const [health, ready, live] = healthPaths && healthPaths.length >= 3
      ? healthPaths
      : ['/healthz', '/readyz', '/livez'];

    this.app.get(health, (_req: Request, res: Response) => {
      res.status(200).json(this.buildHealthBody());
    });
    this.app.get(ready, (_req: Request, res: Response) => {
      res.status(200).json(this.buildHealthBody());
    });
    this.app.get(live, (_req: Request, res: Response) => {
      res.status(200).json(this.buildHealthBody());
    });

    // Root route for quick sanity
    this.app.get('/', (_req: Request, res: Response) => {
      res.status(200).json({ message: `${this.serviceName} up`, ...this.buildHealthBody() });
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
