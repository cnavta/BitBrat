const { toKebab, generateAppSource, generateTestSource, generateDockerfile, generateComposeSource } = require('./bootstrap-service.js');

describe('bootstrap-service generators', () => {
  test('toKebab normalizes names', () => {
    expect(toKebab('My New Service')).toBe('my-new-service');
    expect(toKebab('Auth_Service')).toBe('auth-service');
    expect(toKebab('  weird---Name__ ')).toBe('weird-name');
  });

  test('generateAppSource includes BaseServer import, explicit path handlers, and env validation hook', () => {
    const src = generateAppSource('ingress-egress', ['/one', '/two', '/bar/:id', '/star/*']);
    expect(src).toContain("process.env.SERVICE_NAME || 'ingress-egress'");
    // Uses BaseServer wrapper
    expect(src).toContain("import { BaseServer } from '../common/base-server'");
    expect(src).toContain('setup: (app: Express) =>');
    // Explicit app.get handlers for each path
    expect(src).toContain("app.get('/one'");
    expect(src).toContain("app.get('/two'");
    expect(src).toContain("app.get('/bar/:id'");
    expect(src).toContain("app.get('/star/*'");
    // No STUB_PATHS array anymore and no yaml imports in template
    expect(src).not.toContain('const STUB_PATHS');
    expect(src).not.toContain("import yaml from 'js-yaml'");
    // Should validate env via BaseServer helper
    expect(src).toContain('BaseServer.ensureRequiredEnv');
  });

  test('generateTestSource references entry module and emits stub path tests', () => {
    const testSrc = generateTestSource('src/apps/ingress-egress-service.ts', ['/one', '/two', '/bar/:id', '/star/*']);
    expect(testSrc).toContain("import { createApp } from './ingress-egress-service'");
    expect(testSrc).toContain("/healthz");
    // Tests for explicit handlers
    expect(testSrc).toContain("stub /one -> 200");
    expect(testSrc).toContain("stub /two -> 200");
    // Parameter and wildcard paths transformed to concrete URLs
    expect(testSrc).toContain("await request(app).get('/bar/123').expect(200)");
    expect(testSrc).toContain("await request(app).get('/star/test').expect(200)");
  });

  test('generateDockerfile uses service name and entry path', () => {
    const df = generateDockerfile('ingress-egress', 'src/apps/ingress-egress-service.ts');
    expect(df).toContain('ENV SERVICE_NAME=ingress-egress');
    expect(df).toContain('CMD ["node", "dist/apps/ingress-egress-service.js"]');
  });

  test('generateComposeSource emits per-service compose with Dockerfile and port var', () => {
    const y = generateComposeSource('ingress-egress');
    expect(y).toContain('services:');
    expect(y).toContain('ingress-egress:');
    expect(y).toContain('dockerfile: Dockerfile.ingress-egress');
    expect(y).toContain('${INGRESS_EGRESS_HOST_PORT:-3001}');
  });
});
