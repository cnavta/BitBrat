import { BaseServer } from '../../src/common/base-server';
import type { ResourceManager, SetupContext } from '../../src/common/resources/types';

function makeMgr(name: string, calls: string[], out: any): ResourceManager<any> {
  return {
    setup: (ctx: SetupContext) => {
      calls.push(`setup:${name}`);
      return { tag: name, ctx };
    },
    shutdown: async (_inst: any) => {
      calls.push(`shutdown:${name}`);
    },
  };
}

describe('BaseServer resource lifecycle', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, LOG_LEVEL: 'error' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('initializes provided resources and exposes them via third arg and app.locals', async () => {
    const calls: string[] = [];
    const mgrA = makeMgr('a', calls, {});
    const mgrB = makeMgr('b', calls, {});
    let gotResources: any = null;
    const server = new BaseServer({
      serviceName: 'test-svc',
      resources: { a: mgrA, b: mgrB },
      setup: (_app, _cfg, resources) => {
        gotResources = resources;
      },
    });
    const app = server.getApp() as any;
    expect(app.locals.resources).toBeDefined();
    // Setup is synchronous for our managers; resources should be present
    expect(Object.keys(app.locals.resources)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(Object.keys(gotResources || {})).toEqual(expect.arrayContaining(['a', 'b']));
    // setup should have been called for both managers
    expect(calls.filter((c) => c.startsWith('setup:')).sort()).toEqual(['setup:a', 'setup:b']);
  });

  it('shuts down resources in reverse order on SIGTERM and isolates errors', async () => {
    const calls: string[] = [];
    const mgr1: ResourceManager<any> = {
      setup: () => ({ tag: '1' }),
      shutdown: async () => {
        calls.push('shutdown:1');
      },
    };
    const mgr2: ResourceManager<any> = {
      setup: () => ({ tag: '2' }),
      shutdown: async () => {
        calls.push('shutdown:2');
        throw new Error('boom');
      },
    };
    const server = new BaseServer({ serviceName: 'svc', resources: { one: mgr1, two: mgr2 } });
    // Emit SIGTERM to trigger shutdown handler
    process.emit('SIGTERM' as any);
    // Allow microtask queue to drain
    await new Promise((r) => setTimeout(r, 0));
    // Expect reverse order: two then one
    expect(calls).toEqual(['shutdown:2', 'shutdown:1']);
  });
});
