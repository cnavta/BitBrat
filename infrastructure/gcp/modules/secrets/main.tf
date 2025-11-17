# Disabled module: Secret Manager resources are managed manually outside of code.
# This module intentionally contains no resources to avoid creating/modifying/destroying secrets.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

# No resources defined by policy.

output "secret_names" {
  value = []
  description = "No secrets managed by Terraform (manual management policy)."
}
