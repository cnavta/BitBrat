# Key Learnings – sprint-171-f5e6g7

- **Terraform Resource Addresses**: Changing the local ID of a resource in HCL (e.g., `resource "type" "ID"`) changes its address in the Terraform state. If the physical resource name remains the same, Terraform will try to delete the old address and create the new one, leading to conflicts if the resource is in use.
- **State Sensitivity**: When "restoring" or "fixing" infrastructure code, always check the existing state or previous versions of the code to ensure addresses match exactly.
