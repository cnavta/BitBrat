# Technical Architecture — llm-bot Service (Sprint 1)

## Objective
- Define how the llm-bot service consumes internal.llmbot.v1 events, extracts a prompt from annotations, invokes @joshuacalpuerto/mcp-agent with OpenAI (gpt-5-mini), appends the response as a candidate, and advances the routing slip.

## Context and Constraints
- Architecture source of truth: architecture.yaml
- Runtime: Cloud Run (Node 24.x)
- Message bus: abstracted by existing MESSAGE_BUS_DRIVER (NATS, Pub/Sub, noop) — llm-bot must be driver-agnostic
- Observability: Cloud Logging/Monitoring defaults; tracing optional off by default

## Message Model
- Envelope: InternalEventV2 (as used in repository)
  - fields used by llm-bot:
    - correlationId: string
    - traceId/traceparent in attributes
    - routingSlip?: RoutingStep[]
    - egressDestination?: string
    - annotations?: { prompt?: string, [k: string]: any }
    - message?: { candidates?: Array<{ id?: string, role?: string, content: string, model?: string, source?: string, createdAt?: string }>, [k: string]: any }

## High-Level Flow
1. Subscription: consume internal.llmbot.v1 messages
2. Prompt selection: prefer event.annotations.prompt
   - Fallbacks (future): derive from message content if prompt missing (out of scope in Sprint 1)
3. LLM invocation via mcp-agent
   - Provider: OpenAI with OPENAI_API_KEY
   - Model: OPENAI_MODEL default gpt-5-mini
   - Timeout/retries: OPENAI_TIMEOUT_MS/OPENAI_MAX_RETRIES
4. Response handling
   - On success: push candidate to event.message.candidates[] with metadata {role: "assistant", content, model, source: "llm-bot"}
   - On failure: see Error Handling
5. Advance routing
   - Use existing routing helpers (or publish to next step subject); when slip exhausted, publish to egressDestination if present

## mcp-agent Integration
- Library: @joshuacalpuerto/mcp-agent
- Initialization:
  - Create an Agent instance configured with OpenAI provider and model
  - Inject logger facade to align with platform logging
- Invocation shape (conceptual):
  - const result = await agent.prompt({ systemPrompt?, user: promptText, options: { model, maxTokens?, temperature? }})
  - Extract text response from result

## Configuration
- Secrets: OPENAI_API_KEY
- Environment variables:
  - OPENAI_MODEL=gpt-5-mini
  - OPENAI_TIMEOUT_MS=30000 (example default)
  - OPENAI_MAX_RETRIES=2 (example default)
- Message bus envs already managed at platform level (MESSAGE_BUS_DRIVER, NATS_URL, BUS_PREFIX)

## Error Handling
- Missing prompt
  - Mark current routing step status=ERROR with code NO_PROMPT and advance to next
  - Include error in step.error and log warn
- OpenAI/mcp-agent errors
  - 5xx/timeout/network: throw to trigger redelivery (at-least-once); rely on bus backoff
  - 4xx auth/validation: mark step ERROR with code LLM_REQUEST_INVALID and advance
- Publishing errors
  - Throw; let subscriber redeliver; ensure idempotency by not appending duplicate candidates when retried (check last candidate content+correlation)

## Observability
- Logging
  - info: start/finish LLM call, publish next hop
  - warn: missing prompt, non-fatal issues
  - error: provider or publish exceptions
- Tracing
  - Span: llm.invoke, routing.next
  - Inject/propagate traceparent to published attributes

## Security
- OPENAI_API_KEY from Secret Manager; not logged
- Deny prompt injection of secrets by avoiding echoing environment values in prompts

## Sequence (Textual)
1. llm-bot subscriber receives event E on internal.llmbot.v1
2. Extract P = E.annotations.prompt
3. Call mcp-agent with P and model M
4. Receive R (text)
5. Append candidate C = {role: assistant, content: R, model: M, source: llm-bot}
6. Publish E' to next routing subject (or egressDestination)

## Compatibility & Abstractions
- Bus-agnostic by using existing message-bus publish/subscribe factories
- Candidate schema stored within event.message.candidates preserving backward compatibility

## Risks & Mitigations
- Provider limits or latency: use timeouts/retries; limit token sizes
- Duplicate candidates on retry: compute idempotency key (hash of prompt+correlationId) stored in step.attributes to guard appends

## Acceptance Alignment
- Uses internal.llmbot.v1 per architecture.yaml
- Uses gpt-5-mini via OpenAI with mcp-agent
- Appends candidate and advances routing slip
- Driver-agnostic design
