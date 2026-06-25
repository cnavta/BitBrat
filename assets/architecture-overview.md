# BitBrat — Architecture Overview (diagram asset)

High-level view of the BitBrat agent loop and its services. This standalone asset is referenced from
the [README](../README.md#architecture); the canonical definition lives in
[`architecture.yaml`](../architecture.yaml) and the full narrative in
[Platform Flow Overview](../documentation/concepts/platform-flow.md).

```mermaid
flowchart LR
  subgraph External["External platforms"]
    TW[Twitch]
    DC[Discord]
    TL[Twilio]
  end

  TW & DC & TL <--> IE[ingress-egress]

  IE -->|internal.ingress.v1| ER["event-router<br/>+ routing slip"]
  ER --> AU[auth]
  ER -->|analysis| LB[llm-bot]
  ER -->|analysis| QA[query-analyzer]
  LB <--> TG[tool-gateway]
  TG <--> MCP["MCP servers<br/>obs / image-gen / story-engine"]
  ER -->|reaction| SE[state-engine]
  ER -->|reaction| DS[disposition-service]
  ER -->|internal.egress.v1| IE
  LB -.-> PE[persistence]
  SE -.-> PE
  PE --> FS[(Firestore)]

  classDef store fill:#eef,stroke:#669;
  class FS store;
```

**Agent loop mapping:** perceive (`ingress-egress`) → plan (`event-router` + routing slip) →
act (`llm-bot` / `query-analyzer` + `tool-gateway`/MCP) → observe & remember
(`state-engine` / `disposition-service` / `persistence`, backed by Firestore).
