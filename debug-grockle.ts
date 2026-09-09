/**
 * Debug script to test grockle composition and surface root cause errors
 */

import { CompositionExecutor } from './src/common/composition/executor';

// Mock tool registry that shows detailed errors
const mockRegistry = {
  getTool: (toolId: string) => {
    console.log(`[DEBUG] getTool called with: ${toolId}`);

    if (toolId === 'mcp:generate_image') {
      return {
        id: 'mcp:generate_image',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' }
          },
          required: ['prompt']
        },
        execute: async (args: any, context: any) => {
          console.log('[DEBUG] generate_image called with args:', JSON.stringify(args, null, 2));
          console.log('[DEBUG] generate_image context:', JSON.stringify(context, null, 2));

          // Simulate the actual error that might be occurring
          throw new Error('Underlying error from generate_image - this is what we need to see!');
        }
      };
    }

    if (toolId === 'get_state' || toolId === 'mcp:get_state') {
      return {
        id: 'get_state',
        execute: async (args: any) => {
          console.log('[DEBUG] get_state called with:', args);
          return { value: 'mock notes value' };
        }
      };
    }

    console.log(`[DEBUG] Tool not found: ${toolId}`);
    return null;
  }
};

async function main() {
  const executor = new CompositionExecutor(mockRegistry as any);

  // Simplified grockle composition
  const composition = {
    metadata: { name: 'grockle', version: 1 },
    spec: {
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string' }
        }
      },
      steps: [
        {
          id: 'generate_image',
          call: 'mcp:generate_image',  // Test with explicit prefix
          with: {
            prompt: 'test prompt'
          }
        }
      ],
      return: { success: true }
    }
  } as any;

  console.log('\n=== Testing composition execution ===\n');

  try {
    const result = await executor.execute(composition, {
      input: { description: 'test' },
      context: {},
      sessionId: 'debug-session',
      userRoles: []
    });

    console.log('\n=== Result ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('\n=== Error ===');
    console.log('Error:', error);
    if (error instanceof Error) {
      console.log('Message:', error.message);
      console.log('Stack:', error.stack);
      console.log('Cause:', (error as any).cause);
    }
  }
}

main().catch(console.error);
