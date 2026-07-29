import {
  buildResilientStorageOptions,
  createResilientFetch,
  StorageManager,
  NewStorageManager,
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

// Mock the storage factory
jest.mock('../storage/factory');
import { createStorageDriver } from '../storage/factory';
import type { IStorageDriver } from '../storage/types';
import type { SetupContext } from './types';

describe('NewStorageManager', () => {
  let mockDriver: jest.Mocked<IStorageDriver>;
  let mockContext: SetupContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock driver
    mockDriver = {
      name: 'mock-driver',
      initialize: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn(),
      download: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getMetadata: jest.fn(),
      list: jest.fn(),
      shutdown: jest.fn().mockResolvedValue(undefined),
    };

    // Create complete SetupContext mock
    mockContext = {
      config: {} as any,
      logger: { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
      serviceName: 'test-service',
      env: {},
      app: {} as any,
    };

    // Mock createStorageDriver to return our mock driver
    (createStorageDriver as jest.Mock).mockResolvedValue(mockDriver);
  });

  describe('setup()', () => {
    it('creates storage driver using factory', async () => {
      const manager = new NewStorageManager();

      const driver = await manager.setup(mockContext);

      expect(createStorageDriver).toHaveBeenCalledWith(process.env, mockContext.logger);
      expect(driver).toBe(mockDriver);
      expect(mockContext.logger.info).toHaveBeenCalledWith('storage.manager.setup');
      expect(mockContext.logger.info).toHaveBeenCalledWith('storage.manager.setup.complete', {
        driver: 'mock-driver',
      });
    });

    it('reuses the same driver instance on repeated setup', async () => {
      const manager = new NewStorageManager();

      const driver1 = await manager.setup(mockContext);
      const driver2 = await manager.setup(mockContext);
      const driver3 = await manager.setup(mockContext);

      expect(driver1).toBe(mockDriver);
      expect(driver2).toBe(mockDriver);
      expect(driver3).toBe(mockDriver);

      // Factory should only be called once
      expect(createStorageDriver).toHaveBeenCalledTimes(1);

      // Second call should log reuse
      expect(mockContext.logger.info).toHaveBeenCalledWith('storage.manager.setup.reuse');
    });

    it('uses global logger when ctx.logger is not provided', async () => {
      const manager = new NewStorageManager();
      const ctxWithoutLogger = {
        ...mockContext,
        logger: undefined as any,
      };

      const driver = await manager.setup(ctxWithoutLogger);

      expect(driver).toBe(mockDriver);
      expect(createStorageDriver).toHaveBeenCalledTimes(1);
    });

    it('handles missing context parameter', async () => {
      const manager = new NewStorageManager();

      const driver = await manager.setup(undefined as any);

      expect(driver).toBe(mockDriver);
      expect(createStorageDriver).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown()', () => {
    it('calls driver shutdown method', async () => {
      const manager = new NewStorageManager();

      await manager.shutdown(mockDriver);

      expect(mockDriver.shutdown).toHaveBeenCalledTimes(1);
    });

    it('can shutdown without prior setup', async () => {
      const manager = new NewStorageManager();
      const driver = {
        shutdown: jest.fn().mockResolvedValue(undefined),
      } as any;

      await manager.shutdown(driver);

      expect(driver.shutdown).toHaveBeenCalledTimes(1);
    });
  });

  describe('lifecycle integration', () => {
    it('supports full lifecycle: setup → shutdown', async () => {
      const manager = new NewStorageManager();

      // Setup
      const driver = await manager.setup(mockContext);
      expect(driver).toBe(mockDriver);

      // Shutdown
      await manager.shutdown(driver);
      expect(mockDriver.shutdown).toHaveBeenCalled();
    });

    it('propagates factory errors during setup', async () => {
      const manager = new NewStorageManager();

      const factoryError = new Error('Factory initialization failed');
      (createStorageDriver as jest.Mock).mockRejectedValueOnce(factoryError);

      await expect(manager.setup(mockContext)).rejects.toThrow('Factory initialization failed');
    });

    it('propagates driver errors during shutdown', async () => {
      const manager = new NewStorageManager();
      const driver = {
        shutdown: jest.fn().mockRejectedValue(new Error('Shutdown failed')),
      } as any;

      await expect(manager.shutdown(driver)).rejects.toThrow('Shutdown failed');
    });
  });
});
