import * as api from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';

let provider: NodeTracerProvider | null = null;
let contextManager: AsyncHooksContextManager | null = null;
let initialized = false;

function parseBool(val: string | undefined, fallback = false): boolean {
  if (val == null) return fallback;
  const v = String(val).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function parseRatio(val: string | undefined, fallback = 0.1): number {
  const n = Number(val);
  if (!isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

export function initializeTracing(serviceName = process.env.SERVICE_NAME || 'service'): void {
  if (initialized) return;
  const enabled = parseBool(process.env.TRACING_ENABLED, false);
  if (!enabled) {
    initialized = true; // mark checked to avoid repeated work
    return;
  }
  const ratio = parseRatio(process.env.TRACING_SAMPLER_RATIO, 0.1);

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
  });

  provider = new NodeTracerProvider({
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
    resource,
  });

  const exporter = new TraceExporter();
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  contextManager = new AsyncHooksContextManager().enable();
  api.context.setGlobalContextManager(contextManager);
  initialized = true;
}

export function shutdownTracing(): Promise<void> {
  return new Promise((resolve) => {
    Promise.resolve()
      .then(async () => {
        if (provider) {
          await provider.shutdown();
        }
      })
      .finally(() => {
        if (contextManager) contextManager.disable();
        provider = null;
        contextManager = null;
        initialized = false;
        resolve();
      });
  });
}

export function getTracer(): api.Tracer | undefined {
  // If tracing was not initialized due to disabled flag, return undefined
  if (!initialized) return undefined;
  return api.trace.getTracer('bitbrat-platform');
}

export function getLogCorrelationFields(): Record<string, string | boolean> | undefined {
  try {
    const span = api.trace.getActiveSpan();
    if (!span) return undefined;
    const spanCtx = span.spanContext();
    if (!spanCtx || !api.isSpanContextValid(spanCtx)) return undefined;
    const pid = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GCP_PROJECT_ID;
    if (!pid) return undefined;
    return {
      'logging.googleapis.com/trace': `projects/${pid}/traces/${spanCtx.traceId}`,
      'logging.googleapis.com/spanId': spanCtx.spanId,
      'logging.googleapis.com/trace_sampled': spanCtx.traceFlags === api.TraceFlags.SAMPLED,
    } as any;
  } catch {
    return undefined;
  }
}

export function startActiveSpan<T>(name: string, fn: (span: api.Span) => Promise<T> | T): Promise<T> | T {
  const tracer = getTracer();
  if (!tracer) return fn({ end() {} } as any);
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } finally {
      span.end();
    }
  });
}

export { api };
