# Sprint Retro – sprint-305-e4d5f6

## What Worked
- Decoupling tool filtering from behavioral filtering allowed for a cleaner implementation.
- Updating the base `McpServer` ensures that all future MCP servers can easily support tool scoping.
- Using `metadata.scope` provided a more direct way to pass contextual hints than annotations.

## What Didn't
- Initial assumption that `McpServer` wouldn't need changes was incorrect; discovery logic needed to be aware of scopes.
- Finding all adventure-related tools across services required a bit of manual searching.

## Improvements for Next Sprint
- Consider a more automated way to tag tools based on the service they originate from.
- Standardize the `metadata` object structure across more services to support diverse filtering needs.
