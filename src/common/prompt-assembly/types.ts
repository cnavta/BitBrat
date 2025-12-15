// Prompt Assembly – Core Public Types (P-01)

export type Priority = 1 | 2 | 3 | 4 | 5; // 1 = highest

export interface SystemPrompt {
  summary?: string; // 1–2 lines describing the immutable rule set
  rules: string[]; // e.g., ["Follow architecture.yaml precedence", "Never leak secrets"]
  sources?: string[]; // e.g., ["architecture.yaml", "AGENTS.md v2.4"]
}

export interface Identity {
  personaId?: string;
  name?: string;
  summary?: string; // 1–3 sentences
  traits?: string[]; // e.g., ["precise", "helpful"]
  tone?: string; // e.g., "professional"
  styleGuidelines?: string[]; // e.g., ["use bullet lists", "be concise"]
}

export interface RequestingUser {
  userId?: string;
  handle?: string; // e.g., @user
  displayName?: string;
  roles?: string[]; // e.g., ["admin", "architect"]
  locale?: string; // BCP-47, e.g., "en-US"
  timezone?: string; // IANA TZ
  tier?: string; // e.g., "pro", "free"
}

export interface Constraint {
  id?: string;
  priority?: Priority; // default 3
  text: string; // single rule/guardrail
  tags?: string[]; // e.g., ["format", "policy"]
  source?: "system" | "policy" | "runtime";
}

export interface FormatSpec {
  type: "markdown" | "json" | "xml" | "text";
  jsonSchema?: object; // optional JSON Schema for structured outputs
  example?: string; // short exemplar
}

export interface TaskAnnotation {
  id?: string;
  priority?: Priority; // default 3
  instruction: string; // imperative statement
  required?: boolean; // default true
  outputFormat?: FormatSpec; // optional, may also be set globally
}

export interface InputAttachment {
  name: string;
  mime: string;
  uri?: string;
  bytesBase64?: string;
}

export interface InputPayload {
  userQuery: string; // raw user question
  attachments?: InputAttachment[]; // optional
  context?: string; // optional short context snippet
}

export interface PromptSpec {
  systemPrompt?: SystemPrompt;
  identity?: Identity;
  requestingUser?: RequestingUser;
  constraints?: Constraint[];
  task: TaskAnnotation[]; // at least one
  input: InputPayload; // required
}

export interface AssemblerConfig {
  headingLevel?: 1 | 2 | 3; // default 2
  showEmptySections?: boolean; // default true
  provider?: "openai" | "google"; // rendering target for adapters (used later)
}

export interface AssembledPromptSections {
  systemPrompt: string;
  identity: string;
  requestingUser: string;
  constraints: string;
  task: string;
  input: string;
}

export interface AssembledPrompt {
  text: string; // concatenated sections in canonical order
  sections: AssembledPromptSections;
}
