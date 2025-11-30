Key Learnings – sprint-106-7c9e12

- Per-instance egress topics simplify symmetric routing for persistent connections (e.g., IRC).
- Prefer K_REVISION for identity on Cloud Run to keep topics stable across rollouts.
- Injecting envelope.egressDestination at ingress time improves debuggability and makes downstream routing explicit.
- Test guards that default the message bus to noop and disable IRC connections keep the suite fast and deterministic.
- Validation should include a lightweight scripted healthcheck for the egress consumer path; leaving it manual slowed validation.
- PR creation via gh works reliably when credentials are present; consider a GitHub Action to automate publication post-push.