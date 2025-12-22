# Key Learnings – sprint-156-b2c3d4

- **Competing Consumer Pattern**: Using a shared queue name (`ingress-egress.generic`) for the generic topic ensures that multiple service instances can load balance the delivery of egress events without duplicate processing.
- **Robust Routing Fallback**: Combining explicit discriminators (`egress.type`) with heuristic fallbacks (`source` checks) ensures backward compatibility while providing a clean upgrade path for new services.
- **Fail-Fast with Traceability**: Publishing to a DLQ when a client is unavailable, rather than just logging or ignoring the error, provides immediate observability and a means to replay or debug routing issues.
- **Heuristic Payload Detection**: When dealing with DLQs, being able to detect if a payload is a raw event or a wrapped error report allows for better recording of data even in failure scenarios.
- **Infrastructure-as-Code Alignment**: The `architecture.yaml` serves as both documentation and runtime validation; keeping it in sync with service secrets is essential for smooth deployments and correct test behavior.
