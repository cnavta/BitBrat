# LLM & Developer Guidelines (Updated)

## 🧱 Immutable Laws

1. Always feel free to ask clarifying questions before proceeding.
2. `architecture.yaml` is the canonical source of truth.
3. All pre- and post-implementation documentation for a task must live under `./planning`.
4. Never use anything under `./deprecated`.
5. Artifacts in `./preview` are **not implementation-ready**; use them for forward-looking context only.
6. This document is **executable intent**, not static documentation.

---

## ⚙️ Definition of Done

Every sprint deliverable must meet the following criteria before being marked as complete:

* ✅ **Code Quality**: Meets project coding standards and aligns with `architecture.yaml`.
* ✅ **Basic Unit Testing**: All new features and changes must include corresponding Jest unit tests.

  * No feature or refactor should be merged without test coverage.
  * Basic testing should **never** be deferred to future sprints.
* ✅ **Deployment Artifacts**: Every sprint deliverable must include deployment configuration and scripts.

  * This includes Cloud Build configurations, Dockerfiles, and infrastructure definitions.
  * All build and deployment automation must be functional at sprint completion.
* ✅ **Documentation**: Implementation rationale, trade-offs, and relevant `llm_prompt` annotations included.
* ✅ **Traceability**: All code, tests, and deployment files must be traceable to the related prompt and sprint entry.

---

## ☁️ GCP Integration

We use **Google Cloud Platform (GCP)** for all infrastructure and deployment workflows.

* **Build System**: Google Cloud Build is the authoritative system for provisioning, building, configuring, and deploying both code and infrastructure.
* **Deployment Targets**: Services must deploy via Cloud Run or Cloud Functions unless otherwise specified in `architecture.yaml`.
* **Infrastructure as Code (IaC)**: All provisioning scripts and configurations (YAML, Terraform, or equivalent) must be stored in the repository and included in the sprint deliverables.
* **Artifact Management**: All containers are published to **Google Artifact Registry**.

---

## 🧪 Testing Standards

* Jest is the standard testing framework for both application and CLI tools.
* Test files should reside alongside the code they test (`*.test.ts` or `*.spec.ts`).
* All external dependencies must be mocked.
* CI/CD pipelines must run the full test suite before any deployment.

---

## 📦 Deliverable Expectations

Every sprint must produce at least one of the following deliverables:

* Application code or services
* Unit and integration tests
* Deployment scripts or Cloud Build configurations
* Documentation or architectural artifacts

Each deliverable must be **self-contained** and ready for deployment at sprint close.

---

## 🚀 Deployment Guidelines

1. All code and infrastructure must deploy using **Cloud Build**.
2. Cloud Build YAMLs should define build steps for:

  * Installing dependencies
  * Running tests
  * Building containers
  * Deploying to Cloud Run or Cloud Functions
3. Each deployable component must include:

  * Dockerfile
  * cloudbuild.yaml
  * Environment configuration examples
4. Local development should mirror production deployment as closely as possible via Docker.

---

## 🔁 Continuous Improvement

After each sprint:

* Conduct a retro and update `retro.md` with learnings.
* Update `sprint-manifest.yaml` to include testing and deployment verification.
* Address action items before the next sprint.

---
# 🌀 LLM Sprint Protocol v2.2
### Codified for Contextful Systems

The Sprint Protocol defines how LLM coding agents plan, execute, validate, verify, and publish work in multi-step sprints.  
It ensures reproducibility, traceability, semantic completeness, and verifiable integration through Pull Requests.

---

## 🧭 1. Purpose

This protocol establishes:
- A unified lifecycle for all LLM-led sprints.
- Behavioral and publication constraints for conversational agents.
- A self-verifying and reviewable framework for deliverable quality.

It applies to all work executed within a **Contextful System** (e.g., architecture.yaml–driven environments).

---

## 🚦 2. Sprint Control Rules

