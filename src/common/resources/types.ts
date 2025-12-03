import type { Express } from 'express';
import type { IConfig } from '../../types';
import type { Logger } from '../logging';

export interface SetupContext {
  config: IConfig;
  logger: Logger;
  serviceName: string;
  env: Record<string, string | undefined>;
  app: Express;
}

export interface ResourceManager<T> {
  /** Initialize the resource and return an instance ready for use. */
  setup(ctx: SetupContext): T | Promise<T>;
  /** Shutdown/cleanup the resource. Must be safe to call once. */
  shutdown(instance: T): void | Promise<void>;
}

/** Map of realized resource instances keyed by resource name. */
export type ResourceInstances = Record<string, any>;
