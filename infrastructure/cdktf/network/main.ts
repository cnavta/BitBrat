/**
 * CDKTF Network Stack — Placeholder
 *
 * This file documents the intended CDKTF entrypoint for the Network module.
 * Implementation will be added in a future sprint. For Sprint 8, the brat CLI
 * synthesizes a minimal Terraform project under infrastructure/cdktf/out/network.
 */

export interface NetworkConfig {
  projectId?: string;
  region?: string;
}

export function synthNetwork(_config: NetworkConfig = {}): void {
  // Intentionally empty placeholder. Real CDKTF code will go here later.
}
