# Request Log – sprint-130-ecb1a4

- 2025-12-12T15:42-05:00 Created feature branch: feature/sprint-130-ecb1a4-env-overlay-inclusion
- 2025-12-12T15:44-05:00 Implemented brat CLI change to load full env overlay and validate required keys; exclude secrets.
- 2025-12-12T15:48-05:00 Updated infrastructure/deploy-cloud.sh to always include full overlay env, validate required keys, and skip deploy if missing (apply mode); warn in dry-run.
- 2025-12-12T15:50-05:00 Built repo and ran tests: passing.

- 2025-12-12T16:02-05:00 Implemented BaseServer convenience getters: getConfig<T>(name, opts?) and getSecret<T>(name, opts?).
- 2025-12-12T16:03-05:00 Built repo and ran tests again: passing (no regressions).

Files modified/added (continued):
- src/common/base-server.ts

Files modified/added:
- tools/brat/src/cli/index.ts
- infrastructure/deploy-cloud.sh
- planning/sprint-130-ecb1a4/sprint-manifest.yaml
- planning/sprint-130-ecb1a4/implementation-plan.md
- planning/sprint-130-ecb1a4/request-log.md

Rationale:
- Align env handling with new rule: architecture.yaml env lists denote required keys, not the complete set to deploy. Cloud Run receives all overlay env vars, except those provided via Secret Manager.

- 2025-12-12T16:20-05:00 Ran validate_deliverable.sh (no PROJECT_ID): install/build/tests ran; one infra synth test suite failed; documented in verification-report.md.
- 2025-12-12T16:27-05:00 Added verification-report.md, retro.md, key-learnings.md; updated sprint-manifest.yaml to validating.
- 2025-12-12T16:33-05:00 Created PR via gh: https://github.com/cnavta/BitBrat/pull/32; updated publication.yaml and sprint-manifest.yaml (status: published).

- 2025-12-12T16:36-05:00 Plan created for CONFIG_DEFAULTS fallback in BaseServer.
- 2025-12-12T16:37-05:00 Implemented BaseServer.CONFIG_DEFAULTS and getConfig() fallback to class defaults; secrets do not use defaults.
- 2025-12-12T16:38-05:00 Ran build: success.

- 2025-12-12T16:58-05:00 Plan: migrate llm-bot to BaseServer getters and defaults (CONFIG_DEFAULTS) approved.
- 2025-12-12T17:05-05:00 Implemented llm-bot migration:
  - src/apps/llm-bot-service.ts: added CONFIG_DEFAULTS; startup now uses BaseServer.getConfig for ports; handleLlmEvent prefers BaseServer getters when available.
  - src/services/llm-bot/processor.ts: replaced process.env reads with server.getConfig/getSecret usage; passed API key to OpenAI caller; wired instance memory to server.
  - src/services/llm-bot/instance-memory.ts: accepts optional BaseServer to read limits via getConfig; backwards compatible fallback to process.env.
- 2025-12-12T17:09-05:00 Build succeeded.
- 2025-12-12T17:12-05:00 Ran validate_deliverable.sh --scope llm-bot: all 16 llm-bot test suites passed.
 - 2025-12-12T17:25-05:00 Found deploy failure due to treating K_REVISION as required overlay env var for ingress-egress.
 - 2025-12-12T17:28-05:00 Fixed brat CLI required-key validation to ignore runtime-provided keys (K_REVISION).
 - 2025-12-12T17:29-05:00 Fixed infrastructure/deploy-cloud.sh multi-service validation to skip K_REVISION when checking required keys.
 - 2025-12-12T17:31-05:00 Updated BaseServer.ensureRequiredEnv() to exclude K_REVISION from required env checks.
 - 2025-12-12T17:33-05:00 Built repo (npm run build): success.
 - 2025-12-12T17:35-05:00 Dry-run deploy via brat CLI: no missing-key error for ingress-egress; substitutions printed as expected.

 - 2025-12-12T17:16-05:00 Production error reported: Cloud Build failed with "invalid .substitutions field: substitution key '@;BOT_USERNAME'" during services deploy.
 - 2025-12-12T17:20-05:00 Root cause: unescaped commas (and equals/backslashes) inside _ENV_VARS_ARG substitution value (e.g., ALLOWED_SIGILS=!,@;...). gcloud parsed segments after comma as new substitution keys.
 - 2025-12-12T17:28-05:00 Fix applied: Escape ',', '=' and '\\' in Cloud Build substitution values; unescape inside cloudbuild.oauth-flow.yaml before using _ENV_VARS_ARG/_SECRET_SET_ARG.
 - 2025-12-12T17:31-05:00 Built repo (npm run build): success.
 - 2025-12-12T17:31-05:00 Dry-run deploy via brat CLI: substitutions now render correctly; no parsing errors.

 - 2025-12-12T17:41-05:00 Follow-up production error persisted in real deploy: Cloud Build still parsed substitution key from env var characters.
 - 2025-12-12T17:48-05:00 Implemented robust fix: pass environment KVs via file instead of substitutions.
   - tools/brat/src/cli/index.ts now writes .cloudbuild/env.<service>.kv and passes _ENV_VARS_FILE; leaves _ENV_VARS_ARG empty.
   - cloudbuild.oauth-flow.yaml prefers _ENV_VARS_FILE when present (cat file), falls back to _ENV_VARS_ARG with unescape.
 - 2025-12-12T17:52-05:00 Built repo (npm run build): success.
 - 2025-12-12T17:54-05:00 Dry-run brat deploy: substitutions include _ENV_VARS_FILE per service; _ENV_VARS_ARG is empty; no errors.
 
  - 2025-12-12T17:59-05:00 Production error: Cloud Build YAML parse failure: "expected '<document start>', but found '<block mapping start>'" at cloudbuild.oauth-flow.yaml line 4.
  - 2025-12-12T18:02-05:00 Root cause: YAML started with indented scalar keys at root (e.g., `_INGRESS`) instead of a valid top-level document; Cloud Build expects `substitutions:` map or proper document start.
  - 2025-12-12T18:06-05:00 Fix: Added top-level `substitutions:` mapping and moved `_INGRESS`, `_VPC_CONNECTOR`, and defaults (`_ENV_VARS_FILE`, `_ENV_VARS_ARG`, `_SECRET_SET_ARG`, `_ALLOW_UNAUTH`, `_DRY_RUN`, `_DOCKERFILE`) under it. Verified structure: steps and images remain at root.
  - 2025-12-12T18:10-05:00 Validation: `npm run build` OK; `npm run brat -- deploy services --env dev --project-id bitbrat-local --dry-run` prints sane substitutions per service and no YAML parse errors.
