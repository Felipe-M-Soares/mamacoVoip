#!/bin/bash
# Servidor de voz próprio do Mamacos Voip (LiveKit) — instalação automática.
#
# Cole este script INTEIRO no campo "Cloud-init script" ao criar a máquina
# na Oracle Cloud (Ubuntu 24.04). Ele roda sozinho no primeiro boot:
# instala o Docker, sobe o LiveKit (servidor de voz/vídeo) e o Caddy
# (certificado HTTPS automático) e abre as portas no firewall da máquina.
#
# ANTES DE COLAR: troque as duas linhas abaixo pela SUA chave e senha.
# NUNCA suba este arquivo preenchido pro GitHub (o repositório é público).
API_KEY="TROQUE_PELA_SUA_API_KEY"
API_SECRET="TROQUE_PELO_SEU_API_SECRET"

set -eux
export DEBIAN_FRONTEND=noninteractive

# --- Firewall da própria máquina (a imagem Ubuntu da Oracle bloqueia tudo) ---
iptables -I INPUT 1 -p tcp -m multiport --dports 80,443,7881 -j ACCEPT
iptables -I INPUT 1 -p udp --dport 3478 -j ACCEPT
iptables -I INPUT 1 -p udp --dport 50000:60000 -j ACCEPT
# Retransmissão (TURN) pra quem está atrás de rede muito fechada.
iptables -I INPUT 1 -p udp --dport 30000:40000 -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save; fi

# --- Docker ---
apt-get update
apt-get install -y docker.io curl
systemctl enable --now docker

# --- Endereço público: <ip-com-hífens>.sslip.io (não precisa comprar domínio) ---
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
