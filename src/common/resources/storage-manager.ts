import { Storage, type StorageOptions } from '@google-cloud/storage';
import type { ResourceManager, SetupContext } from './types';
import { logger as globalLogger } from '../logging';

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
        fetchImplementation: globalFetch,
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
