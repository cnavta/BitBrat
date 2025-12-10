# Deliverable Retro – sprint-123-a2f701b

Date: 2025-12-10
Owner: Lead Implementor

## What worked
- In-run short-term memory via LangGraph reducer delivered quickly with solid unit tests.
- Instance-scoped (in-process) memory added with TTL/LRU and per-key caps; integrated with processor cleanly.
- Validation script updated to be logically passable locally and support scoped runs (llm-bot).
- Observability added around memory trimming, input sizing, and OpenAI request/response previews.
- PR created and tracked per Sprint Protocol.

## What didn’t / issues found
- Cloud Run deploy failed when a system prompt with spaces/quotes was passed via `--set-env-vars`.
- Cloud Build substitution attempted to expand `${ENV_DELIM}` style variables in inline bash, causing INVALID_ARGUMENT errors.

## Changes we made to address issues
- Switched to gcloud custom delimiter for env vars and quoted the entire mapping.
- Escaped bash variables in Cloud Build step using `$$VAR` to avoid Cloud Build substitution.

## Deferred / out of scope
- Cross-instance short-term memory (shared cache) – acceptable to defer; instance-scoped meets current needs.
- Documentation polish for instance memory (finalize in next cycle if needed).

## Action items
- Consider propagating the delimiter approach to all Cloud Build configs for consistency.
- Monitor memory metrics in Cloud Run and tune defaults if needed.
