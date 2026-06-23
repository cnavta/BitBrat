import { buildResilientStorageOptions, StorageManager } from './storage-manager';

const storageCtorArgs: any[] = [];
jest.mock('@google-cloud/storage', () => ({
  Storage: class {
    constructor(opts?: any) {
      storageCtorArgs.push(opts);
    }
  },
}));

describe('buildResilientStorageOptions', () => {
  it('injects the global fetch (undici) as the auth transporter fetchImplementation', () => {
    const opts = buildResilientStorageOptions();
    expect((opts.clientOptions as any).transporterOptions.fetchImplementation).toBe(
      (globalThis as any).fetch,
    );
  });

  it('preserves caller-provided clientOptions/transporterOptions', () => {
    const opts = buildResilientStorageOptions({
      projectId: 'p',
      clientOptions: { transporterOptions: { timeout: 1234 } as any } as any,
    });
    expect((opts as any).projectId).toBe('p');
    expect((opts.clientOptions as any).transporterOptions.timeout).toBe(1234);
    expect((opts.clientOptions as any).transporterOptions.fetchImplementation).toBe(
      (globalThis as any).fetch,
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
    expect(storageCtorArgs[0].clientOptions.transporterOptions.fetchImplementation).toBe(
      (globalThis as any).fetch,
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
