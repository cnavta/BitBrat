import { z } from 'zod';
import { BitBratTool, ToolExecutionContext } from '../../../types/tools';

/**
 * Narrator System Prompt
 */
export const NARRATOR_SYSTEM_PROMPT = `
You are the Narrator for a "Choose Your Own Adventure" story on BitBrat.
Your goal is to provide immersive, engaging storytelling based on the user's theme and actions.

Rules:
1. Stay in character as the Narrator.
2. For each scene, provide a descriptive narrative (1-2 paragraphs).
3. Always offer 3-4 distinct, numbered choices at the end of each scene.
4. If the user provides a free-text action, incorporate it into the narrative.
5. Keep track of the world state (inventory, health, location) and reflect it in the story.
6. Enforce consequences for user actions.
7. Use the tools provided to persist the story state.
8. If the theme is not specified, default to "Dark Fantasy".
`;

export function createAdventureNarratorTool(): BitBratTool {
  return {
    id: 'adventure:narrate',
    source: 'internal',
    displayName: 'Adventure Narrator',
    description: 'Generates the next chapter of the adventure and lists choices.',
    inputSchema: z.object({
      userId: z.string(),
      lastAction: z.string().optional(),
    }),
    execute: async (args, context) => {
      // This tool will be called by the LLM when it needs to "formalize" the next scene
      // or it might be a hint for the LLM itself.
      // In our current architecture, the LLM generates the text directly,
      // but we need tools to call the MCP.
      return {
        instruction: "Use story-engine-mcp tools to update the story state and then narrate the consequence.",
      };
    }
  };
}
