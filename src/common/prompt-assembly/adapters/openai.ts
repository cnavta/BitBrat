import { AssembledPrompt } from "../types";

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface OpenAIChatPayload {
  messages: OpenAIChatMessage[];
}

/**
 * Maps assembled sections to OpenAI Chat/Responses payload.
 * system = [System Prompt + Identity + Requesting User + Constraints]
 * user   = [Task + Input]
 */
export function openaiAdapter(assembled: AssembledPrompt): OpenAIChatPayload {
  const system = [
    assembled.sections.systemPrompt,
    assembled.sections.identity,
    assembled.sections.requestingUser,
    assembled.sections.constraints,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [assembled.sections.task, assembled.sections.input]
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
