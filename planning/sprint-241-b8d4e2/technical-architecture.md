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
3. `query-analyzer` sends the message text to the local Llama-3 instance via Ollama's HTTP API.
4. Llama-3 returns structured analysis (Intent, Tone, Risk).
5. `query-analyzer` adds these as `AnnotationV1` objects to the event.
6. **Decision Point**:
    - If `intent == 'spam'` or query is trivial: Call `this.complete(event, 'OK')`.
    - Otherwise: Call `this.next(event, 'OK')` to move to the next step in the routing slip (usually `llm-bot`).

### 3. Annotation Schema
The service will use the following annotation kinds:
- `intent`: One of `question`, `joke`, `praise`, `critique`, `command`, `meta`, `spam`.
- `tone`: Numeric valence and arousal (-1 to 1) in the `payload`.
- `risk`: Level (`none`, `low`, `med`, `high`) and Type (`none`, `harassment`, `spam`, `privacy`, `self_harm`, `sexual`, `illegal`) in the `payload`.

## Llama Analysis Implementation

### Prompting Strategy
To ensure reliable structured output, the service uses Ollama's JSON mode (`format: "json"`) combined with a strictly defined system prompt.

**System Prompt Template:**
```text
You are an expert linguistic analyzer for the BitBrat Platform. 
Analyze the following user message and return a JSON object with:
- intent: question|joke|praise|critique|command|meta|spam
- tone: { "valence": float (-1 to 1), "arousal": float (-1 to 1) }
- risk: { "level": none|low|med|high", "type": none|harassment|spam|privacy|self_harm|sexual|illegal }

Valence: -1 (hostile) to 1 (supportive).
Arousal: -1 (calm) to 1 (fired up).

Respond ONLY with valid JSON.
```

### Ollama API Interaction
The `query-analyzer` service uses the `/api/generate` or `/api/chat` endpoint:
- **Endpoint**: `POST /api/generate`
- **Body**:
  ```json
  {
    "model": "llama3:8b",
    "prompt": "<user_message>",
    "system": "<system_prompt>",
    "stream": false,
    "format": "json",
    "options": {
      "temperature": 0.1
    }
  }
  ```

## Deployment Architecture (Ollama Sidecar)

To maintain compatibility with BitBrat's deployment processes, Ollama is deployed as a sidecar container that shares the same lifecycle and network namespace as the `query-analyzer` application.

### 1. Cloud Run Implementation
In Google Cloud Run, multiple containers are supported within a single revision.
- **Primary Container**: `query-analyzer` (Node.js).
- **Sidecar Container**: `ollama/ollama:latest`.
- **Communication**: The Node.js app connects to `localhost:11434`.
- **Resource Allocation**:
  - The sidecar requires significantly more memory/CPU for Llama-3 8B.
  - Recommend: 8 vCPUs and 16GiB Memory for the Revision (shared).
- **Model Pre-loading**: To avoid cold-start delays, the `Dockerfile.query-analyzer` (or a custom Ollama image) should bake the model into the image or use a startup script to pull it.

### 2. Local Docker Compose Implementation
For local development, the sidecar is simulated as a linked service in `infrastructure/docker-compose/services/query-analyzer.compose.yaml`.

**Compose Definition Snippet:**
```yaml
services:
  query-analyzer:
    # ...
    environment:
      - OLLAMA_HOST=http://ollama:11434
    depends_on:
      - ollama

  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama_data:/root/.ollama
    # GPU support if available on host
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

### 3. Compatibility & Discovery
- **Environment Variables**: Use `OLLAMA_HOST` to allow the service to discover the sidecar across different environments.
- **Service Mesh**: Adheres to the `architecture.yaml` by remaining internal to the `bitbrat-network` and communicating over standard HTTP.

## Design Decisions
- **Standardized Short-Circuiting**: Instead of custom flags, we use the `BaseServer.complete()` method which bypasses the remaining `routingSlip` and sends the event directly to its final `egress` destination.
- **Asynchronous Enrichment**: Analysis happens within the message bus flow, ensuring low latency by avoiding external API round-trips to OpenAI for basic checks.
- **Rule-Driven Triggers**: The `event-router` determines which events need analysis based on Firestore rules, allowing for granular control over which traffic incurrs analysis overhead.
- **JSON-Mode for Reliability**: By forcing JSON output at the model level (Ollama feature), we significantly reduce parsing errors compared to standard text completion.
- **Local-First Analysis**: Leveraging Llama-3 locally (or on sidecar compute) ensures sensitive user data doesn't leave the VPC for the initial classification step.
