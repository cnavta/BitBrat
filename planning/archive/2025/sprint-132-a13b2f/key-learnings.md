Key Learnings – sprint-132-a13b2f

- Model-first approach reduced refactors: extending InternalEventV2 simplified persistence and future features.
- Always sanitize before Firestore writes; undefined values cause runtime failures.
- TTL needs both global defaults and per-event overrides (qos.ttl) to balance cost and retention needs.
- Scoped validation speeds iteration when broader infra isn’t configured locally; keep both full and scoped paths.
- Publishing finalize events from ingress-egress immediately after egress enabled a clean decoupling to persistence.