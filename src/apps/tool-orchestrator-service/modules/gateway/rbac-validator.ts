/**
 * RBAC Validator - Dual-Layer Validation (User × Model)
 * Sprint 58: Model-Based RBAC - Dual-Layer Validation & Context Propagation
 *
 * Implements 7-step validation algorithm:
 * 1. User required roles (must have ALL)
 * 2. User denied roles (must have NONE)
 * 3. Model required roles (must have ALL)
 * 4. Model denied roles (must have NONE)
 * 5. Model tier restrictions (allowed/denied tiers)
 * 6. Model tool policy (allowlist/denylist)
 * 7. Model trust thresholds (per dimension)
 */

import { ToolRegistryDocument } from '../types/tool-registry-document';
import { ModelRegistryDocument } from '../types/model-registry-document';

export interface RBACValidationResult {
  allowed: boolean;
  reason?: string;
  details?: string;
}

export class RbacValidator {
  /**
   * Validate tool access for a user and model (dual-layer RBAC)
   *
   * @param tool Tool to validate access for
   * @param userRoles Roles associated with the requesting user
   * @param model Model executing the tool
   * @returns Validation result with allowed flag and optional reason/details
   */
  validateToolAccess(
    tool: ToolRegistryDocument,
    userRoles: string[],
    model: ModelRegistryDocument
  ): RBACValidationResult {
    // Step 1: User required roles
    if (tool.rbac.userRoles.required.length > 0) {
      const hasAllRequiredRoles = tool.rbac.userRoles.required.every((role) =>
        userRoles.includes(role)
      );
      if (!hasAllRequiredRoles) {
        const missingRoles = tool.rbac.userRoles.required.filter(
          (role) => !userRoles.includes(role)
        );
        return {
          allowed: false,
          reason: 'user_missing_required_roles',
          details: `User missing required roles: ${missingRoles.join(', ')}`,
        };
      }
    }

    // Step 2: User denied roles
    if (tool.rbac.userRoles.denied.length > 0) {
      const hasDeniedRole = tool.rbac.userRoles.denied.some((role) =>
        userRoles.includes(role)
      );
      if (hasDeniedRole) {
        const deniedRoles = tool.rbac.userRoles.denied.filter((role) =>
          userRoles.includes(role)
        );
        return {
          allowed: false,
          reason: 'user_has_denied_role',
          details: `User has denied role(s): ${deniedRoles.join(', ')}`,
        };
      }
    }

    // Step 3: Model required roles
    if (tool.rbac.modelRoles.required.length > 0) {
      const hasAllRequiredRoles = tool.rbac.modelRoles.required.every((role) =>
        model.roles.includes(role)
      );
      if (!hasAllRequiredRoles) {
        const missingRoles = tool.rbac.modelRoles.required.filter(
          (role) => !model.roles.includes(role)
        );
        return {
          allowed: false,
          reason: 'model_missing_required_roles',
          details: `Model ${model.id} missing required roles: ${missingRoles.join(', ')}`,
        };
      }
    }

    // Step 4: Model denied roles
    if (tool.rbac.modelRoles.denied.length > 0) {
      const hasDeniedRole = tool.rbac.modelRoles.denied.some((role) =>
        model.roles.includes(role)
      );
      if (hasDeniedRole) {
        const deniedRoles = tool.rbac.modelRoles.denied.filter((role) =>
          model.roles.includes(role)
        );
        return {
          allowed: false,
          reason: 'model_has_denied_role',
          details: `Model ${model.id} has denied role(s): ${deniedRoles.join(', ')}`,
        };
      }
    }

    // Step 5: Model tier restrictions
    // Check allowed tiers (whitelist)
    if (tool.rbac.modelTiers.allowed.length > 0) {
      if (!tool.rbac.modelTiers.allowed.includes(model.tier)) {
        return {
          allowed: false,
          reason: 'model_tier_not_allowed',
          details: `Tool requires model tier: ${tool.rbac.modelTiers.allowed.join(' or ')}, but ${model.id} is tier ${model.tier}`,
        };
      }
    }

    // Check denied tiers (blacklist)
    if (tool.rbac.modelTiers.denied.includes(model.tier)) {
      return {
        allowed: false,
        reason: 'model_tier_denied',
        details: `Tool explicitly denies model tier: ${model.tier}`,
      };
    }

    // Step 6: Model tool policy (allowlist/denylist)
    // Check denylist first (takes precedence)
    if (model.toolPolicy.deniedTools.length > 0) {
      if (model.toolPolicy.deniedTools.includes(tool.id)) {
        return {
          allowed: false,
          reason: 'model_policy_denies_tool',
          details: `Model ${model.id} policy explicitly denies tool ${tool.id}`,
        };
      }
    }

    // Check allowlist (empty allowlist = allow all)
    if (model.toolPolicy.allowedTools.length > 0) {
      if (!model.toolPolicy.allowedTools.includes(tool.id)) {
        return {
          allowed: false,
          reason: 'model_policy_tool_not_in_allowlist',
          details: `Model ${model.id} policy does not allow tool ${tool.id} (not in allowlist)`,
        };
      }
    }

    // Step 7: Model trust thresholds (multi-dimensional)
    if (tool.rbac.minTrustThresholds) {
      const scope = tool.rbac.minTrustThresholds.scope || 'tool-use';

      // Find matching trust scope
      let modelTrust = model.trust.find((t) => t.scope === scope);

      // Fallback to 'general' scope if not found
      if (!modelTrust && scope !== 'general') {
        modelTrust = model.trust.find((t) => t.scope === 'general');
      }

      // No trust profile found
      if (!modelTrust) {
        return {
          allowed: false,
          reason: 'model_trust_scope_not_found',
          details: `Model ${model.id} has no trust profile for scope: ${scope} or 'general'`,
        };
      }

      // Check each trust dimension
      const thresholds = tool.rbac.minTrustThresholds;

      if (
        thresholds.reliability !== undefined &&
        modelTrust.scores.reliability < thresholds.reliability
      ) {
        return {
          allowed: false,
          reason: 'model_trust_insufficient',
          details: `Tool requires reliability >= ${thresholds.reliability}, but ${model.id} has ${modelTrust.scores.reliability} (scope: ${scope})`,
        };
      }

      if (
        thresholds.fidelity !== undefined &&
        modelTrust.scores.fidelity < thresholds.fidelity
      ) {
        return {
          allowed: false,
          reason: 'model_trust_insufficient',
          details: `Tool requires fidelity >= ${thresholds.fidelity}, but ${model.id} has ${modelTrust.scores.fidelity} (scope: ${scope})`,
        };
      }

      if (
        thresholds.integrity !== undefined &&
        modelTrust.scores.integrity < thresholds.integrity
      ) {
        return {
          allowed: false,
          reason: 'model_trust_insufficient',
          details: `Tool requires integrity >= ${thresholds.integrity}, but ${model.id} has ${modelTrust.scores.integrity} (scope: ${scope})`,
        };
      }

      if (
        thresholds.calibration !== undefined &&
        modelTrust.scores.calibration < thresholds.calibration
      ) {
        return {
          allowed: false,
          reason: 'model_trust_insufficient',
          details: `Tool requires calibration >= ${thresholds.calibration}, but ${model.id} has ${modelTrust.scores.calibration} (scope: ${scope})`,
        };
      }
    }

    // All validation steps passed
    return { allowed: true };
  }
}
