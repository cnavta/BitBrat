# Key Learnings – sprint-241-b8d4e2

- **Sidecar Resource Constraints**: Running Ollama as a sidecar in Cloud Run requires careful CPU/Memory allocation, especially if GPUs are unavailable. High-CPU instances (8+ vCPUs) are recommended for reasonable Llama-3 8B latency.
- **Structured LLM Output**: Using JSON mode with specific JSON-schema-like prompts in the system message is essential for reliable integration in an event-driven system.
- **Developer Experience**: Providing a local Docker Compose setup that mirrors the sidecar architecture is critical for debugging the interaction between the Node.js service and the local LLM.
