# Key Learnings — sprint-140-2f9c1a

- A thin adapter + registry pattern scales well for adding OAuth providers with minimal cross-impact.
- Normalizing token storage (authTokens/{provider}/{identity}) unlocks consistent consumers (e.g., Discord ingress) and simplifies rotation.
- Feature flags are essential for safely introducing new auth flows and token sources in production.
- Early, comprehensive tests (unit + integration) accelerate iteration and enable confident refactors.
- Publication and validation artifacts should be planned earlier to avoid end-of-sprint crunch.