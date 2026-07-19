# Distributed Tracing and Log Correlation

This document explains how to enable distributed tracing using OpenTelemetry with export to cloud tracing backends (e.g., Google Cloud Trace), and how application logs correlate to traces in structured logging.

## Overview

- Tracing is integrated via OpenTelemetry in `src/common/tracing.ts` and bootstrapped by `BaseServer`.
- Message handlers registered through `BaseServer.onMessage()` run inside an active span ("msg <subject>") when tracing is enabled.
- Services add child spans for key operations (e.g., `process-llm-request`, `execute-command`, `user-enrichment`, `route-message`, `deliver-egress`, `ingress-receive`).
- Logger automatically adds trace correlation fields when a span is active (format depends on backend):
  - `logging.googleapis.com/trace` (Google Cloud Logging)
  - `logging.googleapis.com/spanId` (Google Cloud Logging)
  - `logging.googleapis.com/trace_sampled` (Google Cloud Logging)

## Enablement

Tracing is disabled by default. Enable it per-service using environment variables:

- `TRACING_ENABLED=1` — Turn on tracing
- `TRACING_SAMPLER_RATIO=0.1` — Sampling ratio between 0 and 1 (default 0.1)

For log-to-trace linkage in cloud logging backends, ensure the project identifier is set in the environment (Cloud Run sets it automatically):

- `GOOGLE_CLOUD_PROJECT` (preferred for Google Cloud), or
- `GCP_PROJECT`, or
- `GCP_PROJECT_ID`

Exporter: Cloud trace exporters are dynamically required at runtime. If `@google-cloud/opentelemetry-cloud-trace-exporter` is installed in the environment, spans will be exported to the cloud tracing backend. Otherwise, spans remain local.

## Architecture defaults

The repository documents tracing defaults in architecture.yaml under defaults.services.observability.tracing:

- enabled: false
- sampler_ratio: 0.1

These serve as guidance/config documentation and do not automatically enforce environment variables. To enable tracing for a given deployment, set the corresponding environment variables:

- TRACING_ENABLED=1
- TRACING_SAMPLER_RATIO=0.1

## OAuth HTTP spans

The oauth-flow service instruments its HTTP routes with light middleware that opens a span per request under the /oauth path. This makes it easy to correlate logs during OAuth flows to Cloud Trace spans without changing route behavior.

## Pub/Sub and HTTP propagation

When a service publishes to a message bus (e.g., Cloud Pub/Sub) while inside an active span, client libraries and push subscriptions automatically propagate and continue the trace context. You should see:

- Upstream span (publisher)
- A message bus wait component representing time in transit
- Downstream span (subscriber handler)

No custom headers or code are required for propagation.

## Routing helper spans

Services using `BaseServer` routing helpers will emit the following spans when tracing is enabled:

- `routing.next` — publishing to the next routing destination; attributes include `subject`, `correlationId`, and `stepIndex` when applicable.
- `routing.complete` — publishing directly to `egressDestination`; attributes include `egressDestination` and `correlationId`.

These spans help trace message progression across internal hops and to egress. Ensure logs include `correlationId` to correlate with these spans.

## Manual validation checklist

1. Set env on services (Cloud Run or locally if exporting is configured):
   - `TRACING_ENABLED=1`
   - `TRACING_SAMPLER_RATIO=1` (temporarily increase for validation)
2. Trigger an end-to-end message path (e.g., Twitch ingress → auth → event-router → llm-bot).
3. In your logging backend (e.g., Cloud Logging), filter by the service and find a recent log for the path; open a log line and click the trace link (e.g., `logging.googleapis.com/trace` for Google Cloud).
4. In your tracing backend (e.g., Cloud Trace), verify the waterfall shows child spans:
   - ingress-egress: `ingress-receive` (and `deliver-egress` when applicable)
   - auth: `user-enrichment`
   - event-router: `route-message`
   - llm-bot: `process-llm-request`
   - command-processor: `execute-command`
5. Confirm the message bus waiting time and subscriber processing spans are visible.

## Notes and guidance

- Start with low sampling in production (e.g., 0.05–0.1) to control overhead and cost.
- Avoid recording PII in span names or attributes. Structured logs are redacted via `Logger.redactSecrets`.
- Tracing can be enabled or disabled via env without code changes or redeploys beyond configuration updates.
