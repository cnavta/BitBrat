// Public API surface for @bitbrat/prompt-assembly (P-01)

export type {
  Priority,
  SystemPrompt,
  Identity,
  RequestingUser,
  Constraint,
  FormatSpec,
  TaskAnnotation,
  InputAttachment,
  InputPayload,
  PromptSpec,
  AssemblerConfig,
  AssembledPromptSections,
  AssembledPrompt,
} from "./types";

export { assemble } from "./assemble";
export { openaiAdapter } from "./adapters/openai";
export { googleAdapter } from "./adapters/google";
