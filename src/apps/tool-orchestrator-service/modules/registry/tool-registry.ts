/**
 * Tool Registry Module
 * Persistent PostgreSQL-backed tool storage with RBAC and health tracking
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

import { IDocumentStore, QueryFilter } from '../../../../common/persistence/interfaces';
import { Logger } from 'pino';
import {
  ToolRegistryDocument,
  ToolQueryFilters,
  HealthStatus,
  ToolSourceMetadata,
} from '../types';
import {
  IToolRegistry,
  McpToolDefinition,
  BitBratTool,
} from './interfaces';
import { randomUUID } from 'crypto';
import { Step, CallStep, isCallStep, CompositionDefinition } from '../../../../common/composition/types';
import { IModelRegistry } from '../models/interfaces';
import { RbacValidator } from '../gateway/rbac-validator';

const COLLECTION_NAME = 'platform_tool_registry';

/**
 * ToolRegistry implementation using PostgreSQL DocumentStore
 */
export class ToolRegistry implements IToolRegistry {
  constructor(
    private readonly store: IDocumentStore,
    private readonly logger: Logger,
    private readonly modelRegistry?: IModelRegistry,
    private readonly rbacValidator?: RbacValidator
  ) {}

  /**
   * Register a new tool in the registry
   */
  async registerTool(tool: ToolRegistryDocument): Promise<void> {
    this.logger.debug({ toolId: tool.id, source: tool.source }, 'tool_registry.register_tool');

    // Check for duplicates before registering
    const duplicates = await this.findDuplicates(tool);
    if (duplicates.length > 0) {
      this.logger.warn({
        toolId: tool.id,
        canonicalName: tool.canonicalName,
        existingTools: duplicates.map((t) => t.id),
      }, 'tool_registry.duplicate_detected');
      throw new Error(
        `Tool with canonical name "${tool.canonicalName}" already exists. Use resolveConflict() to merge.`
      );
    }

    await this.store.set(COLLECTION_NAME, tool.id, tool);

    this.logger.info({
      toolId: tool.id,
      canonicalName: tool.canonicalName,
      source: tool.source,
    }, 'tool_registry.tool_registered');
  }

  /**
   * Get a tool by ID
   */
  async getTool(id: string): Promise<ToolRegistryDocument | null> {
    this.logger.debug({ toolId: id }, 'tool_registry.get_tool');
    return await this.store.get<ToolRegistryDocument>(COLLECTION_NAME, id);
  }

  /**
   * Query tools with filters
   */
  async queryTools(filters: ToolQueryFilters): Promise<ToolRegistryDocument[]> {
    this.logger.debug({ filters }, 'tool_registry.query_tools');

    const queryFilters: QueryFilter[] = [];

    if (filters.source && filters.source.length > 0) {
      queryFilters.push({
        field: 'source',
        operator: 'in',
        value: filters.source,
      });
    }

    if (filters.status && filters.status.length > 0) {
      queryFilters.push({
        field: 'status',
        operator: 'in',
        value: filters.status,
      });
    }

    if (filters.category) {
      queryFilters.push({
        field: 'category',
        operator: '==',
        value: filters.category,
      });
    }

    if (filters.tags && filters.tags.length > 0) {
      for (const tag of filters.tags) {
        queryFilters.push({
          field: 'tags',
          operator: 'array-contains',
          value: tag,
        });
      }
    }

    const tools = await this.store.query<ToolRegistryDocument>(COLLECTION_NAME, {
      filters: queryFilters.length > 0 ? queryFilters : undefined,
    });

    // Apply RBAC filtering if requested (post-query filtering for complex JSONB queries)
    let filteredTools = tools;
    if (filters.rbacFilter) {
      filteredTools = this.applyRbacFilter(tools, filters.rbacFilter);
    }

    this.logger.debug({
      totalFound: tools.length,
      afterRbacFilter: filteredTools.length,
    }, 'tool_registry.query_tools_result');

    return filteredTools;
  }

