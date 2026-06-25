import {
  buildResilientStorageOptions,
  createResilientFetch,
  StorageManager,
} from './storage-manager';

const storageCtorArgs: any[] = [];
jest.mock('@google-cloud/storage', () => ({
  Storage: class {
    constructor(opts?: any) {
      storageCtorArgs.push(opts);
    }
  },
}));

describe('buildResilientStorageOptions', () => {
  it('injects a resilient fetch (undici wrapper) as the auth transporter fetchImplementation', () => {
    const opts = buildResilientStorageOptions();
    const impl = (opts.clientOptions as any).transporterOptions.fetchImplementation;
    expect(typeof impl).toBe('function');
    // It wraps, but is not the raw global fetch reference.
    expect(impl).not.toBe((globalThis as any).fetch);
  });

  it('preserves caller-provided clientOptions/transporterOptions', () => {
    const opts = buildResilientStorageOptions({
      projectId: 'p',
      clientOptions: { transporterOptions: { timeout: 1234 } as any } as any,
    });
    expect((opts as any).projectId).toBe('p');
    expect((opts.clientOptions as any).transporterOptions.timeout).toBe(1234);
    expect(typeof (opts.clientOptions as any).transporterOptions.fetchImplementation).toBe(
      'function',
    );
  });

  it('leaves options untouched when no global fetch is available', () => {
    const original = (globalThis as any).fetch;
    try {
      (globalThis as any).fetch = undefined;
      const opts = buildResilientStorageOptions({ projectId: 'p' });
      expect((opts as any).projectId).toBe('p');
      expect(opts.clientOptions).toBeUndefined();
    } finally {
      (globalThis as any).fetch = original;
    }
  });
});

describe('StorageManager', () => {
  beforeEach(() => {
    storageCtorArgs.length = 0;
  });

  it('constructs the Storage client with the undici fetch transporter override', async () => {
    const mgr = new StorageManager();
    await mgr.setup({} as any);
    expect(storageCtorArgs).toHaveLength(1);
    expect(typeof storageCtorArgs[0].clientOptions.transporterOptions.fetchImplementation).toBe(
      'function',
    );
  });

  it('reuses the same Storage instance on repeated setup', async () => {
    const mgr = new StorageManager();
    const a = await mgr.setup({} as any);
    const b = await mgr.setup({} as any);
    expect(a).toBe(b);
    expect(storageCtorArgs).toHaveLength(1);
  });
});

describe('createResilientFetch', () => {
  it('adds duplex:half when the request body is a Node Readable stream', async () => {
    const calls: any[] = [];
    const fakeFetch = ((input: any, init?: any) => {
      calls.push({ input, init });
      return Promise.resolve('ok');
    }) as unknown as typeof fetch;

    const wrapped = createResilientFetch(fakeFetch);
    const body = { pipe() {} }; // looks like a Node Readable
    await wrapped('https://example.com/upload', { method: 'POST', body } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0].init.duplex).toBe('half');
    expect(calls[0].init.body).toBe(body);
  });

  it('adds duplex:half for async-iterable and web ReadableStream bodies', async () => {
    const calls: any[] = [];
    const fakeFetch = ((input: any, init?: any) => {
      calls.push(init);
      return Promise.resolve('ok');
    }) as unknown as typeof fetch;
    const wrapped = createResilientFetch(fakeFetch);

    await wrapped('u', { body: { getReader() {} } } as any);
    await wrapped('u', { body: { [Symbol.asyncIterator]() {} } } as any);

    expect(calls[0].duplex).toBe('half');
    expect(calls[1].duplex).toBe('half');
  });

  it('does not add duplex for string/Buffer/Uint8Array bodies', async () => {
    const calls: any[] = [];
    const fakeFetch = ((input: any, init?: any) => {
      calls.push(init);
      return Promise.resolve('ok');
    }) as unknown as typeof fetch;
    const wrapped = createResilientFetch(fakeFetch);

    await wrapped('u', { body: 'token=abc' } as any);
    await wrapped('u', { body: Buffer.from('x') } as any);
    await wrapped('u', { body: new Uint8Array([1, 2, 3]) } as any);

    expect(calls[0].duplex).toBeUndefined();
    expect(calls[1].duplex).toBeUndefined();
    expect(calls[2].duplex).toBeUndefined();
  });

  it('preserves a caller-provided duplex and passes through bodyless requests', async () => {
    const calls: any[] = [];
    const fakeFetch = ((input: any, init?: any) => {
      calls.push(init);
      return Promise.resolve('ok');
    }) as unknown as typeof fetch;
    const wrapped = createResilientFetch(fakeFetch);

    await wrapped('u', { body: { pipe() {} }, duplex: 'full' } as any);
    await wrapped('u', { method: 'GET' } as any);

    expect(calls[0].duplex).toBe('full');
    expect(calls[1].duplex).toBeUndefined();
  });
});
