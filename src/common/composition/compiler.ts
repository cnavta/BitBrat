/**
 * Composition Compiler
 *
 * Validates compositions, resolves tool dependencies, detects circular
 * dependencies, and produces compiled form with content hash.
 *
 * @module composition/compiler
 * @version 1.0.0
 * @see technical-architecture.md §4.3
 */

import { createHash } from 'crypto';
import {
  CompositionDefinition,
  CompiledComposition,
  ValidationReport,
  ValidationError,
  ValidationWarning,
  ToolDependency,
  CompositionErrorCode,
  Step,
  ValueExpression,
  Reference,
  isReference,
  isCallStep,
} from './types';

/**
 * Tool Registry Interface
 *
 * Minimal interface for tool resolution during compilation
 */
export interface ToolRegistryInterface {
  /**
   * Get tool by logical ID
   */
  getTool(toolId: string): {
    id: string;
    inputSchema?: unknown;
    source?: string;
  } | null;
}

/**
 * Composition Compiler
 *
 * Validates composition definitions and produces compiled form.
 * Performs:
 * - Tool dependency resolution
 * - Circular dependency detection (DFS algorithm)
 * - Reference validation
 * - Content hash computation (SHA-256)
 *
 * @example
 * ```typescript
 * const compiler = new CompositionCompiler(toolRegistry);
 * const compiled = compiler.compile(definition);
 * ```
 */
export class CompositionCompiler {
  constructor(private registry: ToolRegistryInterface) {}

  /**
   * Compile a composition definition
   *
   * @param def - Parsed composition definition
   * @returns Compiled composition with validation metadata
   * @throws Error if validation fails
   */
  compile(def: CompositionDefinition): CompiledComposition {
    // Validate composition
    const report = this.validate(def);

    if (!report.valid) {
      const errorList = report.errors
        .map((e) => `  ${e.code}: ${e.message}${e.location ? ` (at ${e.location})` : ''}`)
        .join('\n');

      throw new Error(
        `Composition validation failed:\n${errorList}`
      );
    }

    // Resolve dependencies
    const dependencies = this.resolveDependencies(def);

    // Compute content hash
    const contentHash = this.computeHash(def);

    return {
      id: '', // Will be assigned by registry
      metadata: {
        ...def.metadata,
        version: def.metadata.version || 1,
      },
      spec: def.spec,
      compiledAt: new Date(),
      contentHash,
      dependencies,
      validationReport: report,
    };
  }

