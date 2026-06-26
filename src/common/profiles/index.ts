// Bit model (sprint-324, Phase 2): capability profiles (composition over inheritance, ADR-002).
//
// A Bit composes profiles via applyProfiles(<Class>, [...]); each profile is a mixin/decorator over
// Bit (no new inheritance depth). The declared architecture.yaml `profile:` is enforced against the
// applied mixins at Bit bootstrap so declared intent cannot diverge from runtime capability.

export type { BitProfile } from './types';
export {
  applyProfiles,
  collectProfiles,
  enforceProfileContract,
  PROFILE_REQUIREMENTS,
} from './registry';

export { EventingProfile } from './eventing-profile';
export { ResourcesProfile } from './resources-profile';
export { McpClientProfile } from './mcp-client-profile';
export type { McpClientCapability, McpClientProfileOptions } from './mcp-client-profile';
export { LlmProfile } from './llm-profile';
export type { LlmCapability, LlmConfigKnobs } from './llm-profile';
