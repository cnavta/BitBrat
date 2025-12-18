# LLM Bot – Prompt Assembly Runbook

## Overview
The llm-bot service now uses the Prompt Assembly framework for all model calls:
System Prompt → Identity → Requesting User → Constraints → Task → Input.
Provider payloads are produced by adapters (OpenAI, Google) to preserve canonical order.

## Configuration Keys
- LLM_BOT_SYSTEM_PROMPT: Immutable guardrails and precedence/safety rules.
- PERSONALITY_ENABLED: Enable/disable mapping personalities to Identity/Constraints.
- PERSONALITY_MAX_ANNOTATIONS: Maximum personality annotations to process.
- PERSONALITY_MAX_CHARS: Clamp personality text for stability/logging.
- PERSONALITY_CACHE_TTL_MS: Cache TTL for personality lookups.
- PERSONALITY_COLLECTION: Firestore collection for personalities.
- PERSONALITY_LOG_PREVIEW_CHARS: Preview length for logs (no secrets).
- LLM_BOT_MEMORY_MAX_MESSAGES: Short-term memory cap (messages).
- LLM_BOT_MEMORY_MAX_CHARS: Short-term memory cap (characters).
- OPENAI_MODEL / OPENAI_TIMEOUT_MS: Model and timeout.

## Observability
- llm_bot.assembly.meta: section lengths, truncation notes, truncated flag.
- llm_bot.assembly.preview: safe preview of assembled text.
- llm_bot.adapter.payload_stats: message counts and char lengths (system/user).
- openai.request: summarized request (model, timeout, counts, preview).
- openai.response: summarized response (duration, char length, preview).

No secrets or full payloads are logged.

## CLI Debugging
Canonical text:

prompt-assembly --spec spec.json --provider none

OpenAI-mapped payload:

prompt-assembly --spec spec.json --provider openai

Or pipe via stdin:

echo '{"task":[{"instruction":"Summarize"}],"input":{"userQuery":"Hello"}}' | prompt-assembly --stdin --provider openai

## Troubleshooting
- Empty reply: check that prompt annotations are present; the processor skips when none.
- Personality missing: ensure PERSONALITY_ENABLED=true and the Firestore doc is active.
- Truncation: inspect llm_bot.assembly.meta; increase caps or reduce Input.context.
- Timeouts: see openai.timeout logs; adjust OPENAI_TIMEOUT_MS or simplify inputs.

## Clean Cutover
Legacy message-flattening is removed. All requests go through assemble() + adapter with canonical section order.