  /**
   * Validate composition
   *
   * Performs comprehensive validation:
   * 1. Tool resolution (all tools exist)
   * 2. Cycle detection (no circular dependencies)
   * 3. Reference validation (all step IDs valid)
   *
   * @param def - Composition definition to validate
   * @returns Validation report
   */
  validate(def: CompositionDefinition): ValidationReport {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Validate tool dependencies
    const toolIds = this.extractToolIds(def);
    for (const toolId of toolIds) {
      // Sprint 41: Use findTool() to handle both canonical and MCP-prefixed lookups
      const tool = this.findTool(toolId);
      if (!tool) {
        // Sprint 41: Enhanced error messages with actionable suggestions
        let message = `Tool not found: ${toolId}`;

        // Check if tool ID has mcp_ prefix (common mistake)
        if (toolId.startsWith('mcp_')) {
          const canonicalId = toolId.slice(4);
          const canonicalTool = this.findTool(canonicalId);
          if (canonicalTool) {
            message = `Tool not found: ${toolId} (found as '${canonicalId}'). Use canonical tool ID without 'mcp_' prefix.`;
          } else {
            message = `Tool not found: ${toolId}. Remove 'mcp_' prefix and use 'composition.list_tools' to discover available tools.`;
          }
        } else {
          message = `Tool not found: ${toolId}. Use 'composition.list_tools' to see all available tools.`;
        }

        errors.push({
          code: CompositionErrorCode.TOOL_NOT_FOUND,
          message,
          location: `steps[?].call`,
        });
      }

      // Sprint 41: Warn about mcp_ prefix even if tool exists (shouldn't happen, but defensive)
      if (toolId.startsWith('mcp_') && tool) {
        warnings.push({
          code: 'COMPOSE-WARN-001',
          message: `Tool ID '${toolId}' uses 'mcp_' prefix. Consider using canonical ID without prefix for consistency.`,
          location: `steps[?].call`,
        });
      }
    }

    // 2. Detect circular dependencies
    const cycles = this.detectCycles(def);
    if (cycles.length > 0) {
      errors.push({
        code: CompositionErrorCode.CIRCULAR_DEPENDENCY,
        message: `Circular dependency detected: ${cycles.join(' → ')}`,
      });
    }

    // 3. Validate references
    const refErrors = this.validateReferences(def);
    errors.push(...refErrors);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Normalize tool lookup to handle both canonical and MCP-prefixed names
   *
   * Sprint 41: Compositions use canonical IDs (get_state), but registry may have
   * MCP-prefixed names (mcp_get_state, mcp:get_state). Try all variations.
   *
   * @param toolId - Canonical or prefixed tool ID
   * @returns Tool if found, null otherwise
   */
  private findTool(toolId: string): { id: string; inputSchema?: unknown; source?: string } | null {
    // 1. Try exact match (canonical or already prefixed)
    let tool = this.registry.getTool(toolId);
    if (tool) return tool;

    // 2. If canonical ID, try with mcp_ prefix
    if (!toolId.startsWith('mcp_') && !toolId.startsWith('mcp:')) {
      tool = this.registry.getTool(`mcp_${toolId}`);
      if (tool) return tool;

      // 3. Try with mcp: prefix
      tool = this.registry.getTool(`mcp:${toolId}`);
      if (tool) return tool;
    }

    // 4. If starts with mcp_, try removing it (defensive)
    if (toolId.startsWith('mcp_')) {
      const canonical = toolId.slice(4);
      tool = this.registry.getTool(canonical);
      if (tool) return tool;
    }

    // 5. If starts with mcp:, try removing it (defensive)
    if (toolId.startsWith('mcp:')) {
      const canonical = toolId.slice(4);
      tool = this.registry.getTool(canonical);
      if (tool) return tool;
    }

    return null;
  }

  /**
   * Extract all tool IDs from composition
   */
  private extractToolIds(def: CompositionDefinition): string[] {
    const toolIds: string[] = [];

    for (const step of def.spec.steps) {
      if (isCallStep(step)) {
        toolIds.push(step.call);
      }
    }

    return toolIds;
  }

  /**
   * Detect circular dependencies using DFS
   *
   * Builds a dependency graph and uses depth-first search to detect cycles.
   * A cycle exists if a composition calls itself directly or indirectly.
   *
   * @returns Array representing cycle path, or empty if no cycle
   */
  private detectCycles(def: CompositionDefinition): string[] {
    // Build dependency graph
    const graph: Map<string, string[]> = new Map();
    graph.set(def.metadata.name, []);

    for (const step of def.spec.steps) {
      if (isCallStep(step)) {
        // Sprint 41: Use findTool() to handle canonical IDs
        const tool = this.findTool(step.call);

        // If tool is a composition, add edge
        if (tool && tool.source === 'composition') {
          const deps = graph.get(def.metadata.name) || [];
          deps.push(step.call);
          graph.set(def.metadata.name, deps);
        }
      }
    }

    // DFS cycle detection
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cyclePath: string[] = [];

    const dfs = (node: string): boolean => {
      // Cycle detected
      if (recursionStack.has(node)) {
        cyclePath.push(node);
        return true;
      }

      // Already visited (no cycle from this node)
      if (visited.has(node)) {
        return false;
      }

      visited.add(node);
      recursionStack.add(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (dfs(neighbor)) {
          cyclePath.push(node);
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    if (dfs(def.metadata.name)) {
      cyclePath.reverse();
      return cyclePath;
    }

    return [];
  }

  /**
   * Validate all references in composition
   *
   * Ensures:
   * - All $steps references point to valid step IDs
   * - No forward references (step references step defined later)
   * - All references use valid namespaces
   */
  private validateReferences(def: CompositionDefinition): ValidationError[] {
    const errors: ValidationError[] = [];
    const stepIds = new Set(def.spec.steps.map((s) => s.id));

    // Check for duplicate step IDs
    const seenIds = new Set<string>();
    for (const step of def.spec.steps) {
      if (seenIds.has(step.id)) {
        errors.push({
          code: CompositionErrorCode.UNDEFINED_REFERENCE,
          message: `Duplicate step ID: ${step.id}`,
          location: `steps`,
        });
      }
      seenIds.add(step.id);
    }

    // Validate references in steps
    for (let i = 0; i < def.spec.steps.length; i++) {
      const step = def.spec.steps[i];
      const availableSteps = new Set(
        def.spec.steps.slice(0, i).map((s) => s.id)
      );

      const stepErrors = this.validateStepReferences(
        step,
        availableSteps,
        `steps[${i}]`
      );
      errors.push(...stepErrors);
    }

    // Validate references in return expression
    const returnErrors = this.validateValueReferences(
      def.spec.return,
      stepIds,
      'return'
    );
    errors.push(...returnErrors);

    return errors;
  }

  /**
   * Validate references within a step
   */
  private validateStepReferences(
    step: Step,
    availableSteps: Set<string>,
    location: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (isCallStep(step)) {
      // Validate references in 'with' arguments
      if (step.with) {
        for (const [key, value] of Object.entries(step.with)) {
          const valueErrors = this.validateValueReferences(
            value,
            availableSteps,
            `${location}.with.${key}`
          );
          errors.push(...valueErrors);
        }
      }

      // Validate references in 'when' condition
      if (step.when) {
        const whenErrors = this.validateConditionReferences(
          step.when,
          availableSteps,
          `${location}.when`
        );
        errors.push(...whenErrors);
      }
    } else {
      // IfValueStep
      const condErrors = this.validateConditionReferences(
        step.if.condition,
        availableSteps,
        `${location}.if.condition`
      );
      errors.push(...condErrors);

      const thenErrors = this.validateValueReferences(
        step.if.then,
        availableSteps,
        `${location}.if.then`
      );
      errors.push(...thenErrors);

      const elseErrors = this.validateValueReferences(
        step.if.else,
        availableSteps,
        `${location}.if.else`
      );
      errors.push(...elseErrors);
    }

    return errors;
  }

  /**
   * Validate references in a value expression
   */
  private validateValueReferences(
    value: ValueExpression,
    availableSteps: Set<string>,
    location: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (isReference(value)) {
      // Validate $steps references
      if (value.$ref.namespace === 'steps') {
        const stepId = value.$ref.pointer.split('/')[1]; // "/stepId/..." → "stepId"
        if (stepId && !availableSteps.has(stepId)) {
          errors.push({
            code: CompositionErrorCode.UNDEFINED_REFERENCE,
            message: `Reference to undefined or forward step: ${stepId}`,
            location,
          });
        }
      }
    } else if (Array.isArray(value)) {
      // Validate array elements
      value.forEach((item, index) => {
        const itemErrors = this.validateValueReferences(
          item,
          availableSteps,
          `${location}[${index}]`
        );
        errors.push(...itemErrors);
      });
    } else if (value && typeof value === 'object') {
      // Validate object values
      for (const [key, val] of Object.entries(value)) {
        const valErrors = this.validateValueReferences(
          val,
          availableSteps,
          `${location}.${key}`
        );
        errors.push(...valErrors);
      }
    }

    return errors;
  }

  /**
   * Validate references in a condition
   */
  private validateConditionReferences(
    condition: unknown,
    availableSteps: Set<string>,
    location: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const cond = condition as Record<string, unknown>;

    if (cond.exists) {
      const existsErrors = this.validateValueReferences(
        cond.exists as ValueExpression,
        availableSteps,
        `${location}.exists`
      );
      errors.push(...existsErrors);
    }

    if (cond.equals && Array.isArray(cond.equals)) {
      cond.equals.forEach((val, index) => {
        const valErrors = this.validateValueReferences(
          val as ValueExpression,
          availableSteps,
          `${location}.equals[${index}]`
        );
        errors.push(...valErrors);
      });
    }

    if (cond.greaterThan && Array.isArray(cond.greaterThan)) {
      cond.greaterThan.forEach((val, index) => {
        const valErrors = this.validateValueReferences(
          val as ValueExpression,
          availableSteps,
          `${location}.greaterThan[${index}]`
        );
        errors.push(...valErrors);
      });
    }

    if (cond.lessThan && Array.isArray(cond.lessThan)) {
      cond.lessThan.forEach((val, index) => {
        const valErrors = this.validateValueReferences(
          val as ValueExpression,
          availableSteps,
          `${location}.lessThan[${index}]`
        );
        errors.push(...valErrors);
      });
    }

    if (cond.greaterThanOrEqual && Array.isArray(cond.greaterThanOrEqual)) {
      cond.greaterThanOrEqual.forEach((val, index) => {
        const valErrors = this.validateValueReferences(
          val as ValueExpression,
          availableSteps,
          `${location}.greaterThanOrEqual[${index}]`
        );
        errors.push(...valErrors);
      });
    }

    if (cond.lessThanOrEqual && Array.isArray(cond.lessThanOrEqual)) {
      cond.lessThanOrEqual.forEach((val, index) => {
        const valErrors = this.validateValueReferences(
          val as ValueExpression,
          availableSteps,
          `${location}.lessThanOrEqual[${index}]`
        );
        errors.push(...valErrors);
      });
    }

    if (cond.all && Array.isArray(cond.all)) {
      cond.all.forEach((subCond, index) => {
        const subErrors = this.validateConditionReferences(
          subCond,
          availableSteps,
          `${location}.all[${index}]`
        );
        errors.push(...subErrors);
      });
    }

    if (cond.any && Array.isArray(cond.any)) {
      cond.any.forEach((subCond, index) => {
        const subErrors = this.validateConditionReferences(
          subCond,
          availableSteps,
          `${location}.any[${index}]`
        );
        errors.push(...subErrors);
      });
    }

    if (cond.not) {
      const notErrors = this.validateConditionReferences(
        cond.not,
        availableSteps,
        `${location}.not`
      );
      errors.push(...notErrors);
    }

    return errors;
  }

  /**
   * Resolve tool dependencies
   *
   * Builds list of ToolDependency records with schema fingerprints
   */
  private resolveDependencies(def: CompositionDefinition): ToolDependency[] {
    const toolIds = this.extractToolIds(def);
    const dependencies: ToolDependency[] = [];

    for (const toolId of toolIds) {
      // Sprint 41: Use findTool() to handle canonical IDs
      const tool = this.findTool(toolId);
      if (tool) {
        dependencies.push({
          toolId,
          schemaFingerprint: this.hashSchema(tool.inputSchema || {}),
        });
      }
    }

    return dependencies;
  }

  /**
   * Compute content hash for composition
   *
   * Uses SHA-256 of canonical JSON for content-addressable storage
   *
   * @returns Hex-encoded SHA-256 hash
   */
  private computeHash(def: CompositionDefinition): string {
    // Create canonical representation (deterministic JSON with sorted keys)
    const canonical = this.canonicalStringify(def);
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Compute schema fingerprint
   *
   * @returns Hex-encoded SHA-256 hash of schema
   */
  private hashSchema(schema: unknown): string {
    const canonical = this.canonicalStringify(schema);
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Create canonical JSON string with sorted keys (recursively)
   */
  private canonicalStringify(obj: unknown): string {
    return JSON.stringify(obj, (key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Sort object keys
        const sortedKeys = Object.keys(value).sort();
        const sorted: Record<string, unknown> = {};
        for (const k of sortedKeys) {
          sorted[k] = (value as Record<string, unknown>)[k];
        }
        return sorted;
      }
      return value;
    });
  }
}
