import { AssembledPrompt } from "../types";

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface OpenAIChatPayload {
  messages: OpenAIChatMessage[];
}

/**
 * Maps assembled sections to OpenAI Chat/Responses payload (v2 mapping).
 * system = [System Prompt + Assistant Identity]
 * user   = [Requesting User + Conversation State/History + Constraints + Task + Input]
 */
export function openaiAdapter(assembled: AssembledPrompt): OpenAIChatPayload {
  const system = [
    assembled.sections.systemPrompt,
    assembled.sections.identity,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    assembled.sections.requestingUser,
    assembled.sections.conversationState,
    assembled.sections.constraints,
    assembled.sections.task,
    assembled.sections.input,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

export type { AssembledPrompt };
