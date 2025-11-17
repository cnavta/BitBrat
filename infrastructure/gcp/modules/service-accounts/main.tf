terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

resource "google_service_account" "build" {
  project      = var.project_id
  account_id   = var.build_sa_name
  display_name = "Cloud Build SA for BitBrat"
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = var.runtime_sa_name
  display_name = "Runtime SA for oauth-flow"
}

# Project-level IAM for Build SA
resource "google_project_iam_member" "build_gar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.build.email}"
}

# Allow Build SA to act as the runtime SA
resource "google_service_account_iam_member" "build_sauser_on_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.build.email}"
}

output "build_sa_email" {
  value = google_service_account.build.email
}

output "runtime_sa_email" {
  value = google_service_account.runtime.email
}
