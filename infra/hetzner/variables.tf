variable "hcloud_token" {
  description = "Hetzner Cloud API Token"
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Domain name for the application (e.g., app.example.com)"
  type        = string
  default     = ":80"
}

# --- Application Secrets ---

variable "db_password" {
  type      = string
  sensitive = true
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "logtail_token" {
  type      = string
  sensitive = true
}

# --- S3/R2 Configuration ---

variable "bucket_name" {
  type = string
}

variable "public_avatar_url" {
  type = string
}

variable "s3_endpoint" {
  type = string
}

variable "s3_access_key" {
  type = string
}

variable "s3_secret_key" {
  type      = string
  sensitive = true
}

variable "s3_region" {
  type    = string
  default = "auto"
}

# --- Git Configuration ---

variable "git_repo" {
  description = "Public URL of your git repo to clone on the server"
  type        = string
  default     = "https://github.com/effect-flow-dev/local-first-effect-starter.git"
}
