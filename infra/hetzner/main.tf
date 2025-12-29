provider "hcloud" {
  token = var.hcloud_token
}

resource "hcloud_ssh_key" "default" {
  name       = "ssh-key"
  # Using absolute path to be safe, update filename if you use id_ed25519.pub
  public_key = file("~/.ssh/id_effect_flow.pub")
}

resource "hcloud_server" "web" {
  name        = "life-io-prod"
  image       = "ubuntu-24.04"
  server_type = "cax11"
  
  # ✅ FIX: Switch to Helsinki (hel1) where ARM stock is usually better
  location    = "hel1" 
  
  ssh_keys    = [hcloud_ssh_key.default.id]
  
  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  user_data = <<-EOF
    #!/bin/bash
    set -e

    # 1. Install Docker & Compose
    apt-get update
    apt-get install -y docker.io docker-compose-v2 git

    # 2. Setup App Directory
    mkdir -p /opt/life-io
    cd /opt/life-io

    # 3. Clone Repository
    git clone ${var.git_repo} .

    # 4. Create .env file for Docker Compose
    cat <<EOT > .env
    DB_PASSWORD=${var.db_password}
    JWT_SECRET=${var.jwt_secret}
    LOGTAIL_SOURCE_TOKEN=${var.logtail_token}
    BUCKET_NAME=${var.bucket_name}
    PUBLIC_AVATAR_URL=${var.public_avatar_url}
    AWS_ENDPOINT_URL_S3=${var.s3_endpoint}
    AWS_ACCESS_KEY_ID=${var.s3_access_key}
    AWS_SECRET_ACCESS_KEY=${var.s3_secret_key}
    AWS_REGION=${var.s3_region}
    GEMINI_API_KEY=${var.gemini_api_key}
    VAPID_PUBLIC_KEY=${var.vapid_public_key}
    VITE_VAPID_PUBLIC_KEY=${var.vapid_public_key}
    VAPID_PRIVATE_KEY=${var.vapid_private_key}
    VAPID_SUBJECT=${var.vapid_subject}
    # Ensure these point to the actual domain in prod, not localhost
    VITE_API_BASE_URL=https://${var.domain_name}
    VITE_WS_URL=wss://${var.domain_name}
    VITE_ROOT_DOMAIN=${var.domain_name}
    ROOT_DOMAIN=${var.domain_name}
    EOT

    # 5. Update Caddyfile with real domain
    if [ "${var.domain_name}" != ":80" ]; then
        echo "${var.domain_name} {" > Caddyfile
        echo "    reverse_proxy life-io-backend:42069" >> Caddyfile
        echo "}" >> Caddyfile
    fi

    # 6. Start the stack
    docker compose -f docker-compose.prod.yml up -d --build
  EOF
}
