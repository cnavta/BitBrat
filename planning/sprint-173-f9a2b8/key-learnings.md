# Key Learnings – sprint-173-f9a2b8

## Dynamic State Management
When moving from static configuration to dynamic state (like Firestore snapshots), it is essential to manage the lifecycle of the objects created from that state. In this sprint, we learned that tracking the IDs of tools registered by an MCP server is necessary to cleanly remove them when the server's state changes.

## RBAC for Tools
Implementing RBAC at the tool level rather than the server level provides finer-grained control. By carrying `requiredRoles` through from the server configuration to the individual `BitBratTool` objects, we can easily filter them in the processor without needing to know which server they came from at that stage.

## Testing Dynamic Registries
Tests for components that use `onSnapshot` should focus on verifying the reconciliation logic by manually triggering the snapshot callback with different document changes (`added`, `modified`, `removed`).
