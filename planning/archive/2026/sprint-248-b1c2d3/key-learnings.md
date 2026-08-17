# Key Learnings – sprint-248-b1c2d3

- **Phase Simplicity:** Bypassing the orchestrator in the final delivery phase (Egress) reduces overhead and makes the system more responsive.
- **Contextual Routing:** Loading rules based on phase metadata is a powerful pattern for keeping individual rules simple and focused.
- **Slip Integrity:** The routing slip should ideally contain enough information to reach the final sink without a final "egress" routing step if the destination is known.
