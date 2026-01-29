# Key Learnings – sprint-228-d4e5f6

- **Explicit Acknowledgment is Critical**: In distributed systems using "explicit" ack mode (like NATS JetStream or Pub/Sub), omitting an `ack()` call leads to silent but cumulative message redelivery, which can manifest as UI duplicates.
- **WebSocket Mocking Complexity**: Mocking `ws` in Jest requires careful consideration of the `readyState` and asynchronous event loops to avoid race conditions in tests.
- **Port Alignment**: In local Docker environments, differentiating between `SERVICE_PORT` (internal) and host mapping (external) is vital for tool-to-service connectivity.
- **Trace Logging for High-Volume Drivers**: High-frequency events like message bus receipts should be relegated to a `trace` level to preserve `debug` utility for application-level logic.
- **Candidate-First Egress**: Egress routing should strictly prioritize LLM-generated candidates over raw message payloads to prevent unintentional "echo" behavior in chat interfaces.
