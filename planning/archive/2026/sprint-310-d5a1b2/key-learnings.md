# Key Learnings - sprint-310-d5a1b2

- **CLI Interactions**: Simple interactive loops in Node.js can be effectively built using the native `readline` module when external dependencies are restricted.
- **Firestore Population**: Using `admin.firestore.FieldValue.serverTimestamp()` is essential for tracking when setup-generated data was created.
- **Routing Logic**: Mapping platform stages (initial -> analysis -> reaction) through specific routing rules in Firestore enables a decoupled and flexible event flow.
- **MCP Registry**: Centralizing MCP server configurations in Firestore allows services like `llm-bot` to dynamically discover and connect to tools.
