import { Logger } from '../logging';
import { initializeTracing, shutdownTracing, startActiveSpan } from '../tracing';

describe('Logger -> Cloud Logging trace correlation fields', () => {
  const originalLog = console.log;
  const OLD_ENV = process.env;

  beforeEach(() => {
    (process as any).env = { ...OLD_ENV, TRACING_ENABLED: '1', TRACING_SAMPLER_RATIO: '1', GOOGLE_CLOUD_PROJECT: 'dummy-proj' };
  });

  afterEach(async () => {
    console.log = originalLog;
    (process as any).env = OLD_ENV;
    try { await shutdownTracing(); } catch {}
  });

  it('emits logging.googleapis.com/trace fields when inside an active span', async () => {
    initializeTracing('trace-corr-test');
    Logger.setServiceName('trace-corr-test');
    const logger = new Logger('info');
    let line = '';
    console.log = (s: any) => { line = String(s); };

    await startActiveSpan('unit-test-span', async () => {
      logger.info('hello');
    });

    expect(line).toBeTruthy();
    const obj = JSON.parse(line);
    expect(obj['logging.googleapis.com/trace']).toBeDefined();
    expect(obj['logging.googleapis.com/spanId']).toBeDefined();
    expect(obj['logging.googleapis.com/trace']).toContain('projects/dummy-proj/traces/');
  });
});
