    # Technical Architecture: Query Analyzer (Llama Sentry)

## Overview
The `query-analyzer` service acts as a high-speed, cost-effective pre-processor for events intended for LLM consumption. By using a local Llama-3 model (via Ollama), it enriches events with metadata (annotations) that help downstream services like `llm-bot` make better routing and model selection decisions.

## Architectural Components

### 1. Service Role
- **Middleware**: Positioned between `event-router` and `llm-bot`.
- **Enricher**: Adds `intent`, `tone`, and `risk` annotations to the `InternalEventV2`.
- **Short-Circuiter**: Can terminate the routing slip early using `BaseServer.complete()` for simple or rejected (spam) queries.

### 2. Data Flow
1. `event-router` publishes to `internal.query.analysis.v1`.
2. `query-analyzer` consumes the event.
3. `query-analyzer` sends the message text to the local Llama-3 instance.
4. Llama-3 returns structured analysis (Intent, Tone, Risk).
5. `query-analyzer` adds these as `AnnotationV1` objects to the event.
6. **Decision Point**:
    - If `intent == 'spam'` or query is trivial: Call `this.complete(event, 'OK')`.
    - Otherwise: Call `this.next(event, 'OK')` to move to the next step in the routing slip (usually `llm-bot`).

### 3. Annotation Schema
The service will use the following annotation kinds:
- `intent`: One of `question`, `joke`, `praise`, `critique`, `command`, `meta`, `spam`.
- `tone`: Numeric valence and arousal (-1 to 1).
- `risk`: Level (`none`, `low`, `med`, `high`) and Type (`none`, `harassment`, `spam`, `privacy`, `self_harm`, `sexual`, `illegal`).

### 4. Deployment
- **Platform**: Google Cloud Run.
- **Container Strategy**: `query-analyzer` Node.js app as the primary container, with an `ollama` container as a **sidecar**.
- **Resources**: GPU-accelerated instances (if available/needed) or high-CPU instances for Llama-3 8B.

## Design Decisions
- **Standardized Short-Circuiting**: Instead of custom flags, we use the `BaseServer.complete()` method which bypasses the remaining `routingSlip` and sends the event directly to its final `egress` destination.
- **Asynchronous Enrichment**: Analysis happens within the message bus flow, ensuring low latency by avoiding external API round-trips to OpenAI for basic checks.
- **Rule-Driven Triggers**: The `event-router` determines which events need analysis based on Firestore rules, allowing for granular control over which traffic incurrs analysis overhead.
