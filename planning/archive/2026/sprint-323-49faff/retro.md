# Retrospective – sprint-323-49faff (Evaluator & Agent-Framework Readiness)

## What worked

- **Evaluation-driven, gated backlog** mapped cleanly to phases; the lowest scorecard dimensions were
  remediated first (framing, hygiene, security), so impact-per-effort was high.
- **Grounding every claim** against `architecture.yaml`/code (service names verified, provider env vars read
  from source) kept the new agent-framing docs accurate rather than aspirational.
- **Wiring `brat config validate` to a shipped schema paid off immediately** — it surfaced a real,
  pre-existing defect (the `firestore` infrastructure resource was unrepresented in the Zod union), which we
  fixed, so validation is now meaningful instead of decorative.
- **Sanity-checking the offline path against compiled `dist`** proved the Ollama quickstart is genuinely
  key-free, satisfying "exercised, not just asserted."

## What didn't / surprises

- **`AGENTS.md` was missing from the repo tree** even though the evaluation treated it as an existing
  strength. The link-check in `validate_deliverable.sh` caught the broken links I introduced; resolved by
  materializing the canonical protocol at the repo root.
- **`npm audit` counts drifted** from the evaluation's 149 to a current 51 (tree changed since the review),
  and `audit fix` raised *moderate* counts while clearing criticals/highs — a reminder to report
  severity-weighted deltas, not just totals.
- **`ajv` was a devDependency** but needed at runtime once the CLI consumed it; easy to miss because dev
  installs hide the gap.

## Follow-ups for future sprints

- Dependency security: schedule the deferred breaking upgrades (`undici`/`@discordjs/*`, jest toolchain,
  `uuid` via `twilio`/`@google-cloud`) and add a real `.github/dependabot.yml`.
- Consider a CI link-check + `brat config validate` gate (the logic now exists in `validate_deliverable.sh`).
- The JSON schema is intentionally permissive; tighten it incrementally as `architecture.yaml` stabilizes
  toward 1.0.
