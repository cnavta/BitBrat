/**
 * Business Logic: Gateway URL Resolution
 * Sprint 360: Extracted from cli/fleet.ts:358-400
 *
 * Resolves the tool-gateway base URL based on execution context.
 * Handles Sprint 349+ context integration.
 *
 * Priority:
 * 1. Explicit --url flag or TOOL_GATEWAY_URL env var
 * 2. ContextResolver (context.runtime.gateway.url)
 * 3. Legacy fallback logic (for backward compatibility)
 *
 * Used by:
 * - All 7 fleet commands (when not using --direct)
 * - FleetCommand base class
 */

import type { Logger } from '../orchestration/logger';
import { ContextResolver } from '../context/context-resolver';
import { getCurrentContext } from '../config/bratrc';

/**
 * Gateway URL resolution options
 */
export interface GatewayResolutionOptions {
  /**
   * Repository root directory
   */
  repoRoot: string;

  /**
   * Logger
   */
  logger: Logger;

  /**
   * Explicit gateway URL override (from --url flag)
   */
  explicitUrl?: string;

  /**
   * Execution context name (from --context flag)
   * Priority: flag > BITBRAT_CONTEXT > ~/.bratrc > 'local'
   */
  contextName?: string;

  /**
   * Whether this is a local Docker environment
   */
  isLocalDocker?: boolean;

  /**
   * Docker host/port resolver function (for local stacks)
   * @param service - Service name (e.g., 'tool-gateway')
   * @param containerPort - Internal container port
   * @returns Published host port
   */
  hostPortResolverFn?: (service: string, containerPort: number) => number;

  /**
   * Legacy emulator host (for backward compatibility)
   * @deprecated Use context-based resolution instead
   */
  legacyEmulatorHost?: string;
}

/**
 * Default gateway container port
 */
const GATEWAY_CONTAINER_PORT = 3000;

/**
 * Resolve the tool-gateway base URL
 *
 * This is the Sprint 349+ integration that determines gateway URL based on
 * execution context configuration.
 *
 * @param options - Resolution options
 * @returns Gateway base URL (without trailing slash)
 */
export async function resolveGatewayUrl(options: GatewayResolutionOptions): Promise<string> {
  const {
    repoRoot,
    logger,
    explicitUrl,
    contextName: contextNameOverride,
    isLocalDocker = false,
    hostPortResolverFn,
    legacyEmulatorHost,
  } = options;

  // Priority 1: Explicit override (--url flag or TOOL_GATEWAY_URL env var)
  const explicit = (explicitUrl || process.env.TOOL_GATEWAY_URL || '').trim();
  if (explicit) {
    logger.debug(
      { action: 'fleet.gateway.explicit', url: explicit },
      'Using explicit gateway URL'
    );
    return explicit.replace(/\/+$/, '');
  }

  // Priority 2: Use ContextResolver (Sprint 349+)
  try {
    const resolver = new ContextResolver(repoRoot);
    const contextName =
      contextNameOverride || process.env.BITBRAT_CONTEXT || getCurrentContext() || 'local';
    const context = await resolver.resolve(contextName);

    if (context.runtime.gateway.url) {
      logger.info(
        {
          action: 'fleet.gateway.resolved',
          context: contextName,
          url: context.runtime.gateway.url,
        },
        `Gateway URL resolved from context '${contextName}'`
      );
      return context.runtime.gateway.url.replace(/\/+$/, '');
    }
  } catch (err: any) {
    logger.debug(
      { action: 'fleet.gateway.fallback', error: err?.message },
      'Context resolution failed, using fallback'
    );
  }

  // Priority 3: Legacy fallback (DEPRECATED)
  return resolveLegacyGatewayUrl({
    isLocalDocker,
    hostPortResolverFn,
    legacyEmulatorHost,
    logger,
  });
}

/**
 * Legacy gateway URL resolution (backward compatibility)
 *
 * @deprecated Use context-based resolution instead
 */
function resolveLegacyGatewayUrl(options: {
  isLocalDocker: boolean;
  hostPortResolverFn?: (service: string, containerPort: number) => number;
  legacyEmulatorHost?: string;
  logger: Logger;
}): string {
  const { isLocalDocker, hostPortResolverFn, legacyEmulatorHost, logger } = options;

  // Local docker target: the gateway is reachable on its published host port (not the internal 3000).
  if (isLocalDocker && hostPortResolverFn) {
    const port = hostPortResolverFn('tool-gateway', GATEWAY_CONTAINER_PORT);
    const url = `http://localhost:${port}`;
    logger.info(
      { action: 'fleet.gateway.legacy', url, port },
      'Using legacy Docker port resolution for gateway'
    );
    return url;
  }

  // Emulator host fallback
  const emulatorHost = legacyEmulatorHost?.trim();
  if (emulatorHost) {
    const host = emulatorHost.split(':')[0] || 'localhost';
    const gwHost = host === '0.0.0.0' ? 'localhost' : host;
    const url = `http://${gwHost}:${GATEWAY_CONTAINER_PORT}`;
    logger.info(
      { action: 'fleet.gateway.legacy', url, emulatorHost },
      'Using emulator host for gateway URL'
    );
    return url;
  }

  // Final fallback: localhost:3000
  const url = `http://localhost:${GATEWAY_CONTAINER_PORT}`;
  logger.info({ action: 'fleet.gateway.fallback', url }, 'Using default gateway URL');
  return url;
}
