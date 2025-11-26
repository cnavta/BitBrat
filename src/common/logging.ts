import { LogLevel } from '../types';

/**
 * Redact secrets from log context objects. Keys that look sensitive (key|token|secret|password|authorization|cookie|auth)
 * are masked. For strings that look like secrets (e.g., start with sk- or sk_), mask even if key not matched.
 * This function returns a new object and does not mutate the input.
 */
export function redactSecrets<T>(input: T): T {
  const SENSITIVE_KEY = /(key|token|secret|password|authorization|cookie|auth)/i;

  const maskString = (s: string): string => {
    if (!s) return '***';
    // Preserve a small prefix and last 4 chars when reasonably long
    const last = s.slice(-4);
    const prefix = s.startsWith('sk-') || s.startsWith('sk_') ? s.slice(0, 3) : s.slice(0, Math.min(2, Math.max(0, s.length - 4)));
    // Ensure we don't leak the middle
    if (s.length <= 6) return '***';
    return `${prefix}***${last}`;
  };

  const looksLikeSecret = (v: string): boolean => {
    if (!v) return false;
    if (v.startsWith('sk-') || v.startsWith('sk_')) return true; // OpenAI style
    if (/^ya29\.[A-Za-z0-9\-_]+$/.test(v)) return true; // Google OAuth tokens (rough)
    if (/^Bearer\s+[A-Za-z0-9\-_.~+/=]{20,}$/i.test(v)) return true;
    if (/^[A-Za-z0-9]{24,}$/.test(v)) return true; // long opaque tokens
    return false;
  };

  const isPlainObject = (o: any) => o && typeof o === 'object' && !Array.isArray(o);

  const redactAny = (value: any, keyPath: string[] = []): any => {
    if (value == null) return value;
    if (typeof value === 'string') {
      const key = keyPath[keyPath.length - 1] || '';
      if (SENSITIVE_KEY.test(key) || looksLikeSecret(value)) return maskString(value);
      return value;
    }
    if (Array.isArray(value)) return value.map((v, idx) => redactAny(v, [...keyPath, String(idx)]));
    if (isPlainObject(value)) {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_KEY.test(k)) {
          if (typeof v === 'string') out[k] = maskString(v);
          else if (v && typeof v === 'object') out[k] = redactAny(v, [...keyPath, k]);
          else out[k] = '***';
        } else {
          out[k] = redactAny(v, [...keyPath, k]);
        }
      }
      return out as any;
    }
    return value;
  };

  return redactAny(input);
}

/**
 * Simple structured logger that writes to stdout/stderr.
 * Logs objects with keys: ts, level, msg, and optional context.
 */
export class Logger {
  private levelOrder: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  // Global/static service name shared across all logger instances
  private static serviceName = 'bitbrat';

  static setServiceName(name: string) {
    if (name && typeof name === 'string') {
      Logger.serviceName = name;
    }
  }

  static getServiceName(): string {
    return Logger.serviceName;
  }

  constructor(private level: LogLevel = 'info') {}

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private shouldLog(level: LogLevel) {
    return this.levelOrder[level] <= this.levelOrder[this.level];
  }

  private base(entry: Record<string, unknown>) {
    return {
      ts: new Date().toISOString(),
      service: Logger.getServiceName(),
      ...entry,
    };
  }

  private sanitize(context?: Record<string, unknown>) {
    if (!context) return undefined;
    try {
      return redactSecrets(context);
    } catch {
      // Fail-closed: if redaction fails, drop context to avoid accidental leaks
      return undefined;
    }
  }

  private severityOf(level: LogLevel): 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG' {
    switch (level) {
      case 'error': return 'ERROR';
      case 'warn': return 'WARNING';
      case 'info': return 'INFO';
      case 'debug': return 'DEBUG';
      default: return 'INFO';
    }
  }

  error(msg: string, context?: Record<string, unknown>) {
    if (!this.shouldLog('error')) return;
    console.error(JSON.stringify(this.base({ level: 'error', severity: this.severityOf('error'), msg, ...(this.sanitize(context) || {}) })));
  }

  warn(msg: string, context?: Record<string, unknown>) {
    if (!this.shouldLog('warn')) return;
    console.warn(JSON.stringify(this.base({ level: 'warn', severity: this.severityOf('warn'), msg, ...(this.sanitize(context) || {}) })));
  }

  info(msg: string, context?: Record<string, unknown>) {
    if (!this.shouldLog('info')) return;
    console.log(JSON.stringify(this.base({ level: 'info', severity: this.severityOf('info'), msg, ...(this.sanitize(context) || {}) })));
  }

  debug(msg: string, context?: Record<string, unknown>) {
    if (!this.shouldLog('debug')) return;
    console.debug(JSON.stringify(this.base({ level: 'debug', severity: this.severityOf('debug'), msg, ...(this.sanitize(context) || {}) })));
  }
}

export const logger = new Logger(process.env.LOG_LEVEL as LogLevel || 'info');
