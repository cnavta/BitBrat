# Key Learnings – sprint-170-fix-undeclared-backend-services

- Always verify resource types when generating Terraform outputs that aggregate different resource kinds.
- When transforming resource IDs (e.g., replacing hyphens with underscores), ensure that downstream logic that depends on those IDs for pattern matching (like `endsWith('-internal')`) is also updated or handles the transformation correctly.
