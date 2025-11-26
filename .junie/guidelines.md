# AGENTS.md — LLM & Developer Guidelines v2.4 (Git-Enabled Release)

## 🧱 0. Precedence & Scope

These rules define exactly how LLM agents and human developers collaborate in this repository.

### **Precedence Order**
1. `architecture.yaml` — canonical source of truth for system behavior  
2. `AGENTS.md` — operational and behavioral rules for agents  
3. Everything else — examples, legacy docs, and supporting materials

If a conflict ever occurs:
> **`architecture.yaml` wins.**  
Agents must surface the conflict, then align to it.

---

## 🧠 Capabilities

Agents **ARE allowed** to:

- Execute shell commands  
- Interact with git (checkout, branch creation, committing, pushing)  
- Create and push feature branches  
- Create GitHub Pull Requests (via GitHub CLI or API)

Agents MUST:

- Log every meaningful shell and git operation into `request-log.md`  
- Operate only within the repository provided  
- Halt and request updated credentials if any authentication step fails  
- Report command results transparently

---

# 🧱 1. Immutable Laws

1. **Ask for clarification when needed. Proceed when not.**  
2. **Never violate `architecture.yaml`.** Suggest changes only with justification.  
3. **All sprint planning and output artifacts live in `./planning`.**  
4. **Never use or depend on `./deprecated`.**  
5. **Artifacts in `./preview` are directional only, not implementation-ready.**  
6. **This document is executable intent.** Everything must be:  
   - Traceable  
   - Reproducible  
   - Reversible  

---

# 🌀 2. LLM Sprint Protocol

This protocol governs every LLM-led sprint.

```
Plan → Approve → Implement → Validate → Verify → Publish (PR) → Retro → Learn
```

It ensures reproducibility, reviewability, and continuous improvement.

---

## 🧭 2.1 Sprint Control Rules

| Rule | Description |
|------|-------------|
| **S1** | A sprint begins only when the user explicitly says **“Start sprint”**. |
| **S2** | A sprint ends only when validation passes *and* the user says **“Sprint complete.”** |
| **S3** | Only one sprint may be active at a time. |
| **S4** | Prompts related to this repo are included in sprint scope unless the user specifies otherwise. |
| **S5** | If sprint state is unclear, ask once, then proceed with best judgment. |

---

# 🚀 2.2 Sprint Start

When a sprint starts, the agent MUST:

1. **Generate a sprint ID**
   ```
   sprint-<number>-<short-hash>
   ```
2. **Create the sprint directory**
   ```
   planning/sprint-<id>/
   ```
3. **Create a new feature branch**
   ```
   git checkout -b feature/<sprint-id>-<short-description>
   ```
4. **Log the action in `request-log.md`**

Example:
```
git checkout -b feature/sprint-7-a13b2f-user-profile-service
```

---

# 🧩 2.3 Sprint Directory Structure

```
planning/
  sprint-7-a13b2f/
    sprint-manifest.yaml
    implementation-plan.md
    request-log.md
    validate_deliverable.sh
    verification-report.md
    publication.yaml
    retro.md
    key-learnings.md
```

This directory is the single authoritative source of truth for every sprint.

---

# 📝 2.4 Planning Phase — *Coding Forbidden Until Approved*

Before ANY implementation begins:

- The agent generates `implementation-plan.md`
- The user must explicitly approve it

### Required contents:

```markdown
# Implementation Plan – sprint-X-Y

## Objective
- Clear user-approved sprint goal.

## Scope
- What is in scope
- What is out of scope

## Deliverables
- Code changes
- Tests
- Deployment & CI artifacts
- Documentation

## Acceptance Criteria
- Verifiable, observable behavioral outcomes

## Testing Strategy
- Unit test and integration test approach

## Deployment Approach
- Cloud Build, Cloud Run, or other targets
- Referencing architecture.yaml where applicable

## Dependencies
- External systems, credentials, services

## Definition of Done
- MUST reference project-wide DoD unless explicitly overridden
```

---

# ⚙️ 2.5 Execution Phase

Every user prompt relevant to the sprint MUST be logged in `request-log.md`:

- Timestamp  
- Prompt summary  
- Interpretation  
- Shell/git commands executed  
- Files modified or created  

Optional:  
`code-summary.md` mapping files → request IDs.

---

# 🧪 2.6 Validation Phase — *Mandatory Real Build + Test*

Every sprint MUST include a **real, executable** `validate_deliverable.sh` script.

This script MUST:

1. Install dependencies  
2. Build the project  
3. Run the test suite  
4. Start local runtime (if applicable)  
5. Perform health checks (manual or scripted)  
6. Shut down local runtime  
7. Run Cloud Build/Cloud Run dry-run deployment (if defined)

### Required script shape:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running tests..."
npm test        # MUST pass

echo "🏃 Starting local environment..."
npm run local || true

echo "📝 Healthcheck..."
# Script/test/endpoint-based check recommended

echo "🧹 Stopping local environment..."
npm run local:down || true

echo "🚀 Cloud dry-run deployment..."
npm run deploy:cloud -- --dry-run || true

