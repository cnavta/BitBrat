# Technical Architecture — InternalEventV2 Refactor

## 1. Overview
The goal of this refactor is to simplify the `InternalEventV2` structure by eliminating legacy nesting (specifically `EnvelopeV1`) and consolidating properties into logical groups: `ingress` and `identity`. We also aim to completely remove `InternalEventV1` and its associated adapters to ensure a single, consistent event format across the platform.

## 2. Structural Changes

### 2.1 Schema Updates
`InternalEventV2` will no longer inherit from `EnvelopeV1`. Instead, it will have a flat structure with grouped properties.

#### New Root Properties
- `v: '2'` (Literal)
- `correlationId: string` (UUID)
- `traceId?: string` (W3C Trace ID)
- `type: InternalEventType`
- `ingress: Ingress`
- `identity: Identity`
- `egress: Egress`
- `routingSlip?: RoutingStep[]`
- `externalEvent?: ExternalEventV1`
- `message?: MessageV1`
- `payload?: Record<string, any>`
- `annotations?: AnnotationV1[]`
- `candidates?: CandidateV1[]`
- `qos?: QOSV1`
- `errors?: ErrorEntryV1[]`
- `metadata?: Record<string, any>`

#### Group: `Ingress`
Consolidates source and entry-time information.
```typescript
export interface Ingress {
  ingressAt: string; // ISO8601
  source: string;    // e.g., "ingress.twitch", "api-gateway"
  channel?: string;  // #channel or room ID
}
```

#### Group: `Identity`
The central hub for user and authentication information.
```typescript
export interface Identity {
  /** 
   * Provided by Ingress. 
   * Processes should map platform-specific user info here.
   */
  external: {
    id: string;
    platform: string;
    displayName?: string;
    roles?: string[];
    metadata?: Record<string, any>;
  };

  /** 
   * Provided by Auth Service (Enrichment).
   * Maps internal user database information.
   */
  user?: {
    id: string;
    email?: string;
    displayName?: string;
    roles?: string[];
    status?: string;
    notes?: string;
    tags?: string[];
  };

  /** 
   * Provided by Auth Service.
   * Authentication process details.
   */
  auth?: {
    v: '2';
    provider?: string;
    method: 'enrichment';
    matched: boolean;
    userRef?: string;
    at: string;
  };
}
```

### 2.2 Payload Consolidation
- The `externalEvent` payload and the root `payload` often duplicated data. 
- **Strategy**: Ingress processes should put the platform-specific payload into the root `payload` (if it's not a standard `message`). `ExternalEventV1.rawPayload` may still be used for the original, unmodified platform event.
- `InternalEventV1` will be deleted, along with `toV1`/`toV2` adapters.

## 3. Impact Analysis

### 3.1 Ingress Services
All ingress connectors (API Gateway, Twitch, Discord) must be updated to:
1. Populate `ingress` object.
2. Populate `identity.external` with the platform user ID and metadata.
3. Stop using `userId` and `source` at the root level.

### 3.2 Auth Service (Enrichment)
- Enrichment logic must shift from looking at `userId` or `payload` to primary looking at `identity.external`.
- It will continue to populate `identity.user` and `identity.auth`.

### 3.3 Event Router
- `RouterEngine` and `JsonLogicEvaluator` must be updated to reference the new paths (e.g., `evt.ingress.source` instead of `evt.source`).

### 3.4 BaseServer
- `BaseServer.onMessage` currently has logic to detect and convert V1 envelopes using `toV2`. This will be removed. All incoming messages will be assumed to be `InternalEventV2`.

### 3.5 Egress Services
- API Gateway and other egress handlers must read recipient info from `identity.user` (internal) or `identity.external` (external/fallback).

## 4. Migration Strategy
Since we are NOT side-by-side versioning, this is a breaking change across all services.
1. Update shared types (`src/types/events.ts`).
2. Update `common` libraries (`base-server`, `adapters`).
3. Update all services in a single "big bang" pass within this sprint.
4. Update all tests to conform to the new schema.

## 5. Acceptance Criteria
- [ ] `InternalEventV1` and `EnvelopeV1` removed from `src/types/events.ts`.
- [ ] `InternalEventV2` conforms to the new `Ingress` and `Identity` grouping.
- [ ] All services compile and pass tests with the new structure.
- [ ] `validate_deliverable.sh` executes successfully.