  /**
   * Update a tool's metadata
   */
  async updateTool(
    id: string,
    updates: Partial<ToolRegistryDocument>
  ): Promise<void> {
    this.logger.debug({ toolId: id, updates }, 'tool_registry.update_tool');

    const existing = await this.getTool(id);
    if (!existing) {
      throw new Error(`Tool not found: ${id}`);
    }

    // Update timestamp
    updates.lastUpdatedAt = new Date();

    await this.store.set(COLLECTION_NAME, id, updates, true); // merge=true

    this.logger.info({ toolId: id }, 'tool_registry.tool_updated');
  }

  /**
   * Delete a tool from the registry
   */
  async deleteTool(id: string): Promise<void> {
    this.logger.debug({ toolId: id }, 'tool_registry.delete_tool');
    await this.store.delete(COLLECTION_NAME, id);
    this.logger.info({ toolId: id }, 'tool_registry.tool_deleted');
  }

  /**
   * Find duplicate tools by canonical name
   */
  async findDuplicates(tool: ToolRegistryDocument): Promise<ToolRegistryDocument[]> {
    const allTools = await this.store.getAll<ToolRegistryDocument>(COLLECTION_NAME);
    return allTools.filter(
      (t) => t.canonicalName === tool.canonicalName && t.id !== tool.id
    );
  }

  /**
   * Resolve duplicate conflict by selecting preferred source
   */
  async resolveConflict(toolId: string, preferredSource: string): Promise<void> {
    this.logger.info({
      toolId,
      preferredSource,
    }, 'tool_registry.resolve_conflict');

    const tool = await this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    // Find duplicates
    const duplicates = await this.findDuplicates(tool);

    // Delete tools from non-preferred sources
    for (const duplicate of duplicates) {
      if (duplicate.source !== preferredSource) {
        await this.deleteTool(duplicate.id);
        this.logger.info({
          deletedToolId: duplicate.id,
          deletedSource: duplicate.source,
        }, 'tool_registry.conflict_resolved_deleted');
      }
    }

    // If current tool is not from preferred source, also delete it
    if (tool.source !== preferredSource) {
      await this.deleteTool(tool.id);
      this.logger.info({
        deletedToolId: tool.id,
        deletedSource: tool.source,
      }, 'tool_registry.conflict_resolved_deleted_original');
    }
  }

  /**
   * Update tool health status
   */
  async updateHealth(
    toolId: string,
    health: {
      status: HealthStatus;
      lastError?: string;
      lastInvocationAt?: string;
      lastSuccessAt?: string;
      lastErrorAt?: string;
    }
  ): Promise<void> {
    this.logger.debug({ toolId, health }, 'tool_registry.update_health');

    const tool = await this.getTool(toolId);
    if (!tool) {
      this.logger.warn({ toolId }, 'tool_registry.update_health_tool_not_found');
      return;
    }

    await this.updateTool(toolId, {
      health: {
        status: health.status,
        lastError: health.lastError,
        lastErrorAt: health.lastErrorAt ? new Date(health.lastErrorAt) : undefined,
        lastInvocationAt: health.lastInvocationAt
          ? new Date(health.lastInvocationAt)
          : undefined,
        lastSuccessAt: health.lastSuccessAt
          ? new Date(health.lastSuccessAt)
          : undefined,
        consecutiveFailures:
          health.status === 'healthy'
            ? 0
            : (tool.health.consecutiveFailures || 0) + 1,
      },
      lastHealthCheckAt: new Date(),
    });

    this.logger.info({
      toolId,
      status: health.status,
    }, 'tool_registry.health_updated');
  }

