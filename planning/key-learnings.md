# Key Learnings — Sprint 1

Date: 2025-11-05

1. Enforce repo‑root execution for all scripts to avoid brittle path assumptions across environments.
2. Favor configuration‑first flows: merge env YAMLs + secure overrides → single `.env.local` used by Compose and apps.
3. Normalize secure config parsing: accept `export`, strip quotes, expand `~`, and require absolute, space‑free paths for bind mounts.
4. Always include a `docker compose ... config` preflight to surface env_file and include path issues early.
5. Parameterize host ports by default; add preflight checks to catch conflicts and provide clear override guidance.
6. Keep emulator and infra in Compose, using service DNS names (not localhost) for in‑network communication.
7. Standardize health endpoints (`/healthz`, `/readyz`, `/livez`) and include in architecture defaults for consistency.
8. Document troubleshooting steps prominently in infra overview and planning artifacts.



# Key Learnings — Sprint 2

Date: 2025-11-07

1. Prefer config-first Cloud Run with Terraform; avoid image-not-found by ensuring GAR image exists before first apply or temporarily use a known image.
2. Set deletion_protection=false during iterative development; re-enable after stabilization to prevent accidental destroys.
3. Adopt pre-existing secrets into Terraform state to avoid recreation conflicts; keep import scripts idempotent.
4. Use connection-based GitHub repository resources for Cloud Build triggers; branch names should be anchored (e.g., ^main$) and Cloud Build connections/repos are global.
5. Consolidate operator workflows under a single orchestrator script (deploy-cloud.sh) to reduce human error and ensure repeatability.
6. Runtime env validation in the app prevents silent misconfigurations when Secret Manager bindings are missing or misnamed.



# Key Learnings — Sprint 4

Date: 2025-11-11

1. Streamed, structured logs vastly improve deploy feedback vs. buffered output; design CLIs to emit per-line context early.
2. Maintain strict packaging boundaries for admin tooling (brat) to keep runtime images lean and secure.
3. Keep secrets policy simple in early phases: resolve numeric versions and fail fast; add creation/import later if ever needed.
4. Side-by-side parity during migrations reduces risk; compare CLI outputs with incumbent scripts before switching over.
5. Prefer architecture.yaml as the single source of truth and generate substitutions/config from it to avoid drift.



# Key Learnings — Sprint 5

Date: 2025-11-11

1. Prefer SDK-first implementations with controlled gcloud fallbacks to improve testability and parity while avoiding hard deps.
2. Idempotent diffing for Cloud Build triggers prevents unnecessary updates and simplifies dry-run behavior.
3. Keep admin tooling (brat) strictly out-of-band; enforce via design and periodic checks to avoid accidental bundling.
4. Introduce infrastructure changes incrementally: start with CDKTF scaffolds that can plan without credentials-heavy data sources.
5. Strengthen CLI UX with explicit arg validation and testable command functions (parseArgs, cmdTrigger) to prevent accidental exits in tests.

# Key Learnings — Sprint 6

Date: 2025-11-11

1. Manage advanced URL Maps via YAML-first with guarded imports; avoid provider round-trip drift with ignore_changes.
2. Encode environment policies (use-existing IP/cert in prod; VPC connector enforcement) into acceptance criteria early to prevent ambiguity.
3. Keep planning artifacts executable: include validation scripts and explicit DoD to streamline sprint closure.
4. Separate design from implementation to reduce risk; lock in decisions via multi-sprint plans before writing code.
5. Document preflight enforcement and overrides (e.g., --allow-no-vpc) so CI posture is unambiguous.


# Key Learnings — Sprint 7

Date: 2025-11-13

