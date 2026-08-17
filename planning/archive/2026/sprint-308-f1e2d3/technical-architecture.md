# Technical Architecture: Named Contexts for Prompt Assembly

## 1. Background
Currently, enriched data from external services like the Story Engine is incorporated into prompts as serialized JSON. This lacks semantic structure within the prompt, making it harder for LLMs to distinguish between different types of contextual information and potentially leading to less precise responses.

## 2. Objective
Introduce a flexible "Named Contexts" feature to the Prompt Assembly system. This will allow developers to add one or more semantically labeled context sections to a prompt, which will be rendered with clear headings and appropriate formatting.

## 3. Proposed Changes

### 3.1. Core Types (`src/common/prompt-assembly/types.ts`)
Add a new `NamedContext` interface and update `PromptSpec`.

```typescript
export interface NamedContext {
  name: string;      // e.g., "World State", "Character Lore"
  content: string | object; // String or object (to be rendered as JSON/YAML)
  priority?: Priority; // default 3
  subheader?: string; // Optional descriptive text
}

export interface PromptSpec {
  // ... existing fields ...
  contexts?: NamedContext[]; // New field
}

export interface AssembledPromptSections {
  // ... existing fields ...
  contexts: string; // New assembled section
}
```

### 3.2. Assembler Logic (`src/common/prompt-assembly/assemble.ts`)
Implement `renderContexts` and update the `assemble` function.

- **Rendering Order**: Contexts should likely appear before `Task` or `Constraints` to provide necessary background. Suggested v3 order:
  1. System Prompt
  2. Assistant Identity
  3. Requesting User
  4. Conversation State
  5. **Named Contexts** (New)
  6. Constraints
  7. Task
  8. Input

- **Formatting**:
  - If `content` is an object, it should be rendered as a fenced JSON or YAML block.
  - Each named context should have its own sub-heading or clear label within the `[Contexts]` section.

- **Truncation (P-04)**:
  - Add `contexts` to the truncation priority list.
  - Lower priority contexts should be dropped first if `maxTotalChars` is exceeded.

### 3.3. Integration
- Update `llm-bot`'s `processor.ts` to use the new `contexts` field in `PromptSpec` when Story Engine data is present, rather than appending it to `input.context` or `systemPrompt`.

## 4. Verification Plan
- **Unit Tests**: Add tests in `tests/prompt-assembly/assemble.spec.ts` covering:
  - Rendering multiple named contexts.
  - Rendering object-based content (JSON).
  - Priority-based sorting and truncation.
- **Integration Tests**: Verify `llm-bot` correctly populates these contexts from incoming annotations.
