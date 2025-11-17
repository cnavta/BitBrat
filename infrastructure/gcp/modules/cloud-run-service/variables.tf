variable "project_id" {
  type = string
}

variable "name" {
  type = string
}

variable "region" {
  type = string
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

variable "ingress" {
  type    = string
  default = "INGRESS_TRAFFIC_ALL"
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "allow_unauth" {
  type    = bool
  default = true
}

variable "service_account" {
  type = string
}

variable "image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "env_from_secrets" {
  type    = map(string)
  default = {}
}

variable "env" {
  type    = map(string)
  default = {}
}
