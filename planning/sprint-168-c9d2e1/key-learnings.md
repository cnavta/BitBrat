# Key Learnings – sprint-168-c9d2e1

- **State as Source of Truth**: When IaC synthesis code is lost or broken, the current Terraform state (and its backups) is the ultimate source of truth for what needs to be restored to maintain system stability.
- **Resource Identifier Constraints**: Terraform resource identifiers should strictly avoid hyphens to prevent parsing issues, even if some providers/versions allow them. Synthesis logic should always sanitize inputs.
- **Continuous Integration of Schema**: When adding new architectural patterns (like regional internal LBs), the schema and synthesis logic MUST be updated together to avoid broken deployments.
