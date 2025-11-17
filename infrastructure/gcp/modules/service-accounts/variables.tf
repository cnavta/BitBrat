variable "project_id" {
  type = string
}

variable "build_sa_name" {
  type    = string
  default = "cloud-build-bb"
}

variable "runtime_sa_name" {
  type    = string
  default = "run-oauth-flow"
}
