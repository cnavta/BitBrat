terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

locals {
  env_list = [for k, v in var.env : {
    name  = k
    value = v
  }]
  secret_env_list = [for k, v in var.env_from_secrets : {
    name   = k
    secret = v
  }]
  # Enforce unauthenticated invocations when explicitly requested OR when
  # the service is VPC-bound / behind Internal & Cloud Load Balancing ingress
  effective_allow_unauth = var.allow_unauth || var.ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" || var.vpc_connector != ""
}

resource "google_cloud_run_v2_service" "this" {
  name                 = var.name
  location             = var.region
  project              = var.project_id
  ingress              = var.ingress
  deletion_protection  = var.deletion_protection

  template {
    service_account = var.service_account

    dynamic "vpc_access" {
      for_each = var.vpc_connector != "" ? [1] : []
      content {
        connector = var.vpc_connector
        egress    = var.vpc_egress
      }
    }

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = var.port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      dynamic "env" {
        for_each = local.env_list
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      dynamic "env" {
        for_each = local.secret_env_list
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = "latest"
            }
          }
        }
      }
    }
  }
}

# Allow unauthenticated invocation when requested (temporary for this sprint)
resource "google_cloud_run_v2_service_iam_member" "unauth_invoker" {
  count    = local.effective_allow_unauth ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_name" {
  value = google_cloud_run_v2_service.this.name
}

output "service_uri" {
  value = google_cloud_run_v2_service.this.uri
}
