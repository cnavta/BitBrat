# Retro – sprint-112-7f5377b

What worked:
- Clear isolation of reliability concerns into a focused sprint
- Planning-only deliverable aligns with current state (services down)

What didn’t:
- Prior defaults (local publish timeout) were too aggressive for at-least-once systems

Next time:
- Treat at-least-once semantics as a first-class requirement (idempotency from day one)
- Prefer opt-in timeouts coupled with retry filters and dedupe