import type { Bit } from '../base-server';

/**
 * Bit model (sprint-324, Phase 2): a capability profile.
 *
 * Profiles are mixins/decorators over {@link Bit} — composition, not inheritance (ADR-002). A profile
 * is installed per Bit instance at bootstrap (after the MCP control plane is initialized) and may:
 *  - register bit.* / domain MCP tools,
 *  - attach capability state and helper methods onto the Bit,
 *  - register startup/shutdown lifecycle hooks (Bit.onStartup / Bit.onShutdown).
 *
 * A profile MUST be idempotent enough to be safe to install once per instance; it must not deepen the
 * class hierarchy.
 */
export interface BitProfile {
  /**
   * Stable capability id. Used to (a) de-duplicate profiles applied to a class + its ancestors and
   * (b) enforce the architecture.yaml `profile:` -> mixin contract. Examples: 'eventing', 'resources',
   * 'mcp-client', 'llm'.
   */
  readonly name: string;

  /** Install the capability onto a single Bit instance. */
  install(bit: Bit): void;
}
