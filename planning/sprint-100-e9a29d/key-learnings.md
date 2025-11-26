# Key Learnings — sprint-100-e9a29d

Date: 2025-11-26 12:25 (local)

- Upfront clarity on data model (Firestore rules schema) and evaluation context prevents rework later.
- Establishing a first-match wins, priority-ordered rule set aligns well with JsonLogic and keeps evaluation deterministic.
- Capturing decisions (DLQ constant; downstream step ownership) early streamlines integration work in later sprints.
- Force completion is useful to close planning-only sprints, but documenting gaps rigorously (verification-report.md) is essential to maintain momentum and traceability.
- Ensure validation environment variables (e.g., PROJECT_ID) and local tooling are in place before test-heavy sprints.