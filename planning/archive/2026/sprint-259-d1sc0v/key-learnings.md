# Key Learnings – sprint-259-d1sc0v

- When implementing RBAC for tool discovery in a gateway, ensure that proxy agents can see all tools they might need to serve to end-users.
- Header extraction in middleware/server setup should be thoroughly tested to avoid missing context fields like `userId`.
- Agent-based bypass in `RbacEvaluator` is an effective pattern for trusted service-to-service communication.
