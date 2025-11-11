import pino from 'pino';

export interface LoggerOptions {
  level?: string;
  pretty?: boolean;
  base?: Record<string, any>;
}

export function createLogger(opts: LoggerOptions = {}) {
  const level = opts.level || process.env.LOG_LEVEL || 'info';
  const pretty = opts.pretty ?? (process.env.NODE_ENV !== 'production');
  const base = opts.base || {};
  if (pretty) {
    try {
      // Prefer pretty transport in dev if available
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('pino-pretty');
      // pino automatically resolves the target by name
      // @ts-ignore
      return pino({ level, base, transport: { target: 'pino-pretty', options: { colorize: true } } });
    } catch {
      return pino({ level, base });
    }
  }
  return pino({ level, base });
}

export type Logger = ReturnType<typeof createLogger>;
