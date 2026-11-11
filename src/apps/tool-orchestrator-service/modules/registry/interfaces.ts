/**
 * Tool Registry Interfaces
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

import {
  ToolRegistryDocument,
  ToolQueryFilters,
  HealthStatus,
} from '../types';

/**
 * MCP Tool Definition (from external MCP servers)
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

/**
 * BitBrat Tool (from internal Bit services)
 * This matches the existing tool-gateway format
 */
export interface BitBratTool {
  id: string;
  displayName?: string;
  description?: string;
  source: 'internal' | 'mcp' | 'composition';
  originServer?: string;
  inputSchema: any;
  requiredRoles?: string[];
  scopes?: string[];
  category?: string;
}

/**
 * Tool Registry Interface
 * Manages persistent tool storage with RBAC and health tracking
 */
export interface IToolRegistry {
  // Tool CRUD operations
  registerTool(tool: ToolRegistryDocument): Promise<void>;
  getTool(id: string): Promise<ToolRegistryDocument | null>;
  queryTools(filters: ToolQueryFilters): Promise<ToolRegistryDocument[]>;
  updateTool(id: string, updates: Partial<ToolRegistryDocument>): Promise<void>;
  deleteTool(id: string): Promise<void>;

  // Deduplication
  findDuplicates(tool: ToolRegistryDocument): Promise<ToolRegistryDocument[]>;
  resolveConflict(toolId: string, preferredSource: string): Promise<void>;

  // Health tracking
  updateHealth(
    toolId: string,
    health: {
      status: HealthStatus;
      lastError?: string;
      lastInvocationAt?: string;
      lastSuccessAt?: string;
      lastErrorAt?: string;
    }
  ): Promise<void>;

  // Import pipeline
  importFromMcp(serverName: string, tools: McpToolDefinition[]): Promise<string[]>;
  importFromBit(bitName: string, tools: BitBratTool[]): Promise<string[]>;
}
