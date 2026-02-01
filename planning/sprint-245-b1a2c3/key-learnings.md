# Key Learnings – sprint-245-b1a2c3

- When logging fire-and-forget operations like Firestore writes, unit tests should mock the database layer and verify the data payload to ensure accuracy.
- Including processing time in logs is critical for monitoring latency differences between `openai` and `ollama` (local) platforms.
