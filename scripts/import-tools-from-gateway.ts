/**
 * Import Tools from tool-gateway
 * Sprint 57: Tool Import Script
 *
 * This script fetches all tools from tool-gateway via MCP
 * and imports them into tool-orchestrator's persistent registry.
 */

import { createDocumentStore } from '../src/common/persistence/factory';
import { ToolRegistry } from '../src/apps/tool-orchestrator-service/modules/registry/tool-registry';
import { Logger } from '../src/common/logging';
import type { BitBratTool } from '../src/apps/tool-orchestrator-service/modules/registry/interfaces';

interface McpToolListResponse {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: any;
    scopes?: string[];
  }>;
}

/**
 * Fetch tools from tool-gateway's MCP endpoint
 */
async function fetchToolsFromGateway(endpoint: string): Promise<McpToolListResponse> {
  console.log(`Fetching tools from: ${endpoint}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  // Add authentication (prefer MCP_AUTH_TOKEN, fallback to BITBRAT_API_TOKEN)
  const authToken = process.env.MCP_AUTH_TOKEN || process.env.BITBRAT_API_TOKEN;
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // Parse SSE response (format: "event: message\ndata: {...}\n\n")
  const text = await response.text();
  const dataMatch = text.match(/^data: (.+)$/m);

  if (!dataMatch) {
    throw new Error(`Invalid SSE response format: ${text.substring(0, 100)}`);
  }

  const data = JSON.parse(dataMatch[1]) as { error?: { message: string }; result: McpToolListResponse };

  if (data.error) {
    throw new Error(`MCP Error: ${data.error.message}`);
  }

  return data.result;
}

/**
 * Transform MCP tools to BitBratTool format
 */
function transformTools(mcpTools: McpToolListResponse['tools'], compositionNames: Set<string>): BitBratTool[] {
  return mcpTools.map((tool) => {
    // Check if this is a registered composition
    const isComposition = compositionNames.has(tool.name);

    if (isComposition) {
      return {
        id: tool.name,
        displayName: tool.name,
        description: tool.description || '',
        source: 'composition',
        originServer: 'tool-gateway',
        inputSchema: tool.inputSchema,
        requiredRoles: [],
        scopes: tool.scopes || [],
        category: 'composition',
      };
    }

    // Determine if this is an MCP-sourced tool based on naming patterns
    const isMcpTool = tool.name.includes('.') && !tool.name.startsWith('bit.');

    return {
      id: tool.name,
      displayName: tool.name,
      description: tool.description || '',
      source: isMcpTool ? 'mcp' : 'internal',
      originServer: isMcpTool ? 'tool-gateway' : undefined,
      inputSchema: tool.inputSchema,
      requiredRoles: [],
      scopes: tool.scopes || [],
      category: categorizeToolByName(tool.name),
    };
  });
}

/**
 * Categorize tool based on its name pattern
 */
function categorizeToolByName(toolName: string): string {
  if (toolName.startsWith('bit.')) return 'control-plane';
  if (toolName.startsWith('agent.')) return 'agent';
  if (toolName.startsWith('composition.')) return 'composition';
  if (toolName.startsWith('claim.')) return 'claim-check';
  if (toolName.startsWith('scheduler.')) return 'scheduler';
  return 'general';
}

/**
 * Fetch all composition names from the database via direct SQL query
 */
async function fetchCompositionNames(store: any): Promise<Set<string>> {
  try {
    // The compositions table has a normalized schema (id, name, version, etc.)
    // not the DocumentStore pattern, so we need to query it directly
    const result = await store.pool.query('SELECT DISTINCT name FROM compositions');
    return new Set(result.rows.map((row: any) => row.name));
  } catch (err) {
    console.warn('Failed to fetch composition names, continuing without composition detection:', err);
    return new Set();
  }
}

/**
 * Main import function
 */
async function importTools() {
  console.log('=== Tool Import from tool-gateway ===\n');

  // Configuration
  const TOOL_GATEWAY_ENDPOINT = process.env.TOOL_GATEWAY_MCP_ENDPOINT
    || 'http://tool-gateway.bitbrat.local:3013/mcp';
  const DRY_RUN = process.env.DRY_RUN === 'true';

  console.log(`Configuration:`);
  console.log(`  Endpoint: ${TOOL_GATEWAY_ENDPOINT}`);
  console.log(`  Dry Run: ${DRY_RUN ? 'YES (no database changes)' : 'NO'}`);
  console.log('');

  try {
    // Step 1: Initialize DocumentStore (needed for composition detection)
    console.log('Step 1: Initializing DocumentStore...');
    const logger = new Logger('info');
    const store = await createDocumentStore();
    console.log('✓ DocumentStore initialized\n');

    // Step 2: Fetch composition names for correct categorization
    console.log('Step 2: Fetching composition names...');
    const compositionNames = await fetchCompositionNames(store);
    console.log(`✓ Found ${compositionNames.size} registered compositions\n`);

    // Step 3: Fetch tools from tool-gateway
    console.log('Step 3: Fetching tools from tool-gateway...');
    const mcpResponse = await fetchToolsFromGateway(TOOL_GATEWAY_ENDPOINT);
    console.log(`✓ Fetched ${mcpResponse.tools.length} tools\n`);

    // Step 4: Transform to BitBratTool format
    console.log('Step 4: Transforming tools...');
    const bitBratTools = transformTools(mcpResponse.tools, compositionNames);

    // Show categories
    const categoryCounts = bitBratTools.reduce((acc, tool) => {
      acc[tool.category || 'unknown'] = (acc[tool.category || 'unknown'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('  Categories:');
    Object.entries(categoryCounts).forEach(([category, count]) => {
      console.log(`    - ${category}: ${count} tools`);
    });
    console.log('');

    if (DRY_RUN) {
      console.log('DRY RUN - Tools that would be imported:\n');
      bitBratTools.forEach((tool) => {
        console.log(`  - ${tool.id} (${tool.source}, ${tool.category})`);
      });
      console.log(`\nTotal: ${bitBratTools.length} tools`);
      console.log('\nRun without DRY_RUN=true to actually import.');
      return;
    }

    // Step 5: Initialize ToolRegistry
    console.log('Step 5: Initializing ToolRegistry...');
    const toolRegistry = new ToolRegistry(store, logger as any);
    console.log('✓ ToolRegistry initialized\n');

    // Step 6: Import tools
    console.log('Step 6: Importing tools...');
    const importedIds = await toolRegistry.importFromBit('tool-gateway', bitBratTools);
    console.log(`✓ Import complete\n`);

    // Step 7: Summary
    console.log('=== Import Summary ===');
    console.log(`Total tools fetched: ${mcpResponse.tools.length}`);
    console.log(`Total tools imported: ${importedIds.length}`);
    console.log('');

    if (importedIds.length > 0) {
      console.log('Imported tools:');
      importedIds.forEach((id) => {
        const tool = bitBratTools.find((t) => t.id === id);
        console.log(`  ✓ ${id} (${tool?.source || 'unknown'})`);
      });
    }

    console.log('\n✅ Import completed successfully!');

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    if (error instanceof Error) {
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  importTools().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
