# Key Learnings – sprint-227-8d4f2c

- **Generic Egress Topic Pattern**: Implementing a shared topic (`internal.egress.v1`) allows for loose coupling between event sources and delivery mechanisms. It effectively handles system-level notifications that don't have a direct request context.
- **Service Filtering**: Services listening to a generic topic must be careful to only process events they are capable of delivering. Using `source`, `egress.destination`, or `annotations` proved to be a reliable filtering strategy.
- **Integration Test Bus Simulation**: Mocking the message bus with an `EventEmitter` allowed for high-fidelity integration testing of the broadcast pattern without requiring a live NATS or Pub/Sub environment.
- **DLQ Responsibility**: Explicitly assigning DLQ responsibility to the service that attempts delivery (and fails) ensures that failures are tracked close to the source of the error.
