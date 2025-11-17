terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

resource "google_artifact_registry_repository" "this" {
  project       = var.project_id
  location      = var.location
  repository_id = var.name
  format        = var.format
  description   = "BitBrat container images"
}

output "repo_id" {
  value = google_artifact_registry_repository.this.repository_id
}

output "repo_self_link" {
  value = google_artifact_registry_repository.this.id
}
