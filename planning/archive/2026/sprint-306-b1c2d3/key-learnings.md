# Key Learnings – sprint-306-b1c2d3

- **Prompt Transparency**: Providing the LLM with internal database IDs (like `userId`) is critical for tool consistency, even when the LLM primarily interacts via user handles.
- **Assembler Drift**: Type definitions can easily drift from rendering logic in prompt assembly systems. Automated tests for "canonical rendering" should include all optional fields.
