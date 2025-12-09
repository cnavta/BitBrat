# Sprint Retro – sprint-109-8991ec0

## What worked
- Early planning artifacts (backlog, implementation plan) clarified scope for V2 migration
- Incremental migration strategy minimized blast radius (RouterEngine shim for JsonLogic, then full V2 tests)
- Publisher reuse + bounded timeouts eliminated publish-induced redelivery storms
- Validation via npm test remained fast and reliable

## What didn’t
- Residual V1 test fixtures caused late-stage failures after adapter removal
- Command Processor still instantiated publishers in-handler (identified; scheduled for follow-up)

## Surprises
- DNS/name-resolution delays dominated first-publish latency when clients were re-created repeatedly

## Action items
- Sweep repository for dead V1 artifacts and comments
- Refactor Command Processor to cache publishers at startup
- Standardize publish timeout defaults per environment
