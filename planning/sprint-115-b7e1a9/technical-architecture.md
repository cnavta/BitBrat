Technical Architecture – BaseServer I/O Helpers (sprint-115-b7e1a9)

Objective
- Extend BaseServer to simplify two common service tasks via small helper methods callable during setup:
  1. onHTTPRequest(pathPattern, handler) — register an HTTP GET endpoint on the internal Express app
  2. onMessage(destination, handler) — subscribe to a message destination (topic/subject) using the repository message-bus abstraction

Context and constraints
- BaseServer is the canonical entry for service processes. It creates and exposes:
  - Express app instance, health endpoints, logging, config, resource managers
  - Signal handling for graceful shutdown
- Services currently wire HTTP routes via app.get(...) in setup, and message subscriptions via services/message-bus createMessageSubscriber().
- Architecture precedence: architecture.yaml is the source of truth. BaseServer should respect cfg.busPrefix and shared env policies.
- Tests (Jest) must run without network I/O; subscriptions should be disabled in test by convention.

API surface
- Visibility: protected — available to subclasses, not to external modules. The request text says “private”, but subclasses must be able to call these in their constructor/setup. Protected matches TypeScript semantics while keeping them non-public. If strictly necessary, we can keep the internal implementation private and expose protected wrappers; functionally equivalent for service authors.
- Method shapes (with config-object overloads):
  - onHTTPRequest(pathPattern: string, handler: Express.RequestHandler): void
  - onHTTPRequest(cfg: { path: string; method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' }, handler: Express.RequestHandler): void
    - Initial supported option: method (default GET). Extensible for middleware/auth in future.
  - onMessage(destination: string, handler: (data: Buffer, attributes: AttributeMap, ctx: { ack(): Promise<void>; nack(requeue?: boolean): Promise<void> }) => Promise<void> | void, opts?: { queue?: string; ack?: 'explicit' | 'auto' }): Promise<void>
  - onMessage(cfg: { destination: string; queue?: string; ack?: 'explicit' | 'auto' }, handler: as above): Promise<void>
    - Initial supported options: queue, ack. Extensible for durable, maxInFlight, backoffMs later.

Behavior details
1) onHTTPRequest
   - Registers GET handler on the internal Express app at the provided path pattern.
   - Logs registration at info level with service name and path.
   - Errors thrown by handler propagate through Express error middleware (default behavior).

2) onMessage
   - Resolves subject by prefixing cfg.busPrefix if set: subject = (cfg.busPrefix || '') + destination.
   - Skip policy for tests: do not subscribe when NODE_ENV === 'test' or JEST_WORKER_ID is set or MESSAGE_BUS_DISABLE_SUBSCRIBE === '1'. Log skip at debug level.
   - When enabled: use createMessageSubscriber() to subscribe with defaults { queue: serviceName, ack: 'explicit' } unless overridden via opts.
   - Store the returned unsubscribe callback internally for shutdown.
   - Log start, ok, and error states. Catch handler exceptions; if the handler throws, ack by default to avoid redelivery storms (conservative). Services can choose to nack within their handler.

Lifecycle and shutdown
- BaseServer already registers SIGINT and SIGTERM handlers. We will augment shutdown to iterate any stored unsubscribe callbacks and invoke them best-effort (with try/catch), logging warnings on failure, then proceed with existing shutdown behavior.

Observability
- Log on registration (HTTP) with fields { service, path }.
- Log subscription start/ok/error (Message) with fields { subject, queue }.
- No PII in logs. Use the existing Logger facade.

Configuration and security
- Subject resolution uses cfg.busPrefix; no changes to env validation.
- HTTP handlers are regular Express handlers; authentication/authorization can be layered by services as middleware.

Testing strategy
- HTTP helper: create a minimal subclass, register a route via onHTTPRequest (string + config object forms), use supertest to assert 200 and response body.
- Message helper: mock services/message-bus to capture the subscription call and simulate delivering a message to the handler; verify skip behavior when MESSAGE_BUS_DISABLE_SUBSCRIBE=1 or NODE_ENV=test. Optionally assert subject prefixing in a non-test env mocked scenario.
- Ensure no real network I/O by using MESSAGE_BUS_DRIVER=noop and MESSAGE_BUS_DISABLE_SUBSCRIBE=1 in tests.

Backward compatibility
- Additive change. No breaking changes to existing services. Services may adopt helpers incrementally.

Acceptance criteria (architecture)
- Documented API and visibility decision (protected) with justification.
- Defined behavior for subscription resolution, test skip policy, and default ack behavior on handler exceptions.
- Defined lifecycle management for unsubscribe on shutdown.
- Testing and observability plans specified.
