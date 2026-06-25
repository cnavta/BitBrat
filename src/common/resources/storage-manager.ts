import { Storage, type StorageOptions } from '@google-cloud/storage';
import type { ResourceManager, SetupContext } from './types';
import { logger as globalLogger } from '../logging';

/**
 * Detects a streaming request body (a Node `Readable`, web `ReadableStream`, or async
 * iterable). `gaxios` sends both simple stream uploads and multipart uploads with a
 * `PassThrough` stream as the request `body`, while token requests use string/Buffer bodies.
 */
function isStreamingBody(body: unknown): boolean {
  if (!body || typeof body === 'string') return false;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return false;
  if (body instanceof Uint8Array) return false;
  const b = body as any;
  // Node Readable streams expose `.pipe`; web ReadableStream exposes `.getReader`;
  // any other async iterable is also treated as a stream.
  return (
    typeof b.pipe === 'function' ||
    typeof b.getReader === 'function' ||
    typeof b[Symbol.asyncIterator] === 'function'
  );
}

/**
 * Wraps the Node global `fetch` (undici) so that requests carrying a *streaming* body always
 * pass `duplex: 'half'`.
 *
 * Why: `gaxios@6` (used by `@google-cloud/storage`) calls `fetchImplementation(url, opts)`
 * without ever setting `duplex`. `node-fetch` ignores that field, but undici's WHATWG `fetch`
 * *requires* `duplex: 'half'` whenever the request body is a stream. A simple (`resumable:false`)
 * GCS upload streams the image bytes through a `PassThrough`, so undici rejects the request and
 * destroys that stream — which surfaces on the storage side as
 * "Cannot call write after a stream was destroyed" (`ERR_STREAM_DESTROYED`) and a hard
 * image-persistence failure. Injecting `duplex: 'half'` lets undici accept the streamed upload,
 * while non-streaming token requests are passed through unchanged.
 */
export function createResilientFetch(globalFetch: typeof fetch): typeof fetch {
  const wrapped = (input: any, init?: any) => {
    if (init && init.body !== undefined && init.duplex === undefined && isStreamingBody(init.body)) {
      init = { ...init, duplex: 'half' };
    }
    return globalFetch(input, init);
  };
  return wrapped as typeof fetch;
}

/**
 * Builds the Storage client options that force the Google auth transport to use Node's
 * built-in global `fetch` (undici) instead of the bundled `node-fetch`.
 *
 * Why: `@google-cloud/storage` (via `google-auth-library` -> `gaxios@6`) mints OAuth2 access
 * tokens with `node-fetch`. On recent Node runtimes that path intermittently fails with
 * `ERR_STREAM_PREMATURE_CLOSE` / "Invalid response body while trying to fetch
 * https://www.googleapis.com/oauth2/v4/token: Premature close" on pooled keep-alive sockets,
 * which surfaces as a hard image-persistence failure (and is not reliably fixed by retries).
 * Node's global `fetch` (undici) hits the exact same endpoint successfully.
 *
 * `gaxios` honors a per-instance `fetchImplementation`, and `google-auth-library` applies
 * `transporterOptions` as the gaxios defaults for the auth client, so providing it here routes
 * the token fetch through undici. Storage still applies its own default scopes/endpoint.
 *
 * The fetch is wrapped via {@link createResilientFetch} so that streamed (`resumable:false`)
 * uploads include the `duplex: 'half'` flag undici requires for streaming request bodies.
 */
export function buildResilientStorageOptions(base: StorageOptions = {}): StorageOptions {
  const globalFetch = (globalThis as any).fetch;
  if (typeof globalFetch !== 'function') {
    // Extremely old runtime without a global fetch; leave defaults untouched.
    return base;
  }
  return {
    ...base,
    clientOptions: {
      ...base.clientOptions,
      transporterOptions: {
        ...(base.clientOptions as any)?.transporterOptions,
        fetchImplementation: createResilientFetch(globalFetch),
      },
    } as any,
  };
}

export class StorageManager implements ResourceManager<Storage> {
  private storage: Storage | null = null;

  async setup(ctx: SetupContext): Promise<Storage> {
    const log = ctx?.logger || globalLogger;
    if (this.storage) {
      log.info('storage.manager.setup.reuse');
      return this.storage;
    }

    log.info('storage.manager.setup');
    this.storage = new Storage(buildResilientStorageOptions());
    return this.storage;
  }

  async shutdown(_instance: Storage): Promise<void> {
    // Storage client doesn't require explicit shutdown
  }
}
