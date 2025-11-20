import { BaseServer } from './base-server';

describe('BaseServer logger provisioning', () => {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  beforeEach(() => {
    // Silence noise from other tests if any
    console.warn = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  });

  it('exposes a service-scoped logger via app.locals and getLogger()', () => {
    const server = new BaseServer({ serviceName: 'test-svc', configOverrides: { port: 0, logLevel: 'debug' } });
    const app: any = server.getApp();
    expect(app.locals).toBeDefined();
    expect(app.locals.logger).toBeDefined();
    expect(server.getLogger()).toBe(app.locals.logger);
  });

  it('logger prints JSON with service name and redacts sensitive context', () => {
    const server = new BaseServer({ serviceName: 'test-svc', configOverrides: { port: 0, logLevel: 'debug' } });
    const logs: string[] = [];
    console.log = jest.fn((...args: any[]) => logs.push(String(args[0])));

    // Emit an info log with a secret-looking field
    server.getLogger().info('hello', { apiKey: 'sk-test-abc1234567890' });

    expect(logs.length).toBeGreaterThan(0);
    const entry = JSON.parse(logs[0]);
    expect(entry.service).toBe('test-svc');
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello');
    // Ensure redaction occurred (no raw secret value)
    expect(entry.apiKey).toMatch(/\*\*\*/);
    expect(entry.apiKey).not.toContain('sk-test-abc1234567890');
  });
});
