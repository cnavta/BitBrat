# Key Learnings – sprint-123-a2f701b

Date: 2025-12-10
Owner: Lead Implementor

## Technical
- LangGraph state + reducer pattern is a clean fit for short-term memory; exporting the reducer enabled tight, deterministic tests.
- Instance-scoped memory (TTL/LRU) provides strong UX gains without external dependencies and kept Cloud Run latency low.
- When using gcloud in Cloud Build, pass env vars with a custom delimiter and quote the whole mapping to safely include spaces/commas.
- Cloud Build substitution expands `${VAR}` in inline bash; use `$$VAR` to defer to the shell at runtime.
- OpenAI Responses API should receive AbortSignal via the client call options, not inside the request body; tests help prevent regressions here.

## Process
- validate_deliverable.sh benefits from a scoped mode to run only service tests during focused sprints.
- Keeping planning artifacts updated (backlog, verification-report) simplified closure checks per AGENTS.md.

## Next time
- Consider a shared cache backend only if cross-instance continuity becomes a requirement; the current interface supports swapping.
- Add lightweight metrics for instance memory (key count, per-key turns/char budget) and set alerts if nearing limits.
