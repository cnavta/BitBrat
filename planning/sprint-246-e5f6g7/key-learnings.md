# Key Learnings – sprint-246-e5f6g7

- **Token Counting**: Use `js-tiktoken` for accurate tokenization in Node.js apps.
- **Service Optimization**: Skipping LLM analysis for short messages (< 3 tokens) is an easy way to save on LLM provider costs and improve response time for simple interactions.
