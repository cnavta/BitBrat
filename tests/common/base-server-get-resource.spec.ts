import { BaseServer } from '../../src/common/base-server';
import type { ResourceManager, SetupContext } from '../../src/common/resources/types';

class TestServer extends BaseServer {
  public peek<T>(name: string): T | undefined {
    // Access protected getResource via a public test-only wrapper
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return this.getResource<T>(name);
  }
}

function makeMgr<T>(value: T): ResourceManager<T> {
  return {
    setup: (_ctx: SetupContext) => value,
    shutdown: async (_inst: T) => {},
  };
}

describe('BaseServer.getResource<T>()', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, LOG_LEVEL: 'error' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns a typed resource instance when present', () => {
    const foo = { hello: 'world', n: 1 };
    const server = new TestServer({ serviceName: 'svc', resources: { foo: makeMgr(foo) } });
    const got = server.peek<typeof foo>('foo');
    expect(got).toBeDefined();
    expect(got).toBe(foo);
    expect(got!.hello).toBe('world');
  });

  it('returns undefined for missing or empty names', () => {
    const server = new TestServer({ serviceName: 'svc', resources: {} as any });
    expect(server.peek<any>('does-not-exist')).toBeUndefined();
    expect(server.peek<any>('')).toBeUndefined();
  });
});