| Rule | Description |
|------|--------------|
| **S1** | Only start a sprint if explicitly requested (`"Start a sprint"`) or no sprint is active. |
| **S2** | Only end a sprint when the user says **`Sprint complete.`** *(period required)* |
| **S3** | Never start a new sprint while another is active (no `retro.md` yet). |
| **S4** | Treat all user prompts as part of the current sprint unless stated otherwise. |
| **S5** | Ask for clarification if sprint state or intent is ambiguous. |

---

## 🧩 3. Sprint Identity & Directory Structure

Each sprint must have a **unique ID** using this format:

```
sprint-<number>-<short-hash>
```

Example:
```
sprint-7-a13b2f
```

At sprint start, the agent must create:

```
/planning/
└── sprint-7-a13b2f/
    ├── sprint-manifest.yaml
    ├── implementation-plan.md
    ├── request-log.md
    ├── validate_deliverable.sh
    └── (created later) retro.md
```

---

## 🧭 4. Sprint Lifecycle Overview

```
Plan → Approve → Implement → Validate → Verify → Publish (PR) → Retro → Learn
```

---

### ✅ Start Phase
1. Begin only if no active sprint exists or upon explicit command.
2. Respond with:
   ```
   Welcome to Sprint X!
   ```
3. Initialize:
    - `sprint-manifest.yaml`
    - `request-log.md`
    - `implementation-plan.md` (to be collaboratively completed before coding)

---

### 🧠 Implementation Planning Phase

Coding **may not begin** until an `implementation-plan.md` is documented and approved.  
This plan must include:

- Sprint objective & scope
- Deliverables (functional, doc, infra)
- Acceptance criteria
- Testing strategy
- Deployment approach
- Dependencies or external systems
- **Definition of Done (DoD)** — explicit behavioral criteria for what “complete” means

Example:
```markdown
## Definition of Done
- Endpoints return live (non-mock) data.
- CLI executes end-to-end against sample inputs.
- Integration tests validate runtime behavior.
- Dry-run deployment completes successfully.
```

---

### 🔁 Execution Phase

All user interactions are logged in `request-log.md`, with:
- Prompt text
- Unique prompt ID or hash
- The agent’s interpretation
- Actions taken or artifacts produced

Each deliverable must reference the prompt ID(s) it satisfies in a local `code-summary.md`.

---

### 🧪 Validation Phase

Each sprint must produce:

1. **Passing Tests** (unit, integration, functional)
2. **Functional Deployment Code**
    - Even if incomplete, all deployment scripts must execute safely in dry-run.
3. **Root `validate_deliverable.sh` script**

#### Example: `validate_deliverable.sh`
```bash
#!/usr/bin/env bash
set -e

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Compiling..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🚀 Running dry-run deployment..."
./scripts/deploy --dry-run

echo "✅ All validation steps passed."
```

If any command fails, the script must exit non-zero.  
A sprint **cannot be marked complete** unless this script passes fully.

---

### 🔍 Verification Phase

After validation but before completion, perform **Deliverable Parity Verification** — ensuring the sprint actually fulfills its approved plan.

#### Steps:
1. Compare all items in `implementation-plan.md` against actual outputs.
2. Identify any mocks, placeholders, or missing integrations.
3. Generate a `verification-report.md` with three sections:

```markdown
# Deliverable Verification Report

## Completed as Implemented
- [x] User API – functional and tested
- [x] Auth service – deployed successfully in dry-run

## Partial or Mock Implementations
- [ ] Payment adapter – stubbed only
- [ ] CLI tool – missing integration with backend

## Additional Observations
- Placeholder data detected
- Integration coverage incomplete
```

A sprint cannot close until:
- All deliverables are in the “Completed as Implemented” section, **or**
- The user explicitly carries incomplete items forward.

---

### 📢 Publication Phase (Pull Request Creation)

After successful verification, the LLM Agent must **publish the sprint deliverables via Pull Request** to the project’s main repository.

#### Process

