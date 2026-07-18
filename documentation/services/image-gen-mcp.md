# Image Gen MCP

The `image-gen-mcp` service exposes a single MCP tool, `generate_image`, which produces an image
from a text prompt using OpenAI's image model (default `gpt-image-1`) and persists the resulting PNG
to Google Cloud Storage (GCS). It is built on the standard `McpServer` base class and is invoked by
the `tool-gateway`.

## Features

- **Moderation**: Every prompt is first checked against the OpenAI Moderation API; flagged prompts
  are rejected before any image is generated.
- **Image Generation**: Uses the **Vercel AI SDK** (`experimental_generateImage`) against the
  configured OpenAI image model.
- **GCS Persistence**: Generated images are uploaded to a GCS bucket and returned as a public URL.
- **Rate Limiting**: One generation per user per `IMAGE_GEN_RATE_LIMIT_MS` window (default 5 minutes).
- **Prompt Logging**: Logs each `generate_image` invocation (success, moderation rejection, and
  error) to the database for audit and training purposes, mirroring `llm-bot` and `query-analyzer`.

## Tool: `generate_image`

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `prompt` | string | — | The descriptive prompt for the image. |
| `aspect_ratio` | enum (`1:1`, `16:9`, `9:16`) | `1:1` | The aspect ratio of the generated image. |

The handler has three terminal outcomes — **success**, **moderation rejection**, and **error** — and
each is recorded by prompt logging (when enabled) just before the tool returns.

## Observability

### Prompt Logging

When enabled, the service writes a structured, **fire-and-forget** record of each `generate_image`
invocation to the database. The write is never awaited and a failure can never alter, delay, or fail the
tool result (fail-soft); failures are surfaced via the `image_gen_mcp.prompt_logging_failed` warning
log. This reuses the same platform-wide feature flag, sub-collection layout, and redaction discipline
as `llm-bot` and `query-analyzer`.

- **Feature Flag**: `llm.promptLogging.enabled` (env `FF_LLM_PROMPT_LOGGING`, default `false`). This
  is the single platform-wide prompt-logging switch shared by all services.
- **Storage Path (Database)**: `services/image-gen-mcp/prompt_logs/{logId}` (collection or table depending on backend)
- **Logged Outcomes**:
    - `success`: image generated and persisted to GCS.
    - `rejected`: prompt flagged by moderation (no image generated).
    - `error`: generation or persistence failed.
- **Fields**:
    - `correlationId`: Traces the request across services. Resolved from the MCP request's
      `extra._meta.correlationId` when propagated by the caller, otherwise a generated UUID.
    - `prompt`: The user's image prompt (redacted via `redactText`).
    - `response`: The image's GCS public URL on success; `moderation_rejected` or `error` otherwise
      (redacted).
    - `model`: The image model used (`IMAGE_GEN_MODEL`, default `gpt-image-1`).
    - `platform`: Always `openai`.
    - `status`: `success` | `rejected` | `error`.
    - `aspectRatio`: The requested aspect ratio (`1:1` | `16:9` | `9:16`).
    - `size`: The resolved pixel size sent to the model (e.g. `1024x1024`).
    - `processingTimeMs`: Wall-clock duration of the generation path (success only).
    - `image`: On success, `{ url, bucket, fileName, contentType: 'image/png' }`.
    - `moderation`: `{ flagged: boolean, categories: string[] }` from the moderation step.
    - `userId`: From MCP `extra._meta` (`anonymous` if absent).
    - `error`: Redacted error message when `status` is `error`.
    - `createdAt`: Timestamp of the log entry.

> **Backups**: `prompt_logs` is classified as a log/event collection that is excluded from the
> `brat backup` config export. The `image-gen-mcp` sub-collection requires no change because the
> exclusion is by collection name.

See the Technical Architecture for the full design:
[`documentation/technical-architecture/image-gen-mcp-prompt-logging.md`](../technical-architecture/image-gen-mcp-prompt-logging.md).

## Configuration

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `IMAGE_GEN_MODEL` | `gpt-image-1` | OpenAI image model to use. |
| `IMAGE_GEN_RATE_LIMIT_MS` | `300000` | Per-user rate-limit window in milliseconds (default 5 min). |
| `GCS_BUCKET_NAME` | `bitbrat-media-gen` | GCS bucket where generated images are stored. |
| `OPENAI_API_KEY` | N/A | OpenAI API key (fetched via `getSecret`; never logged). |
| `FF_LLM_PROMPT_LOGGING` | `false` | Feature flag to enable prompt logging to the database. |
| `SERVICE_PORT` | `3000` | Port for the service to listen on. |
