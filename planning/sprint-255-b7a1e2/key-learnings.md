# Key Learnings – sprint-255-b7a1e2

## Discovery vs. Invocation
- In a shared-session environment, discovery permissions should often be broader than invocation permissions to allow agents to accurately represent capabilities to the LLM, while execution remains the primary security gate.

## Zod-to-JSON-Schema Nuances
- When converting Zod schemas for MCP tools, it is crucial to resolve top-level references (like `definitions.input`) to a flat object schema, as some LLM providers or MCP clients prefer `{ type: "object" }` at the root.

## Metadata Propagation
- The MCP `_meta` field is a powerful, standard-compliant way to pass out-of-band context (like user roles) through shared transports without polluting the tool's input arguments.
