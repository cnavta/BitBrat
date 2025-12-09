# Technical Architecture - llm-bot (First Pass)

This document outlines the initial architecture for the llm-bot service. It consumes
events on `internal.llmbot.v1`, aggregates all `prompt` annotations, calls the configured
LLM (OpenAI, default model `gpt-5-mini`) via a minimal LangGraph.js pipeline, appends a
candidate reply to the event, and advances the routing slip.

Key decisions:
- Adopt LangGraph.js now to prepare for richer flows later (tools, RAG, branching).
- If no `prompt` annotations are present, skip LLM and advance the slip with status `SKIP`.
- On successful LLM call, append a `CandidateV1` (kind: "text", status: "proposed") and
  advance with status `OK`.

Interfaces & Contracts:
- Input: InternalEventV2 (preferred) with optional `annotations`.
- Output: InternalEventV2 with optional `candidates` updated.
- Topics: consumes `internal.llmbot.v1`.
- Env/Secrets: `OPENAI_API_KEY`; optional `OPENAI_MODEL` (default `gpt-5-mini`).

Minimal LangGraph state and nodes:
- State: `{ event, prompt?, llmText?, candidateAppended?, stepStatus }`
- Nodes: `load_event -> build_prompt -> call_model -> build_candidate -> decide_status`
- Short-circuit: when no prompt is built, set `stepStatus=SKIP` and bypass model.

Observability & Errors:
- Structured logs via BaseServer logger; span wrapping if tracing enabled.
- Prefer `SKIP` for missing inputs; use `ERROR` for unexpected failures.
