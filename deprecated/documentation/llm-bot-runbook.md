llm-bot Service Runbook

Overview
- Headless worker consuming internal.llmbot.v1, extracting a prompt from annotations, invoking OpenAI via @joshuacalpuerto/mcp-agent, appending an assistant candidate, and advancing the routing slip.
- Entry: src/apps/llm-bot-service.ts
- Output: advances routing via BaseServer.next() to nextTopic or egressDestination.

Configuration
- Required: LOG_LEVEL, MESSAGE_BUS_DRIVER, NATS_URL (when MESSAGE_BUS_DRIVER=nats), BUS_PREFIX, OPENAI_API_KEY
- Optional: OPENAI_MODEL=gpt-5-mini, OPENAI_TIMEOUT_MS=30000, OPENAI_MAX_RETRIES=2, LLM_BOT_ENABLED=1

Security
- OPENAI_API_KEY provided via environment/Secret Manager and never logged.
- Logs avoid echoing raw prompts at info level.

Observability
- info: llm.invoke.start/finish, routing.next.published
- warn: llm_bot.no_prompt, llm.invoke.invalid
- error: llm.invoke.failed and unexpected exceptions
- Tracing spans: llm.process, llm.invoke (server); routing.next/complete (BaseServer)

Failure Modes
- Missing prompt: mark step ERROR code NO_PROMPT and advance
- 4xx provider: LLM_REQUEST_INVALID and advance
- 5xx/timeout/network: throw to allow redelivery

Example Input (abridged)
- v=1, correlationId set, routingSlip includes llm-bot step PENDING with nextTopic
- annotations include an entry with kind=prompt and value=<text>

Expected Output (excerpt)
- candidates includes a new entry with kind=text, source=llm-bot, text from provider, metadata.model set

Operations
- Disable: set LLM_BOT_ENABLED=0
- Health endpoints: /healthz, /readyz, /livez via BaseServer
- Local tests: MESSAGE_BUS_DRIVER=noop; mcp-agent mocked in tests

Deployment
- Dockerfile.llm-bot builds the service image
- cloudbuild.llm-bot.yaml builds, pushes, and deploys llm-bot; binds OPENAI_API_KEY from Secret Manager and sets OPENAI_* envs

Troubleshooting
- No prompt detected: ensure annotations include prompt or legacy annotations.prompt
- LLM_REQUEST_INVALID: verify model, token limits, API key
- Timeouts: increase OPENAI_TIMEOUT_MS or reduce prompt size
- No publish: ensure routingSlip nextTopic or egressDestination set by upstream router