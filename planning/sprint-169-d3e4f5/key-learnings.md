# Key Learnings – sprint-169-d3e4f5

- **Terraform Consistency**: Resource IDs in Terraform should ideally use underscores to avoid ambiguity and potential syntax issues in certain provider implementations. More importantly, referencing those resources MUST match the ID exactly.
- **Sprint Dependencies**: When working on sequential sprints, ensure that the previous sprint's changes are either merged or explicitly brought into the current branch to avoid testing against stale code.
- **Snapshot Testing**: Snapshots are powerful for catching unintended output changes, but they must be updated deliberately when the underlying logic is intentionally changed.