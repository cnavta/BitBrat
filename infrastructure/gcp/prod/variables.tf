variable "project_id" {
  type    = string
  default = "twitch-452523"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "service_name" {
  type    = string
  default = "oauth-flow"
}

variable "repo_name" {
  type    = string
  default = "bitbrat-services"
}

variable "min_instances" {
  type    = number
  default = 0
}

variable "max_instances" {
  type    = number
  default = 3
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "port" {
  type    = number
  default = 3000
}

variable "allow_unauth" {
  type    = bool
  default = true
}

variable "env" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  type    = list(string)
  default = []
}
