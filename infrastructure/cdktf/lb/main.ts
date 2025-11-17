/**
 * CDKTF Load Balancer Stack — Placeholder
 *
 * This file documents the intended CDKTF entrypoint for the Load Balancer module.
 * Implementation will be added in a future sprint. For Sprint 8, the brat CLI
 * synthesizes a minimal Terraform project under infrastructure/cdktf/out/load-balancer.
 */

export interface LoadBalancerConfig {
  projectId?: string;
  region?: string;
}

export function synthLoadBalancer(_config: LoadBalancerConfig = {}): void {
  // Intentionally empty placeholder. Real CDKTF code will go here later.
}
