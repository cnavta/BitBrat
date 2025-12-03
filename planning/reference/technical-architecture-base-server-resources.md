Technical Architecture — BaseServer Resource Management v1

Author: Architect
Date: 2025-12-03 11:53 (local)
Alignment: architecture.yaml (source of truth), AGENTS.md v2.4

Objective
- Introduce an explicit resource lifecycle to BaseServer so services can initialize and shutdown dependencies consistently.
- Initialize resources on server instantiation and dispose cleanly on shutdown.

Initial Resources (for every service)
- Publisher: factory for creating MessagePublisher instances with per-subject caching and flush-on-exit.
- Firestore: firebase-admin Firestore singleton bound to configured database.

Key Changes
- Add ResourceManager interface with two methods: setup() and shutdown().
- Extend BaseServerOptions to accept resources?: Record<string, ResourceManager>.
- Realize resources during BaseServer construction after config/logger are ready.
- Expose realized resources to service code via:
  - Third parameter of setup(app, cfg, resources) — backward compatible and optional.
  - app.locals.resources for ad-hoc access.
- Register SIGTERM/SIGINT handlers; on shutdown, call ResourceManager.shutdown() in reverse initialization order.

Interfaces (informal)
- ResourceManager<T>
  - setup(ctx): returns T (instance ready to use). ctx contains { config, logger, serviceName, env }.
  - shutdown(instance: T): Promise<void> | void. Must be idempotent and best-effort.
- ResourceMap = Record<string, ResourceManager<any>>.
- ExpressSetup becomes (app, cfg, resources?) — third arg is optional to preserve all callers.

Initialization Flow
1) Build config and initialize Logger (existing behavior).
2) Resolve resource managers: start with built-in defaults { publisher, firestore } and override/extend with opts.resources by key.
3) For each [key, manager], call setup(ctx) and store instance into:
   - internal map (private field) and
   - app.locals.resources[key] = instance
4) Log base_server.resources.init with keys.
5) Register process signal handlers (SIGTERM, SIGINT) to perform graceful shutdown:
   - Debounce to run once.
   - Iterate managers in reverse order and call shutdown(instance) with try/catch per resource.
   - Log base_server.resource.shutdown.ok or .error per key.
6) Invoke opts.setup(app, cfg, resources) if provided.

Default Resource Managers
1) Publisher Manager
   - setup(): returns { create(subject): MessagePublisher; flushAll(): Promise<void> }
   - create(): uses services/message-bus.createMessagePublisher(subject) and caches by subject.
   - flushAll(): calls flush() on all cached publishers (best-effort).
   - shutdown(): calls flushAll() and clears cache.
   - Honors test/CI env already in place (MESSAGE_BUS_DRIVER=noop, MESSAGE_BUS_DISABLE_IO=1).

2) Firestore Manager
   - setup(): returns getFirestore() singleton; if FIREBASE_DATABASE_ID is set prior to first call, configure via configureFirestore().
   - shutdown(): no-op (firebase-admin has no explicit close); keep hook for future changes.

Observability
- Log per resource during setup and shutdown:
  - base_server.resource.setup.ok|error with { key }
  - base_server.resource.shutdown.ok|error with { key }
- Health endpoints remain unchanged; readinessCheck can incorporate resource health in future iterations if managers expose status.

Backwards Compatibility
- Existing services using setup(app, cfg) continue to work; they can optionally read app.locals.resources.
- New code may take advantage of the third argument to setup for typed access.

Error Handling
- setup(): if a resource throws, log base_server.resource.setup.error and rethrow to abort startup.
- shutdown(): catch and log per-resource errors; continue shutting down remaining resources.
- Shutdown order is reverse of initialization to respect dependencies.

Acceptance Criteria
- BaseServer accepts a resources map and initializes resources at construction.
- Realized resources are available via setup third arg and app.locals.resources.
- Default publisher and firestore resources exist; publisher flushes on shutdown.
- Signal handling triggers orderly shutdown with logs.

Testing Strategy (unit-focused)
- Unit test BaseServer with two mocked ResourceManagers to verify:
  - setup invocation order and passing of ctx
  - shutdown reverse order on SIGTERM
  - error handling does not prevent other resources from shutting down
- Unit test publisher manager caching and flushAll() best-effort behavior (mock MessagePublisher).

Incremental Adoption Plan
1) Implement interfaces and BaseServer wiring (additive change).
2) Add default managers under src/common/resources/* and lazily import within BaseServer to avoid cycles.
3) Optionally update one service (e.g., auth or event-router) to consume resources via setup third arg as an example (no behavior change required).
4) Follow-up (separate change): consider switching default Firestore database id to "(default)" in common/firebase; retain configureFirestore() override.

Risks & Mitigations
- Startup latency: Firestore getFirestore() may perform ADC; we already support emulator/env guidance, and manager does not block readiness endpoints.
- Hidden I/O in tests: mitigated by existing CI env (MESSAGE_BUS_DRIVER=noop, MESSAGE_BUS_DISABLE_IO=1, PUBSUB_ENSURE_DISABLE=1).