1. Plan-only sprints benefit from adding a verification-report before closure to ensure parity with the approved scope and DoD.
2. Publication constraints (PR creation) should be validated early; if unavailable, use a documented deferment with compare links in publication.yaml.
3. Keep CDKTF scaffolding and CI wiring as architecture.yaml-first plans to avoid configuration drift and duplication.
4. Enforce artifact presence with a sprint-level validate_deliverable.sh; this reduces risk of missing documents during reviews.
5. Maintain strict separation between dry-run/plan and apply in both CLI and CI designs; document guard rails explicitly.


# Key Learnings — Sprint 8

Date: 2025-11-13

1. Zero-resource CDKTF synth allows CI validation without provisioning, reducing risk while establishing structure.
2. Apply operations must be explicitly guarded in both CLI and CI; refusing apply in CI prevents accidental changes.
3. Cloud Build images may lack Terraform; provide a dedicated infra-plan pipeline or custom builder image to ensure parity.
4. Keep architecture.yaml as the authoritative source; synth and CLI wiring should derive configuration from it.
5. Automate publication steps (branch/PR) in future sprints to fully satisfy Sprint Protocol S11–S13 without manual intervention.


## 2025-11-14 — Sprint 9
- Streaming Terraform output is essential for operator confidence; keep it on by default
- Guaranteeing an outputs.json artifact after apply attempts reduces support overhead
- Clear placeholder signaling for modules (like lb) prevents expectation drift


# Key Learnings — Sprint 10

Date: 2025-11-14

1. Describe-only preflight enforcement provides safety in CI while still preventing misconfigured deployments; block overrides in CI and allow explicit local bypass for dev.
2. Isolate Serverless VPC Access connector synthesis from network stack to simplify ownership and outputs; document /28 CIDR defaults and API enablement clearly.
3. Add connectors to CI dry-run planning early to catch regressions across modules (network, lb, connectors) with one pass.
4. Guarantee Terraform outputs capture after apply attempts; always emit an outputs.json (or a helpful error payload) to aid troubleshooting.
5. Maintain architecture.yaml-first derivation for regions and names to avoid duplication and drift across stacks and preflights.


# Key Learnings — Sprint 11

Date: 2025-11-15

1. YAML-first URL Map with guarded import avoids Terraform provider gaps and eliminates churn via lifecycle ignore_changes.
2. Keep architecture parsing permissive (.passthrough) to preserve forward-looking top-level keys like infrastructure.
3. Renderer must read from architecture.yaml canonical path (infrastructure.resources['main-load-balancer'].routing) with legacy fallback to reduce fragility.
4. Structural diff normalization should drop ephemeral fields (fingerprint, timestamps) and sort arrays/keys for stable comparisons.
5. CI should render and import with --dry-run per env; start with dev and extend to staging to catch drift early without mutating state.


# Key Learnings — Sprint 13

Date: 2025-11-15

1. Planning-only sprints still require executable artifacts: verification-report.md and retro.md streamline closure and enforce parity with the approved scope.
2. Publication scaffolding (publication.yaml with compare link) provides traceability when external PR creation is manual; mark status=open and validated=true at closure.
3. Strengthening sprint validators to check all artifacts (including verification and retro) prevents incomplete sprint closure.
4. Keep all infra guidance strictly architecture.yaml-driven; defer runtime mutations to future sprints but encode inputs/outputs and orchestration now.
5. Update planning/index.md immediately after adding artifacts to maintain navigability and reduce reviewer friction.


# Key Learnings — Sprint 14

Date: 2025-11-15

1. Dry-run parity between CI and local validation reduces integration risk; wire the exact same commands and parameters.
2. Hoisting shared helpers in bash scripts prevents scope-related failures in parallel/multi-service paths; prefer top-level definitions.
3. Publication artifacts (publication.yaml + manifest publication block) should be updated during closure to satisfy S11–S13 traceability rules.
4. Include a minimal “doctor” step in CI to validate tooling presence (Terraform, gcloud) early and fail fast with actionable guidance.
5. When external constraints prevent full validation (e.g., live project access), document deferrals clearly in verification-report.md and carry forward items explicitly.
