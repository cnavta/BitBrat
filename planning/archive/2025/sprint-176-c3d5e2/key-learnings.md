# Key Learnings – sprint-176-c3d5e2

- **AI SDK Evolution**: Vercel AI SDK 6.x (and some 4.x/5.x versions) transitioned tool schema fields. Always check the local `node_modules` type definitions when field names are in question.
- **MCP Schema Variability**: Even if most MCP servers provide valid JSON schemas, some (especially Python-based ones or LLM-generated ones) might output invalid types like `type: "None"`. Defensive sanitization at the bridge level is essential for robust integration.
- **Error Messages**: The error `schema must be a JSON Schema of 'type: "object"', got 'type: "None"'` is a strong indicator of a non-standard JSON schema being passed to the OpenAI provider in the AI SDK.
