# Implementation Plan – sprint-284-e4f5g6

## Objective
Extend the `query-analyzer` service to provide advanced linguistic analysis including token counts, entity extraction, topic classification, and semantic embeddings.

## Technical Architecture

### 1. Overview
The `query-analyzer` currently provides intent, tone, and risk analysis. This sprint adds four new data points to the analysis pipeline to better support downstream services (like `llm-bot`) in making routing and response decisions.

### 2. New Components

#### A. Token Counting
- **Mechanism:** Use `js-tiktoken` (already present in the codebase) to calculate the exact token count of the incoming message.
- **Annotation:** Add a `tokens` annotation with the count.

#### B. Entity Extraction
- **Mechanism:** Update the `generateObject` Zod schema to include an `entities` array. Each entity will have a `text`, `type` (e.g., person, place, organization, product, date), and `confidence`.
- **Annotation:** Add an `entities` annotation containing the list of extracted entities.

#### C. Topic Classification
- **Mechanism:** Update the `generateObject` Zod schema to include a `topic` field. The LLM will classify the message into one of a set of predefined topics or provide a general category.
- **Annotation:** Add a `topic` annotation.

#### D. Semantic Embedding
- **Mechanism:** Use the Vercel AI SDK `embed` function.
- **Provider:** If `LLM_PROVIDER` is `openai`, use `text-embedding-3-small`. If `ollama`, use a configured embedding model (e.g., `mxbai-embed-large` or `nomic-embed-text`).
- **Storage:** The embedding (vector) will be attached as a `semantic` annotation.
- **Note:** Embedding generation is a separate LLM call from `generateObject`.

### 3. Data Schema Changes

#### `QueryAnalysis` Extension (`src/services/query-analyzer/llm-provider.ts`)
```typescript
export const queryAnalysisSchema = z.object({
  // ... existing fields
  entities: z.array(z.object({
    text: z.string(),
    type: z.string(),
  })),
  topic: z.string(),
});
```

#### New Annotations
- `tokens`: `{ count: number }`
- `entities`: `{ entities: Array<{ text: string, type: string }> }`
- `topic`: `{ topic: string }`
- `semantic`: `{ embedding: number[] }`

### 4. Implementation Details
1. **Model Configuration:** Add `EMBEDDING_MODEL` environment variable.
2. **LLM Provider Update:**
   - Update `SYSTEM_PROMPT` to include instructions for entity extraction and topic classification.
   - Update `analyzeWithLlm` to return the new fields.
   - Implement `generateEmbedding` utility using `embed` from `ai`.
3. **Server Update (`src/apps/query-analyzer.ts`):**
   - In the message handler, call both `analyzeWithLlm` and `generateEmbedding` (concurrently where possible).
   - Construct and attach the new annotations.
4. **Observability:**
   - Update Firestore logging to include `entities`, `topic`, and `tokenCount`. (Embeddings are too large for standard logs and will be omitted from Firestore by default to save cost).

## Scope
- `query-analyzer` service updates.
- Shared types updates if necessary.
- Testing the new analysis fields.

## Deliverables
- Updated `src/services/query-analyzer/llm-provider.ts`
- Updated `src/apps/query-analyzer.ts`
- New tests in `src/apps/query-analyzer.test.ts`
- Updated documentation

## Acceptance Criteria
- Incoming messages are enriched with `tokens`, `entities`, `topic`, and `semantic` annotations.
- `tokens` count matches `js-tiktoken` output.
- `entities` contains relevant identified names/terms.
- `topic` provides a reasonable high-level category.
- `semantic` contains a valid vector of numbers.
- System handles cases where LLM or embedding provider fails gracefully.

## Testing Strategy
- **Unit Tests:** Mock the LLM provider to verify that the server correctly parses and attaches the new annotations.
- **Integration Tests:** Use a local Ollama instance (if available) or OpenAI with a test key to verify end-to-end analysis.

## Definition of Done
- All code changes trace back to this sprint.
- `validate_deliverable.sh` passes.
- PR created and linked in `publication.yaml`.
