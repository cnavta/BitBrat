import { AssembledPrompt } from "../types";

export interface GoogleContentPart {
  text: string;
}

export interface GoogleContent {
  role: "user" | "model" | "system";
  parts: GoogleContentPart[];
}

export interface GooglePayload {
  systemInstruction: { parts: GoogleContentPart[] } | string;
  contents: GoogleContent[];
}

/**
 * Maps assembled sections to Google (Gemini/Vertex) payload.
 * systemInstruction = [System Prompt + Identity + Requesting User + Constraints]
 * contents(user)    = [Task + Input]
 */
export function googleAdapter(assembled: AssembledPrompt): GooglePayload {
  const systemText = [
    assembled.sections.systemPrompt,
    assembled.sections.identity,
    assembled.sections.requestingUser,
    assembled.sections.constraints,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userText = [assembled.sections.task, assembled.sections.input]
    .filter(Boolean)
    .join("\n\n");

  return {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
  };
}

export type { AssembledPrompt };
