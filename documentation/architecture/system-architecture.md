# System Architecture: Phased Event Flow

## Overview
The BitBrat Platform utilizes a phased event processing pipeline to ensure orderly normalization, enrichment, reaction, and persistence of events. This architecture divides the lifecycle of an event into four distinct phases, coordinated by the **Event Router** using routing slips.

## The Four Phases

### 1. Ingress Phase
**Objective:** Capture external events, normalize them into the platform's internal format, and ensure initial persistence.

- **Trigger:** External activity (Twitch EventSub, IRC, Webhooks, WebSocket requests).
- **Core Services:**
  - `api-gateway`: Receives WebSocket-based events from clients.
  - `ingress-egress`: Bridges external platforms (Twitch, Discord, etc.) to internal topics.
  - `persistence`: Captures the raw and normalized event for audit and recovery.
- **Outcome:** A normalized internal event published to `internal.ingress.v1`.

### 2. Enrichment Phase
**Objective:** Add context and metadata to the normalized event to prepare it for intelligent reaction.

- **Trigger:** Event Router assigns an "Enrichment" routing slip.
- **Core Services:**
  - `auth`: Attaches user identity, permissions, and session context.
  - `query-analyzer`: Performs fast pre-analysis (intent detection, token filtering, sentiment).
- **Outcome:** An enriched event with a full context payload.

### 3. Reaction Phase
**Objective:** Execute the core logic and system response based on the enriched event context.

- **Trigger:** Event Router assigns a "Reaction" routing slip.
- **Core Services:**
  - `llm-bot`: Primary worker for generating intelligent responses using LLMs.
  - `event-router`: Can short-circuit or re-route based on enrichment results (e.g., ignoring spam).
- **Outcome:** System action generated (e.g., a message to be sent, a command to be executed).

### 4. Egress Phase
**Objective:** Deliver the system's reaction to the appropriate external or internal sinks and perform final persistence.

- **Trigger:** A completed routing slip or direct publication to an egress topic.
- **Core Services:**
  - `api-gateway`: Delivers responses to connected clients via WebSocket.
  - `ingress-egress`: Sends messages back to external platforms (Twitch chat, Discord).
  - `persistence`: Finalizes the event lifecycle in the database.
- **Outcome:** Event lifecycle complete; state updated.

## Default Flow Sequence
1. **Ingress** -> Event published to `internal.ingress.v1`.
2. **Event Router** -> Inspects event, assigns Enrichment slip.
3. **Enrichment** -> `auth`, `query-analyzer` add context.
4. **Event Router** -> Inspects enriched event, assigns Reaction slip.
5. **Reaction** -> `llm-bot` generates response.
6. **Egress** -> `api-gateway`/`ingress-egress` deliver result; `persistence` finalizes.
