output "server_ip" {
  value = hcloud_server.web.ipv4_address
}

output "ssh_command" {
  value = "ssh root@${hcloud_server.web.ipv4_address}"
}
