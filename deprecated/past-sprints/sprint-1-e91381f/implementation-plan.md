# Implementation Plan – sprint-1-e91381f

## Objective
- Produce a Technical Architecture for the llm-bot service that consumes internal.llmbot.v1, uses @joshuacalpuerto/mcp-agent with OpenAI (gpt-5-mini), and returns a candidate response then advances the routing slip. No code implementation this sprint; docs and planning only.

## Scope
- In scope:
  - Technical architecture document describing service design, message schema, prompt extraction, mcp-agent integration, OpenAI provider configuration, response handling, observability, and error handling.
  - Planning artifacts per AGENTS.md: sprint manifest, request log, validation script (minimal), publication plan.
- Out of scope:
  - Actual implementation of llm-bot service logic and deployment.
  - End-to-end integration with message bus drivers beyond architectural specification.

## Deliverables
- technical-architecture.md under planning/sprint-1-e91381f/
- Minimal validate_deliverable.sh for sprint artifacts (delegated local build/test)
- Updated request-log.md with sprint activities

## Acceptance Criteria
- Architecture aligns with architecture.yaml:
  - Topic: internal.llmbot.v1
  - Env/secrets: OPENAI_API_KEY, OPENAI_MODEL=gpt-5-mini, OPENAI_TIMEOUT_MS, OPENAI_MAX_RETRIES
  - Cloud Run defaults and observability posture adhered to
- Message flow defined: prompt annotation extraction → mcp-agent call → candidate append → routing slip advance
- Bus-agnostic design compatible with MESSAGE_BUS_DRIVER abstraction
- Clear error handling and logging strategy

## Testing Strategy
- Documentation-only sprint. Validation script will run npm install, build, and tests to ensure repository health. No new tests are introduced this sprint.

## Deployment Approach
- No deployment in this sprint. Future sprints will add a Dockerfile and Cloud Build/Run configs per infrastructure guidelines. The architecture will reference Cloud Run as runtime, region/us-central1, and service defaults.

## Dependencies
- OpenAI API access (OPENAI_API_KEY)
- @joshuacalpuerto/mcp-agent NPM package availability

## Definition of Done
- All deliverables committed to a feature branch
- Validation script executes successfully locally (install, build, test)
- PR created or attempted per AGENTS.md with results recorded in publication.yaml
