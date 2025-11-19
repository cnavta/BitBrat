module "repo" {
  source     = "../modules/artifact-registry-repo"
  project_id = var.project_id
  name       = "bitbrat-services"
  location   = var.region
}

module "sa" {
  source          = "../modules/service-accounts"
  project_id      = var.project_id
  build_sa_name   = "cloud-build-bb"
  runtime_sa_name = "run-oauth-flow"
}


module "run_oauth" {
  source               = "../modules/cloud-run-service"
  project_id           = var.project_id
  name                 = var.service_name
  region               = var.region
  min_instances        = var.min_instances
  max_instances        = var.max_instances
  cpu                  = var.cpu
  memory               = var.memory
  allow_unauth         = var.allow_unauth
  # Enforce Internal & Cloud Load Balancing ingress
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection  = false
  port                 = var.port
  service_account      = module.sa.runtime_sa_email
  image                = "${var.region}-docker.pkg.dev/${var.project_id}/${var.repo_name}/${var.service_name}:latest"

  # Attach Serverless VPC Access connector (must exist; created by connectors module in this repo)
  # Default naming convention from connectors synth: brat-conn-<region>-<env>. For prod env use 'prod'
  vpc_connector        = "brat-conn-${var.region}-prod"
  vpc_egress           = "ALL_TRAFFIC"

  env = merge(var.env, {
    SERVICE_NAME = var.service_name
    SERVICE_PORT = tostring(var.port)
  })

  env_from_secrets = { for s in var.secrets : s => s }
}
