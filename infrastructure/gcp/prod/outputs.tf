output "artifact_registry_repo" {
  value = module.repo.repo_id
}

output "build_sa_email" {
  value = module.sa.build_sa_email
}

output "runtime_sa_email" {
  value = module.sa.runtime_sa_email
}

output "oauth_flow_service" {
  value = {
    name = module.run_oauth.service_name
    uri  = module.run_oauth.service_uri
  }
}
