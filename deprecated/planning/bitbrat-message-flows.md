# BitBrat Messaging — Message Flow Diagram (Sprint 76)

Author: Junie (Lead Architect)
Date: 2025-10-21
Status: Draft v1

This diagram illustrates the end-to-end message flows across the swappable Message Bus (GCP Pub/Sub in Cloud mode, NATS JetStream in local mode). It follows the envelope + routing slip pattern described in the Sprint 76 Architecture Overview.

Notes
- At-least-once delivery: all consumers must be idempotent.
- Attributes: correlationId and traceparent are propagated via bus attributes/headers.
- Routing slip: steps are planned by the Router and updated by each worker.

```mermaid
sequenceDiagram
  autonumber
  actor ChatUser as Twitch Chat User
  participant Ingress as Ingress/Egress Service
  participant Bus as Message Bus (Pub/Sub | NATS)
  participant Router as Event Router/Processor
  participant Retrieval as Memory Retrieval
  participant LLM as LLM Bot Service
  participant Egress as Ingress/Egress (Delivery)

  ChatUser->>Ingress: Twitch IRC message
  Note over Ingress: Normalize → type: chat.message.v1<br/>envelope: {source:"ingress.twitch", correlationId, traceId}
  Ingress->>Bus: publish internal.ingress.v1 (chat.message.v1)

  Router-->>Bus: subscribes internal.ingress.v1
  Router->>Router: Plan routingSlip (router→retrieval?→llm-bot→formatter?→egress)

  alt Memory retrieval enabled
    Router->>Bus: publish internal.retrieval.v1 (chat.context.request)
    Retrieval-->>Bus: subscribes internal.retrieval.v1
    Retrieval->>Bus: publish internal.bot.requests.v1 (llm.request.v1)<br/>envelope.routingSlip[retrieval]=OK
  else No retrieval
    Router->>Bus: publish internal.bot.requests.v1 (llm.request.v1)<br/>with context if any
  end

  LLM-->>Bus: subscribes internal.bot.requests.v1
  LLM->>Bus: publish internal.bot.responses.v1 (llm.response.v1)<br/>envelope.routingSlip[llm-bot]=OK

  Router-->>Bus: subscribes internal.bot.responses.v1
  Router->>Bus: publish internal.egress.v1 (egress.deliver.v1)

  Egress-->>Bus: subscribes internal.egress.v1
  Egress->>ChatUser: Send chat reply via Twitch IRC

  Note over Router,LLM: Idempotency key = sha256(correlationId + stepId + attempt)
  Note over Bus: Attributes/Headers: { correlationId, traceparent, type }
```

Legend
- internal.ingress.v1: Ingress publishes normalized inbound events
- internal.retrieval.v1: Optional retrieval/enrichment requests
- internal.bot.requests.v1: Router → LLM Bot request channel
- internal.bot.responses.v1: LLM Bot → Router responses
- internal.egress.v1: Final messages for delivery (Ingress consumes)

Routing Slip Example (abridged)
```json
{
  "routingSlip": [
    { "id": "router", "status": "OK" },
    { "id": "retrieval", "status": "PENDING", "nextTopic": "internal.retrieval.v1" },
    { "id": "llm-bot", "status": "PENDING", "nextTopic": "internal.bot.requests.v1" },
    { "id": "egress", "status": "PENDING", "nextTopic": "internal.egress.v1" }
  ]
}
```

Implementation Hints
- Local: MESSAGE_BUS=nats with JetStream; subjects map 1:1 to topic names.
- Cloud: MESSAGE_BUS=pubsub; topics created via IaC and bound by service account IAM.
- Every consumer updates its step in the slip and republishes for continuation.