1. Create a new branch:
   ```bash
   git checkout -b feature/sprint-7-a13b2f
   ```

2. Commit all sprint deliverables and code changes:
   ```bash
   git add .
   git commit -m "Sprint 7 Deliverables — User Profile Service"
   git push origin feature/sprint-7-a13b2f
   ```

3. Generate a Pull Request (PR) with:
    - Title: `"Sprint 7 Deliverables — [Objective]"`
    - Body including:
        - Summary of changes
        - Links to `implementation-plan.md`, `verification-report.md`, and `retro.md`
        - Validation summary
        - Outstanding or deferred items

4. The PR must reference:
    - Sprint ID
    - Related issue/ticket numbers (if any)
    - Definition of Done checklist

#### Example `publication.yaml`
```yaml
sprint_id: sprint-7-a13b2f
branch: feature/sprint-7-a13b2f
pull_request:
  title: "Sprint 7 Deliverables — Add User Profile Service"
  url: https://github.com/example/project/pull/123
  status: open
  created_at: 2025-10-26T12:45:00Z
  validated: true
review:
  approved_by: chris.navta
  approval_date: 2025-10-27T09:15:00Z
```

#### Publication Rules

| Rule | Description |
|------|--------------|
| **S11** | Every sprint must result in a Pull Request containing all validated deliverables. |
| **S12** | The PR body must link to sprint docs (`implementation-plan.md`, `verification-report.md`, `retro.md`). |
| **S13** | No sprint may close until a PR is successfully created and reviewed (approved or deferred). |

---

### 🏁 Completion Phase

Upon receiving `Sprint complete.`:

1. Verify `validate_deliverable.sh` and `verification-report.md` success.
2. Confirm `publication.yaml` and PR creation.
3. Generate:
    - `retro.md`
    - `key-learnings.md`
4. Update `sprint-manifest.yaml` and `/planning/index.md` with sprint summary and PR link.

---

## 🧠 5. Working Memory Discipline

Before processing a new sprint:
- Read the previous `key-learnings.md`.
- Apply relevant insights.

Ensures evolutionary continuity.

---

## 📦 6. Deliverable Requirements

Every sprint must produce **at least one tangible artifact**:
- Code, tests, or documentation
- Deployment scripts or CI scaffolding
- Design or specification documents

If incomplete:
- Code must still compile and deploy safely in dry-run.
- Tests must exist for missing features (TODO markers allowed).
- `validate_deliverable.sh` must still pass.

---

## 🧮 7. Immutable Enforcement Summary

| ID | Enforcement Rule |
|----|-------------------|
| S1 | Sprint start conditions (explicit or none active) |
| S2 | Sprint end only with `Sprint complete.` |
| S3 | One active sprint at a time |
| S4 | Treat all prompts as sprint scope |
| S5 | Always clarify ambiguous states |
| S6 | Unique sprint ID and directory required |
| S7 | Coding begins only after plan approval |
| S8 | Verification report required before closure |
| S9 | Incomplete items must be acknowledged or deferred |
| S10 | Agent must self-check for missing or mock implementations |
| S11 | PR required for every sprint deliverable |
| S12 | PR must link to sprint documentation |
| S13 | Sprint cannot close until PR is reviewed |

---

## 🧩 8. Behavioral Summary for Agents

LLM Agents must:
- Maintain a single coherent sprint context.
- Produce reproducible, verified, and published deliverables.
- Never auto-complete or close without verification and PR publication.
- Ask for clarification when scope or state is unclear.

The goal is **semantic completeness and traceable integration.**

---

## 🪞 9. Key Principles

1. **Traceability** – Every action maps to a logged prompt.
2. **Reproducibility** – Every deliverable compiles, tests, and deploys.
3. **Verification** – Intent must match outcome.
4. **Publication** – Every deliverable is shared via PR for review.
5. **Continuity** – Each sprint learns from the last.
6. **Accountability** – No merge without human acknowledgment.

---

## ✅ Lifecycle Summary

