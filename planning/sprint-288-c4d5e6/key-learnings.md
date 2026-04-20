# Key Learnings – sprint-288-c4d5e6

## Prompt Assembly & History
- Always prefer saving the raw user input to history rather than the processed/combined prompt which may contain system instructions, task parameters, and other non-conversational context.
- Saving instructions to history leads to exponential growth and "massive repetition" as each turn adds a new copy of the instructions to the history section of the next prompt.

## Ingress Management
- When using multiple clients for the same platform (e.g. bot and broadcaster), only one should be responsible for ingress (listening and publishing messages) to avoid duplicate events.
- Since `EnvelopeBuilder` generates unique correlation IDs, deduplication at the message bus level cannot catch events published by different client instances for the same physical message.

## Testing
- Simple multi-turn and multi-client reproduction scripts are invaluable for identifying state-related and concurrency issues.
- Mocks should be kept as simple as possible to avoid compilation and configuration overhead.
