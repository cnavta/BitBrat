import { BitBratTool, BitBratResource, BitBratPrompt, IToolRegistry } from '../../../types/tools';

export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, BitBratTool> = new Map();
  private resources: Map<string, BitBratResource> = new Map();
  private prompts: Map<string, BitBratPrompt> = new Map();

  /**
   * Register a new tool in the registry.
   * If a tool with the same ID already exists, it will be overwritten.
   */
  registerTool(tool: BitBratTool): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * Remove a tool from the registry.
   */
  unregisterTool(id: string): void {
    this.tools.delete(id);
  }

  /**
   * Returns all registered tools as a record suitable for AI SDK.
   * Uses the tool name (or ID if name is missing) as the key.
   * AI SDK expects tool names as keys in the tools object.
   */
  getTools(): Record<string, BitBratTool> {
    const record: Record<string, BitBratTool> = {};
    for (const tool of this.tools.values()) {
      // Use tool ID or some unique key. AI SDK tools often use the key as the tool name.
      // We'll use a sanitized version of the ID if it contains special characters, 
      // but generally AI SDK expects the key to be the function name.
      // MCP tools have a name property.
      const name = this.getToolName(tool);
      record[name] = tool;
    }
    return record;
  }

  /**
   * Get a specific tool by ID.
   */
  getTool(id: string): BitBratTool | undefined {
    return this.tools.get(id);
  }

  registerResource(resource: BitBratResource): void {
    this.resources.set(resource.uri, resource);
  }

  unregisterResource(uri: string): void {
    this.resources.delete(uri);
  }

  getResources(): Record<string, BitBratResource> {
    const record: Record<string, BitBratResource> = {};
    for (const resource of this.resources.values()) {
      record[resource.uri] = resource;
    }
    return record;
  }

  getResource(uri: string): BitBratResource | undefined {
    return this.resources.get(uri);
  }

  registerPrompt(prompt: BitBratPrompt): void {
    this.prompts.set(prompt.id, prompt);
  }

  unregisterPrompt(id: string): void {
    this.prompts.delete(id);
  }

  getPrompts(): Record<string, BitBratPrompt> {
    const record: Record<string, BitBratPrompt> = {};
    for (const prompt of this.prompts.values()) {
      record[prompt.id] = prompt;
    }
    return record;
  }

  getPrompt(id: string): BitBratPrompt | undefined {
    return this.prompts.get(id);
  }

  /**
   * Helper to derive a valid tool name for the AI SDK key.
   */
  private getToolName(tool: BitBratTool): string {
    // If the tool ID is already a valid function name, use it.
    // Otherwise, we might need to sanitize or map it.
    // For now, we'll assume the ID is unique and mostly valid.
    return tool.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
