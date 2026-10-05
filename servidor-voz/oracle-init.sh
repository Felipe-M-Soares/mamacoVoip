#!/bin/bash
API_KEY="TROQUE_PELA_SUA_API_KEY"
API_SECRET="TROQUE_PELO_SEU_API_SECRET"
set -eux
export DEBIAN_FRONTEND=noninteractive
iptables -I INPUT 1 -p tcp -m multiport --dports 80,443,7881 -j ACCEPT
iptables -I INPUT 1 -p udp --dport 3478 -j ACCEPT
iptables -I INPUT 1 -p udp --dport 50000:60000 -j ACCEPT
iptables -I INPUT 1 -p udp --dport 30000:40000 -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save; fi
apt-get update
apt-get install -y docker.io curl
systemctl enable --now docker
IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
DOMAIN="$(echo "$IP" | tr . -).sslip.io"
mkdir -p /opt/livekit
cat > /opt/livekit/livekit.yaml <<CONF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
turn:
  enabled: true
  udp_port: 3478
  domain: $DOMAIN
keys:
  $API_KEY: $API_SECRET
logging:
  level: info
CONF
cat > /opt/livekit/Caddyfile <<CONF
$DOMAIN {
  reverse_proxy 127.0.0.1:7880
}
CONF
docker rm -f livekit caddy 2>/dev/null || true
docker run -d --name livekit --restart unless-stopped --network host \
  -v /opt/livekit/livekit.yaml:/livekit.yaml:ro \
  livekit/livekit-server:latest --config /livekit.yaml
docker run -d --name caddy --restart unless-stopped --network host \
  -v /opt/livekit/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data \
  caddy:2
echo "LIVEKIT_URL=wss://$DOMAIN" > /opt/livekit/endereco.txt