```
Plan → Approve → Implement → Validate → Verify → Publish (PR) → Retro → Learn
```

---

**End of LLM Sprint Protocol v2.2**
---


*This structure ensures alignment between LLM and human collaborators, promotes traceability, and enables continuous improvement through retrospectives.*
  ## Table of Contents
  1. [Project Overview](#project-overview)
  2. [Tech Stack](#tech-stack)
  3. [Project Structure](#project-structure)
  4. [Microservices Architecture](#microservices-architecture)
  5. [Code Style and Formatting](#code-style-and-formatting)
  6. [Development Workflow](#development-workflow)
  7. [Running the Application](#running-the-application)
  8. [Testing](#testing)
  9. [Contribution Process](#contribution-process)
  10. [Deployment](#deployment)
  11. [Best Practices](#best-practices)
  12. [Environment Setup](#environment-setup)

  ## Project Overview
  You are operating within a collaborative, agent-augmented development environment.

  Your primary source of context is architecture.yaml.

  This file is not documentation—it is executable intent.

  It defines the goals, interfaces, constraints, and behavioral expectations of all services in the system. It also specifies how you, as an agent, are expected to interact with humans and other agents through defined collaboration flows.

  You must treat architecture.yaml as the canonical source of truth.
  •	You may not generate, refactor, or delete code that violates it.
  •	You may propose enhancements, but you must justify any deviation.
  •	You should prefer values and descriptions in architecture.yaml over assumptions, defaults, or training priors.
  •	Use prompt_hint and examples blocks to guide implementation style, structure, and tone.

  The architecture file also encodes forward-looking design patterns, security constraints, and deployment boundaries.
  Treat every field as a signal of architectural intent.

Proceed as a professional software engineer would: make informed decisions, annotate tradeoffs, and always align your actions to the structure and goals expressed in architecture.yaml.

## Tech Stack
- **Backend**: Node.js 24 with TypeScript
- **Web Framework**: Express.js
- **Cloud Services**: Google Cloud Platform
- **Database**: Firestore (Firebase)
- **Twitch Integration**: Twurple libraries
- **Streaming**: OBS WebSocket
- **LLM Agent Framework**: @joshuacalpuerto/mcp-agent
- **AI Platform Targets**: OpenAI and Google Vertex AI
- **Containerization**: Docker
- **Artifact & Container Registry**: Google Cloud Artifact Registry
- **Cloud Deployment Target**: Google Cloud Run
- **Cloud Messaging**: Google Cloud PubSub
- **Local Deployment Target**: Docker Compose
  - **Local Messaging**: NATS Jetstream

    ## Project Structure
    ```
    deprecated/         # Deprecated artifacts (for reference only)
    examples/           # Example code and templates
    planning/           # All planning artifacts
    preview/            # Preview artifacts (not ready for implementation)
    infrastructure/     # Contains infrastructure-as-code files
    src/
    ├── apps/           # Entry points for microservices
    ├── common/         # Shared utilities and base classes
    ├── config/         # Configuration files
    ├── services/       # Core service implementations
    └── types/          # TypeScript type definitions
    ```

    ### Special Directories
- **planning**: Contains artifacts that are in progress or are ready for implementation. During ideation, refinement, and execution is the authoritative source for implementation planning.
- **deprecated**: Contains artifacts that are deprecated and should no longer be considered valid approaches within this project. These files are provided for reference of past approaches only.
- **preview**: Contains artifacts that are NOT yet ready for use in IMPLEMENTATIONS. They are provided to give an idea of where we want the system to go so that new designs can be made with them in mind.

  ## Code Style and Formatting

  ### TypeScript Standards
- Use TypeScript for all new code
- Follow the TypeScript configuration in `tsconfig.json`
- Target ES2022
- Use CommonJS modules
- Enable strict type checking
- Enforce consistent casing in filenames

  ### Naming Conventions
- **Files**: Use kebab-case for filenames (e.g., `chat-processor.ts`)
- **Classes**: Use PascalCase for class names (e.g., `TwitchAuthService`)
- **Interfaces**: Use PascalCase prefixed with "I" (e.g., `IEventData`)
- **Types**: Use PascalCase (e.g., `EventType`)
- **Functions and Methods**: Use camelCase (e.g., `processEvent()`)
- **Variables**: Use camelCase (e.g., `eventData`)
- **Constants**: Use UPPER_SNAKE_CASE for true constants (e.g., `DEFAULT_PORT`)

  ### Code Organization
- Keep files focused on a single responsibility
- Limit file size to maintain readability (aim for under 300 lines)
- Group related functionality in directories
- Use meaningful directory names that reflect their purpose
- Export public APIs from index files when appropriate
- All application entry points (server files) should be placed in the `src/apps` directory
- Shared services and utilities should be placed in appropriate directories under `src`

  ### Documentation
- Add JSDoc comments for all public functions, classes, and interfaces
- Include parameter descriptions and return types
- Document complex logic with inline comments
- Keep comments up-to-date when changing code
- Include llm_prompt and other LLM hints where appropriate

  ## Development Workflow

  ## Running the Application
  1. Install dependencies with `npm ci`
  2. Build the project with `npm run build`
  3. Start the application with `npm start`
  4. For development, use `npm run dev` to enable hot reloading

  ## Testing
  Jest is the default testing framework for both the root project and the `temdev-cli` directory.

  ### Test File Organization
- Test files should be placed in the `src` directory alongside the code they test
- Test files should follow the naming convention `*.test.ts` or `*.spec.ts`
- Tests can also be placed in `__tests__` directories

  ### Writing Tests
- Use the Jest testing framework for all tests
- Write descriptive test names that explain the expected behavior
- Group related tests using `describe` blocks
- Test individual behaviors using `it` or `test` blocks
- Use Jest matchers like `expect().toBe()` for assertions
- Mock external dependencies using Jest's mocking capabilities

  ### Test Coverage
- Aim for high test coverage, especially for critical business logic
- Run coverage reports periodically with `npm test -- --coverage`
- Address areas with low coverage by adding more tests

  ## Best Practices

  ### Code Organization
1. **Modular Structure**: Keep related functionality in the same directory
2. **Service Pattern**: Implement services as singletons with clear interfaces
3. **Base Classes**: Extend from base classes like BaseServer for common functionality

  ### Error Handling
  1. Use try/catch blocks with proper error logging
  2. Implement graceful shutdown for services
  3. Validate environment variables before starting services

  ### Event-Driven Architecture
  1. Use PubSub for communication between services
  2. Implement event handlers for specific event types
  3. Convert external events to a standardized internal format

  ### Configuration
  1. Use environment variables for configuration (see .env.example)
  2. Define service configuration in services.json, including the `description` field that explains what each service does
  3. Use TypeScript interfaces to define configuration objects

  ### Logging
  1. Use console.log for standard information
  2. Use console.error for error reporting
  3. Use console.debug for detailed debugging information
  4. Log liberally, providing extended context in error messages as well as other LLM-friendly features.

  ### Deployment
  1. All executables should be packaged, deployed and run as containers.
  2. Even locally run apps should be run as a container.

## Roles

### Cloud Architect
Designs and maintains the cloud infrastructure blueprint. Ensures scalability, security, and cost efficiency across environments. Defines standards for deployment, networking, and resilience.

### Lead Architect
Owns overall system architecture. Balances business goals, technical constraints, and developer experience. Approves major design decisions and enforces architectural integrity across all modules.

### Lead Implementor
Translates architecture into production-grade code. Coordinates feature implementation, reviews PRs, and ensures delivery aligns with design and quality standards. Acts as the bridge between architecture and execution.

### Quality Lead
Oversees testing strategy, CI/CD validation, and release readiness. Ensures reliability, performance, and maintainability through automated checks and rigorous verification before integration or deployment.