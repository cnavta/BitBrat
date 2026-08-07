# Deliverable Verification – sprint-323-49faff (Evaluator & Agent-Framework Readiness)

Source: `documentation/evaluation/external-evaluation.md`. Plan: `execution-plan.md`. Backlog: `backlog.yaml`.

## Completed

- [x] **BL-100** Discovery: clone URL + version + scratch-file consumers located; OQ1–5 answered (REQ-002).
- [x] **BL-101** README/quickstart clone URL → `https://github.com/cnavta/BitBrat.git` (+ `cd BitBrat`).
- [x] **BL-102** Version reconciled to **0.7.0** across `package.json` + `architecture.yaml`; added `project.status: experimental`.
- [x] **BL-103** README "What is BitBrat?" agent-framing + agent-loop table + "Why BitBrat" note (grounded in real services).
- [x] **BL-106** README "Core Agent Concepts" + "Extending BitBrat" + prominent **AGENTS.md** link.
- [x] **BL-107** Offline/local-LLM quickstart (Ollama via `LLM_PROVIDER`/`LLM_MODEL`/`LLM_BASE_URL`, no key); sanity-checked against compiled `dist` (provider instantiates with no API key).
- [x] **BL-201** Untracked + deleted `dummy-creds.json`, `route.json`, `test.json`, `validation_output.txt`; `.gitignore` extended (`git check-ignore` confirms).
- [x] **BL-105** Shipped `documentation/schemas/architecture.v1.json`; added `$schema` comment + `references.architecture_schema`; wired `brat config validate` (Zod + ajv JSON schema). `brat config validate` PASSES.
- [x] **BL-104** Added `extension_points:` block to `architecture.yaml` (add_service / add_mcp_tool / add_rule / see_also) referencing real CLI/files.
- [x] **BL-401** Non-breaking `npm audit fix`: **51 → 42** vulns (all 3 critical + 15/16 high cleared); SECURITY.md gained a scanning/remediation cadence.
- [x] **BL-108** README mermaid architecture diagram + accurate capabilities matrix.
- [x] **BL-301** `documentation/getting-started/evaluating-bitbrat.md` Evaluator's Guide (linked from README docs index).
- [x] **BL-302** `CHANGELOG.md` (Keep-a-Changelog) + `assets/architecture-overview.md` diagram asset.
- [x] **BL-600** `planning/sprint-323-49faff/validate_deliverable.sh` (build + config tests + `brat config validate` + version + scratch-file + link-check + audit summary) — **logically passable and PASSES**.

## Validation Evidence

- `npm run build` — green.
- `npm test` — **265 suites / 919 tests pass** (2 skipped) after the dependency remediation.
- `node dist/tools/brat/src/cli/index.js config validate` → `Config valid (validated against documentation/schemas/architecture.v1.json)`.
- `validate_deliverable.sh` → all checks pass; audit summary `total=42 critical=0 high=1 moderate=41 low=0`.

## Alignment Notes / Deviations (justified)

- **Version target 0.7.0** (user decision REQ-002) instead of the plan-of-record 0.1.0.
- **Created `AGENTS.md` at the repo root.** It was referenced by the evaluation (and required by BL-106) but
  was **absent from the working tree**; materializing the canonical v2.5 protocol fixes the otherwise-broken
  links and aligns the repo with documented intent. (Additive, reversible.)
- **Fixed a pre-existing config-schema gap:** the Zod `ArchitectureSchema` rejected the `firestore`
  infrastructure resource (`type: document-database`) added in sprint-322; added a matching union variant so
  `brat config validate` passes on the current file. (Necessary to satisfy BL-105.)
- **Moved `ajv`/`ajv-formats` to runtime dependencies** because `brat config validate` (run from `dist`) now
  imports them.

## Deferred (dependency security — non-breaking scope, OQ4)

Remaining advisories after non-breaking `npm audit fix` require **breaking upgrades or upstream fixes** and are
deferred (tracked via the SECURITY.md cadence):

- **high:** `undici` (HTTP header injection via Set-Cookie) — transitive via `@discordjs/rest`/`discord.js`.
- **moderate (dev tooling):** `jest`/`ts-jest`/`babel-jest`/`@jest/*`/`babel-plugin-istanbul` chain.
- **moderate (transitive runtime):** `uuid` (via `twilio`/`twilsock`, `@google-cloud/*`, `gaxios`),
  `@opentelemetry/core` (W3C Baggage), `js-yaml` (merge-key DoS via `@istanbuljs/load-nyc-config`),
  `@discordjs/ws`→`undici`.

Full breaking upgrades (`npm audit fix --force`) were intentionally **out of scope** per OQ4.