echo "✅ Validation complete."
```

### Critical rule:
> **A sprint cannot close unless the code created during the sprint builds and tests cleanly using this script.**

---

# 🔍 2.7 Verification Phase

`verification-report.md` must summarize:

- Completed items  
- Partial implementations  
- Deferred items  
- Deviations from the implementation plan  

Example:

```markdown
# Deliverable Verification – sprint-X-Y

## Completed
- [x] Twitch event handler implemented
- [x] Tests created
- [x] Cloud Build config added

## Partial
- [ ] Observability integration (stubbed)

## Deferred
- [ ] Multi-region deployment

## Alignment Notes
- Added health endpoint not originally specified
```

---

# 🔀 2.8 Publication Phase — *Real GitHub PR Required*

At the end of implementation and verification:

### The agent MUST:

1. Add all changed files  
2. Commit using a sprint-specific message  
3. Push the feature branch to GitHub  
4. Create a real Pull Request using:

```
gh pr create \
  --title "Sprint <id> Deliverables – <summary>" \
  --body "Generated by LLM agent according to Sprint Protocol v2.3."
```

If `gh` authentication fails:

- Stop immediately  
- Log the failure  
- Ask for updated credentials or API token  

### PR Requirements

| Rule | Description |
|------|-------------|
| **S11** | A new feature branch MUST be created at sprint start. |
| **S12** | A GitHub Pull Request MUST be created at sprint completion. |
| **S13** | The sprint cannot close until the PR URL is confirmed. |

`publication.yaml` should contain:

```yaml
pr_url: https://github.com/...
branch: feature/sprint-X-Y-...
status: created
```

---

# 🏁 2.9 Sprint Completion

A sprint officially completes when:

1. `validate_deliverable.sh` passes  
2. `verification-report.md` exists  
3. PR is created  
4. PR URL is stored in `publication.yaml`  
5. The user says:

```
Sprint complete.
```

Then the agent generates:

- `retro.md` — what worked, what didn’t  
- `key-learnings.md` — lessons for future sprints  

---

# 🧮 3. Project-Wide Definition of Done (DoD)

A deliverable is “Done” only if:

### ✅ Code Quality
- Adheres to project and architecture.yaml constraints  
- No TODOs or placeholder logic in production paths

### ✅ Testing
- Jest tests for all new behavior  
- Mocks for external dependencies  
- `npm test` must pass  
- Test deferral requires explicit user approval

### ✅ Deployment Artifacts
If applicable:
- Dockerfile  
- Cloud Build YAML  
- Cloud Run configs  
- IaC  
These must integrate with `validate_deliverable.sh`

### ✅ Documentation
- Rationale, trade-offs, and notes  
- LLM hints (`llm_prompt`) where beneficial

### ✅ Traceability
All code changes trace back to:
- A sprint  
- A request ID in `request-log.md`

---

# ☁️ 4. GCP Integration Rules

- Cloud Run is default runtime  
- Cloud Build governs all builds and deployments  
- Artifact Registry stores all images  
- IaC lives under `infrastructure/`  
- Deployment configs should be reusable templates  

---

# 🧪 5. Testing Standards

- Jest required  
- Tests live beside code or in `__tests__/`  
- High coverage encouraged  
- External services mocked  
- Tests must run as part of validation  

---

# 📦 6. Deliverable Types

Every sprint must produce at least one:

- Code artifact  
- Tests  
- Deployment scripts  
- Architecture documentation  

And all outputs must:

- Build  
- Test  
- Integrate with the validation pipeline  

---

# 🧱 7. Project Structure

```
deprecated/      # Historical reference only
examples/        # Useful templates
planning/        # Sprint artifacts (authoritative)
preview/         # Visionary, non-binding artifacts
infrastructure/  # IaC, Cloud Build, Terraform files
src/
  apps/          # Service entrypoints
  common/        # Shared utilities
  config/        # Configuration
  services/      # Core microservices
  types/         # Shared types
```

---

# 🎯 8. Code Style Rules

- TypeScript everywhere  
- kebab-case filenames  
- PascalCase classes and interfaces  
- camelCase functions and variables  
- UPPER_SNAKE_CASE constants  

Logging:

- Always log through a logging facade if possible
- `info` for useful info  
- `error` for errors  
- `debug` for deep insight  
- Log all network + filesystem operations with context  

---

# 🧯 9. Error Handling & Events

- Strong try/catch discipline  
- Graceful shutdown of services  
- Validate environment variables  
- Use Pub/Sub for service communication  
- Normalize external events to internal schema  

---

# 👥 10. Collaboration Roles

- **Cloud Architect**  
- **Lead Architect**  
- **Lead Implementor**  
- **Quality Lead**  

(These describe responsibility domains—not rigid titles.)

---

# 🧠 11. Sprint Lifecycle Summary

```
Plan → Approve → Implement → Validate → Verify → Publish (PR) → Retro → Learn
```

The system is designed for:

- High traceability  
- Rigor  
- Iterative improvement  
- Human oversight  

---

# End of AGENTS.md
