# Key Learnings – sprint-254-6e7a1d

- **Separation of Mutation and State**: Decoupling the intent (mutation) from the result (state snapshot) is crucial for multi-actor safety in LLM platforms.
- **Rule Engine as Middleware**: The Rule Engine acts as a bridge between passive state changes and active platform responses, providing a clean way to implement "if this happens in the world, do that" logic.
- **MCP for State Access**: MCP is the ideal protocol for giving LLMs a "view" into platform state while maintaining strict tool-based control.
