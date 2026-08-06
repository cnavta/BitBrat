# Key Learnings – sprint-277-a12b3c

- **Event Type Normalization:** Ingress events should always be normalized to `system.*` or specific domain types to ensure consistent processing across the platform.
- **Persistence Routing:** The `persistence` service's logic for handling `system.` events should be explicit about which ones are "source updates" and which are "initial ingress events" to ensure they are available in the `events` collection for downstream services.
- **Sprint Protocol Efficiency:** Following the LLM Sprint Protocol helped in documenting the investigation and findings clearly, making the fix easy to verify.
