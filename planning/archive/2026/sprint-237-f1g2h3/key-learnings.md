# Key Learnings – sprint-237-f1g2h3

- **Cross-Service Alignment**: When implementing a setup or migration tool, always cross-reference the exact Firestore paths and document schemas used by the services that consume that data.
- **Internal vs. External Field Names**: Services might use different internal names (e.g., `uid`) compared to external or legacy names (e.g., `user_id`). `brat setup` should use the names expected by the service logic.
- **Collection Path Normalization**: `RuleLoader` has a specific normalization logic for collection paths (must be odd segments). Using the fully qualified path in the setup tool avoids ambiguity.
