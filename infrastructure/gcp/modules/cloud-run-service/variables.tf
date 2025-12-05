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
  # Enforce Internal and Cloud Load Balancing by default
  # Valid values: INGRESS_TRAFFIC_ALL | INGRESS_TRAFFIC_INTERNAL_ONLY | INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER
  default = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
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

# Optional: attach Serverless VPC Access connector to the service for egress into the VPC
variable "vpc_connector" {
  type    = string
  default = ""
}

# VPC egress settings when a connector is attached
# Valid values per Cloud Run v2: ALL_TRAFFIC | PRIVATE_RANGES_ONLY
variable "vpc_egress" {
  type    = string
  # Default to PRIVATE_RANGES_ONLY to ensure public traffic bypasses the VPC connector
  # for lower latency to Google APIs like Pub/Sub.
  default = "PRIVATE_RANGES_ONLY"
}

variable "env_from_secrets" {
  type    = map(string)
  default = {}
}

variable "env" {
  type    = map(string)
  default = {}
}
