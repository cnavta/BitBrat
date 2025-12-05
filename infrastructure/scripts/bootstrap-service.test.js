const { toKebab, generateAppSource, generateTestSource, generateDockerfile, generateComposeSource } = require('./bootstrap-service.js');

describe('bootstrap-service generators', () => {
  test('toKebab normalizes names', () => {
    expect(toKebab('My New Service')).toBe('my-new-service');
    expect(toKebab('Auth_Service')).toBe('auth-service');
    expect(toKebab('  weird---Name__ ')).toBe('weird-name');
  });

  test('generateAppSource uses subclass pattern, explicit handlers, resource stubs, and env validation with server.start', () => {
    const src = generateAppSource('ingress-egress', ['/one', '/two', '/bar/:id', '/star/*']);
    expect(src).toContain("process.env.SERVICE_NAME || 'ingress-egress'");
    // Uses BaseServer subclass pattern
    expect(src).toContain("import { BaseServer } from '../common/base-server'");
    expect(src).toContain('class IngressEgressServer extends BaseServer');
    // Explicit app.get handlers for each path
    expect(src).toContain("app.get('/one'");
    expect(src).toContain("app.get('/two'");
    expect(src).toContain("app.get('/bar/:id'");
    expect(src).toContain("app.get('/star/*'");
    // Resource access comments present
    expect(src).toContain("this.getResource<any>('publisher')");
    expect(src).toContain("this.getResource<any>('firestore')");
    // No STUB_PATHS array anymore and no yaml imports in template
    expect(src).not.toContain('const STUB_PATHS');
    expect(src).not.toContain("import yaml from 'js-yaml'");
    // Should validate env via BaseServer helper and use server.start
    expect(src).toContain('BaseServer.ensureRequiredEnv');
    expect(src).toContain('server.start(PORT)');
    // Should not use app.listen anymore
    expect(src).not.toContain('app.listen(');
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