  /**
   * Import tools from MCP server
   */
  async importFromMcp(
    serverName: string,
    tools: McpToolDefinition[]
  ): Promise<string[]> {
    this.logger.info({
      serverName,
      toolCount: tools.length,
    }, 'tool_registry.import_from_mcp');

    const importedIds: string[] = [];

    for (const mcpTool of tools) {
      const toolDoc: ToolRegistryDocument = {
        id: `mcp.${serverName}.${mcpTool.name}`,
        canonicalName: mcpTool.name,
        description: mcpTool.description,
        source: 'mcp',
        sourceMetadata: {
          mcpServer: { name: serverName },
        },
        inputSchema: mcpTool.inputSchema,
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
        config: {
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
        },
        health: { status: 'healthy' },
        status: 'active',
        tags: ['mcp', serverName],
        relatedTools: [],
        importedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      try {
        // Check if tool already exists
        const existing = await this.getTool(toolDoc.id);
        if (existing) {
          // Update existing tool
          await this.updateTool(toolDoc.id, {
            description: toolDoc.description,
            inputSchema: toolDoc.inputSchema,
            lastUpdatedAt: new Date(),
          });
          this.logger.debug({
            toolId: toolDoc.id,
          }, 'tool_registry.import_mcp_updated');
        } else {
          // Register new tool
          await this.store.set(COLLECTION_NAME, toolDoc.id, toolDoc);
          this.logger.debug({
            toolId: toolDoc.id,
          }, 'tool_registry.import_mcp_registered');
        }
        importedIds.push(toolDoc.id);
      } catch (err) {
        this.logger.error({
          toolId: toolDoc.id,
          error: err instanceof Error ? err.message : String(err),
        }, 'tool_registry.import_mcp_failed');
      }
    }

    this.logger.info({
      serverName,
      imported: importedIds.length,
      total: tools.length,
    }, 'tool_registry.import_from_mcp_complete');

    return importedIds;
  }

  /**
   * Import tools from Bit service (tool-gateway)
   */
  async importFromBit(bitName: string, tools: BitBratTool[]): Promise<string[]> {
    this.logger.info({
      bitName,
      toolCount: tools.length,
    }, 'tool_registry.import_from_bit');

    const importedIds: string[] = [];

    for (const bitTool of tools) {
      const sourceMetadata: ToolSourceMetadata =
        bitTool.source === 'mcp' && bitTool.originServer
          ? { mcpServer: { name: bitTool.originServer } }
          : { bit: { name: bitName } };

      const toolDoc: ToolRegistryDocument = {
        id: bitTool.id,
        canonicalName: bitTool.displayName || bitTool.id,
        description: bitTool.description || '',
        source: bitTool.source,
        sourceMetadata,
        inputSchema: bitTool.inputSchema,
        rbac: {
          userRoles: {
            required: bitTool.requiredRoles || [],
            denied: [],
          },
          modelRoles: { required: [], denied: [] }, // Populated in Sprint 58
          modelTiers: { allowed: [], denied: [] },
        },
        config: {
          timeoutMs: 30000,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
        },
        health: { status: 'healthy' },
        status: 'active',
        tags: bitTool.scopes || [],
        category: bitTool.category || 'general',
        relatedTools: [],
        importedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      try {
        // Check if tool already exists
        const existing = await this.getTool(toolDoc.id);
        if (existing) {
          // Update existing tool, preserve RBAC metadata
          await this.updateTool(toolDoc.id, {
            description: toolDoc.description,
            source: toolDoc.source,
            sourceMetadata: toolDoc.sourceMetadata,
            inputSchema: toolDoc.inputSchema,
            category: toolDoc.category,
            tags: toolDoc.tags,
            lastUpdatedAt: new Date(),
          });
          this.logger.debug({
            toolId: toolDoc.id,
          }, 'tool_registry.import_bit_updated');
        } else {
          // Register new tool
          await this.store.set(COLLECTION_NAME, toolDoc.id, toolDoc);
          this.logger.debug({
            toolId: toolDoc.id,
          }, 'tool_registry.import_bit_registered');
        }
        importedIds.push(toolDoc.id);
      } catch (err) {
        this.logger.error({
          toolId: toolDoc.id,
          error: err instanceof Error ? err.message : String(err),
        }, 'tool_registry.import_bit_failed');
      }
    }

    this.logger.info({
      bitName,
      imported: importedIds.length,
      total: tools.length,
    }, 'tool_registry.import_from_bit_complete');

    return importedIds;
  }

  /**
   * Register a composition with RBAC validation
   *
   * Sprint 61: Composition RBAC + Validation (T1.2)
   *
   * Validates that the registering model has access to ALL constituent tools
   * before storing the composition. This prevents users from creating compositions
   * that escalate privileges or access tools they shouldn't.
   *
   * @param definition - Composition definition to register
   * @param registeringModelId - ID of the model registering the composition
   * @param userRoles - Roles of the user registering the composition
   * @throws Error if model lacks access to any constituent tool
   * @throws Error if modelRegistry or rbacValidator not available
   *
   * @example
   * ```typescript
   * await toolRegistry.registerComposition(
   *   compositionDef,
   *   'gpt-4',
   *   ['user', 'admin']
   * );
   * ```
   */
  async registerComposition(
    definition: CompositionDefinition,
    registeringModelId: string,
    userRoles: string[]
  ): Promise<void> {
    // Validate dependencies are available
    if (!this.modelRegistry || !this.rbacValidator) {
      throw new Error(
        'ToolRegistry not configured for composition RBAC validation. ' +
        'ModelRegistry and RbacValidator required.'
      );
    }

    const compositionId = definition.metadata.name;

    this.logger.info({
      compositionId,
      registeringModelId,
      userRoles,
      stepCount: definition.spec.steps.length,
    }, 'tool_registry.register_composition_start');

    // Step 1: Extract all tool IDs from composition steps (including nested compositions)
    const toolIds = await this.extractToolIds(definition.spec.steps);

    this.logger.debug({
      compositionId,
      toolCount: toolIds.length,
      toolIds,
    }, 'tool_registry.register_composition_extracted_tools');

    // Step 2: Get the registering model
    const registeringModel = await this.modelRegistry.getModel(registeringModelId);
    if (!registeringModel) {
      this.logger.warn({
        compositionId,
        registeringModelId,
      }, 'tool_registry.register_composition_model_not_found');

      throw new Error(
        `Registering model not found: ${registeringModelId}. ` +
        `Cannot validate composition RBAC.`
      );
    }

    // Step 3: Validate model has access to ALL constituent tools
    for (const toolId of toolIds) {
      const tool = await this.getTool(toolId);

      if (!tool) {
        this.logger.warn({
          compositionId,
          toolId,
          registeringModelId,
        }, 'tool_registry.register_composition_tool_not_found');

        throw new Error(
          `Constituent tool not found: ${toolId}. ` +
          `Cannot register composition ${compositionId}.`
        );
      }

      // Validate RBAC
      const rbacResult = this.rbacValidator.validateToolAccess(
        tool,
        userRoles,
        registeringModel
      );

      if (!rbacResult.allowed) {
        this.logger.warn({
          compositionId,
          toolId,
          registeringModelId,
          reason: rbacResult.reason,
          details: rbacResult.details,
        }, 'tool_registry.register_composition_rbac_denied');

        throw new Error(
          `Model ${registeringModelId} lacks access to tool ${toolId}: ${rbacResult.reason}. ` +
          `Details: ${rbacResult.details}. ` +
          `Composition registration denied.`
        );
      }

      this.logger.debug({
        compositionId,
        toolId,
        registeringModelId,
      }, 'tool_registry.register_composition_tool_access_validated');
    }

    // Step 4: Calculate inherited RBAC from constituent tools
    // NOTE: Implementation in T3.1 (calculateInheritedRbac)
    const inheritedRbac = await this.calculateInheritedRbac(toolIds);

    // Step 5: Create composition tool document
    const compositionTool: ToolRegistryDocument = {
      id: compositionId,
      canonicalName: definition.metadata.name,
      description: definition.metadata.description || '',
      source: 'composition',
      sourceMetadata: {
        composition: {
          toolIds, // Store flattened list of all constituent tools
          strategy: 'sequential', // Default strategy
        },
      },
      inputSchema: definition.spec.inputSchema,
      outputSchema: definition.spec.outputSchema,
      rbac: inheritedRbac, // Inherited from constituent tools
      config: {
        timeoutMs: 60000, // Default: 60 seconds
        retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
      },
      health: { status: 'healthy' },
      status: 'active',
      tags: ['composition', ...(Object.keys(definition.metadata.labels || {}))],
      category: definition.metadata.labels?.category || 'composition',
      relatedTools: toolIds, // For discoverability
      importedAt: new Date(),
      lastUpdatedAt: new Date(),
    };

    // Step 6: Store composition in registry
    await this.store.set(COLLECTION_NAME, compositionId, compositionTool);

    this.logger.info({
      compositionId,
      registeringModelId,
      constituentToolCount: toolIds.length,
      constituentTools: toolIds,
      inheritedRbac,
    }, 'tool_registry.register_composition_success');
  }

  /**
   * Calculate inherited RBAC from constituent tools
   *
   * Sprint 61: Composition RBAC + Validation (T3.1)
   *
   * Returns most restrictive RBAC configuration by combining constituent tools' RBAC.
   *
   * Inheritance Rules:
   * - RULE 1: Union of user required roles (composition needs ALL)
   * - RULE 2: Union of user denied roles (if ANY tool denies, composition denies)
   * - RULE 3: Union of model required roles
   * - RULE 4: Union of model denied roles
   * - RULE 5: Intersection of allowed tiers (most restrictive)
   * - RULE 6: Union of denied tiers (if ANY tool denies, composition denies)
   * - RULE 7: Highest trust threshold across all tools (most restrictive)
   *
   * @param toolIds - Array of constituent tool IDs
   * @returns Inherited RBAC configuration
   */
  private async calculateInheritedRbac(toolIds: string[]): Promise<any> {
    // Fetch all constituent tools
    const tools = await Promise.all(
      toolIds.map(id => this.getTool(id))
    );

    // Validate all tools found
    const missing = tools
      .map((t, i) => (t === null ? toolIds[i] : null))
      .filter(t => t !== null);

    if (missing.length > 0) {
      throw new Error(`Constituent tools not found: ${missing.join(', ')}`);
    }

    // Filter out nulls (TypeScript type refinement)
    const validTools = tools.filter(t => t !== null) as ToolRegistryDocument[];

    this.logger.debug({
      toolCount: validTools.length,
      toolIds,
    }, 'tool_registry.calculate_inherited_rbac_start');

    // RULE 1: Union of user required roles (composition needs ALL)
    const userRequiredRoles = [
      ...new Set(validTools.flatMap(t => t.rbac.userRoles.required))
    ];

    // RULE 2: Union of user denied roles
    const userDeniedRoles = [
      ...new Set(validTools.flatMap(t => t.rbac.userRoles.denied))
    ];

    // RULE 3: Union of model required roles
    const modelRequiredRoles = [
      ...new Set(validTools.flatMap(t => t.rbac.modelRoles.required))
    ];

    // RULE 4: Union of model denied roles
    const modelDeniedRoles = [
      ...new Set(validTools.flatMap(t => t.rbac.modelRoles.denied))
    ];

    // RULE 5: Intersection of allowed tiers (most restrictive)
    const allowedTiers = this.intersectTiers(
      validTools.map(t => t.rbac.modelTiers.allowed)
    );

    // RULE 6: Union of denied tiers
    const deniedTiers = [
      ...new Set(validTools.flatMap(t => t.rbac.modelTiers.denied))
    ];

    // RULE 7: Highest trust threshold across all tools (most restrictive)
    const minTrustThresholds = this.mergeMinTrustThresholds(validTools);

    const inherited = {
      userRoles: {
        required: userRequiredRoles,
        denied: userDeniedRoles,
      },
      modelRoles: {
        required: modelRequiredRoles,
        denied: modelDeniedRoles,
      },
      modelTiers: {
        allowed: allowedTiers,
        denied: deniedTiers,
      },
      minTrustThresholds,
    };

    this.logger.info({
      toolCount: validTools.length,
      inherited,
    }, 'tool_registry.calculate_inherited_rbac_complete');

    return inherited;
  }

  /**
   * Calculate intersection of allowed model tiers
   *
   * Sprint 61: Composition RBAC + Validation (T3.2)
   *
   * Returns the most restrictive set of allowed tiers. If any tool allows all tiers
   * (empty array), it's filtered out. The result is the intersection of all non-empty lists.
   *
   * @param tierLists - Array of allowed tier lists from constituent tools
   * @returns Intersection of tier lists (most restrictive)
   *
   * @example
   * ```typescript
   * // tool1 allows [basic, premium], tool2 allows [premium, enterprise]
   * intersectTiers([['basic', 'premium'], ['premium', 'enterprise']])
   * // Returns: ['premium'] (intersection)
   *
   * // tool1 allows all (empty), tool2 allows [premium]
   * intersectTiers([[], ['premium']])
   * // Returns: ['premium'] (empty filtered out)
   *
   * // All tools allow all
   * intersectTiers([[], []])
   * // Returns: [] (allow all)
   * ```
   */
  private intersectTiers(tierLists: string[][]): string[] {
    // Filter out empty lists (tools that allow all tiers)
    const nonEmptyLists = tierLists.filter(list => list.length > 0);

    if (nonEmptyLists.length === 0) {
      // All tools allow all tiers → composition allows all tiers
      return [];
    }

    // Intersection: tier must be in ALL lists
    const firstList = nonEmptyLists[0];
    return firstList.filter(tier =>
      nonEmptyLists.every(list => list.includes(tier))
    );
  }

  /**
   * Merge trust thresholds, taking maximum (most restrictive)
   *
   * Sprint 61: Composition RBAC + Validation (T3.3)
   *
   * For each trust dimension (reliability, fidelity, integrity, calibration),
   * takes the MAXIMUM threshold across all tools. This ensures the composition
   * requires the highest trust level needed by any constituent tool.
   *
   * @param tools - Array of constituent tool documents
   * @returns Merged trust thresholds (undefined if no tools require trust)
   *
   * @example
   * ```typescript
   * // tool1: reliability=80, tool2: reliability=90
   * // Result: reliability=90 (max, most restrictive)
   * ```
   */
  private mergeMinTrustThresholds(
    tools: ToolRegistryDocument[]
  ): any | undefined {
    // Collect all trust thresholds from tools
    const allThresholds = tools
      .map(t => t.rbac.minTrustThresholds)
      .filter(th => th !== undefined);

    if (allThresholds.length === 0) {
      // No tools require trust thresholds → composition doesn't either
      return undefined;
    }

    // Group by scope (use first scope encountered, or 'tool-use' default)
    const scopes = allThresholds.map(th => th.scope || 'tool-use');
    const primaryScope = scopes[0] || 'tool-use';

    // For each dimension, take MAX threshold across all tools (most restrictive)
    const dimensions = ['reliability', 'fidelity', 'integrity', 'calibration'] as const;
    const merged: any = {
      scope: primaryScope,
    };

    for (const dim of dimensions) {
      const values = allThresholds
        .map(th => th[dim])
        .filter(v => v !== undefined) as number[];

      if (values.length > 0) {
        merged[dim] = Math.max(...values); // Highest threshold (most restrictive)
      }
    }

    this.logger.debug({
      toolCount: tools.length,
      thresholdsCount: allThresholds.length,
      merged,
    }, 'tool_registry.merge_min_trust_thresholds');

    return merged;
  }

  /**
   * Extract all tool IDs from composition steps, including nested compositions
   *
   * Sprint 61: Composition RBAC + Validation (T1.1)
   *
   * Recursively extracts all tool IDs from composition steps. For steps that reference
   * other compositions, this method recursively expands them to get the full set of
   * primitive tools required.
   *
   * Handles both CallStep (which invoke tools) and IfValueStep (which do not).
   *
   * @param steps - Array of composition steps to extract from
   * @returns Deduplicated array of all primitive tool IDs (compositions expanded)
   *
   * @example
   * ```typescript
   * const steps = [
   *   { id: 'step1', call: 'tool.get_user' },           // primitive tool
   *   { id: 'step2', call: 'composition.send_alert' },  // composition (will be expanded)
   *   { id: 'step3', if: { condition: {...}, then: 'A', else: 'B' } }  // no tool call
   * ];
   * const toolIds = await extractToolIds(steps);
   * // Returns: ['tool.get_user', 'tool.send_message', 'tool.log_event']
   * //          (composition.send_alert expanded to its constituent tools)
   * ```
   */
  private async extractToolIds(steps: Step[]): Promise<string[]> {
    const toolIds: Set<string> = new Set();

    for (const step of steps) {
      // Only CallStep contains tool invocations
      if (isCallStep(step)) {
        const callStep = step as CallStep;
        const toolId = callStep.call;

        // Check if this tool is itself a composition (nested composition)
        const referencedTool = await this.getTool(toolId);

        if (referencedTool && referencedTool.source === 'composition') {
          // Tool is a composition - recursively expand to get its constituent tools
          // Constituent tool IDs are stored in sourceMetadata.composition.toolIds
          const constituentToolIds = referencedTool.sourceMetadata?.composition?.toolIds;

          if (constituentToolIds && constituentToolIds.length > 0) {
            this.logger.debug({
              compositionId: toolId,
              constituentToolCount: constituentToolIds.length,
              constituentToolIds,
            }, 'tool_registry.extract_tool_ids_nested_composition');

            // Recursively expand each constituent tool (in case any are also compositions)
            for (const constituentToolId of constituentToolIds) {
              const constituentTool = await this.getTool(constituentToolId);
              if (constituentTool && constituentTool.source === 'composition') {
                // Nested composition within a composition - recurse further
                const nestedToolIds = constituentTool.sourceMetadata?.composition?.toolIds || [];
                nestedToolIds.forEach(id => toolIds.add(id));
              } else {
                // Primitive tool - add directly
                toolIds.add(constituentToolId);
              }
            }
          } else {
            // Composition has no constituent tools (malformed) - log warning but don't fail
            this.logger.warn({
              compositionId: toolId,
            }, 'tool_registry.extract_tool_ids_empty_composition');
          }
        } else {
          // Primitive tool - add directly
          toolIds.add(toolId);
        }
      }
      // IfValueStep does not invoke tools, so we skip it
    }

    this.logger.debug({
      stepCount: steps.length,
      uniqueToolCount: toolIds.size,
      toolIds: Array.from(toolIds),
    }, 'tool_registry.extract_tool_ids_result');

    return Array.from(toolIds);
  }

  /**
   * Apply RBAC filtering to tools (post-query)
   * This handles complex JSONB queries that aren't easily done in PostgreSQL
   */
  private applyRbacFilter(
    tools: ToolRegistryDocument[],
    rbacFilter: { userRoles?: string[]; modelId?: string }
  ): ToolRegistryDocument[] {
    return tools.filter((tool) => {
      // Filter by user roles
      if (rbacFilter.userRoles && rbacFilter.userRoles.length > 0) {
        const hasRequiredRoles =
          tool.rbac.userRoles.required.length === 0 ||
          tool.rbac.userRoles.required.some((role) =>
            rbacFilter.userRoles!.includes(role)
          );
        const hasDeniedRoles = tool.rbac.userRoles.denied.some((role) =>
          rbacFilter.userRoles!.includes(role)
        );

        if (!hasRequiredRoles || hasDeniedRoles) {
          return false;
        }
      }

      // Model-based filtering will be implemented in Sprint 58
      // For now, we only check if model roles are empty (Sprint 57)
      if (rbacFilter.modelId) {
        // Skip model RBAC filtering for now (Sprint 58)
        return true;
      }

      return true;
    });
  }
}
