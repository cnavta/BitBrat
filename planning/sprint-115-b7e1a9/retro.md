# Sprint Retro – sprint-115-b7e1a9

## What worked
- Clear, minimal API surface with protected helpers (onHTTPRequest, onMessage)
- Test-friendly behavior (subscription skip policy) kept Jest runs fast and deterministic
- Conservative default error handling (ack on handler error) reduces redelivery storms
- Immediate adoption demo in llm-bot with trivial onMessage wiring

## What didn’t
- Couldn’t justify a full non-test subscription integration test within CI constraints; deferred

## Next time
- Add optional tests covering real subject prefixing/options in a controlled non-test harness
- Incrementally refactor other services to use helpers for consistency
- Consider expanding SubscribeOptions (durable, maxInFlight, backoff) with tests