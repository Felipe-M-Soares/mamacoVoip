# Servidor de voz próprio (sem LiveKit Cloud)

O Mamacos Voip usa o LiveKit para voz, vídeo e transmissões. O LiveKit é um
programa gratuito; o que tinha limite era o serviço pago deles (LiveKit
Cloud: 50 GB e 5.000 minutos por mês no plano grátis). Aqui o mesmo
programa roda numa máquina sua, na Oracle Cloud, no plano **Always Free**
(gratuito para sempre, com 10 TB de dados por mês).

Nada muda para quem usa o app: só troca o endereço do servidor de voz.

---

## 1. Criar a conta na Oracle Cloud

1. Acesse **oracle.com/cloud/free** e clique em **Start for free**.
2. Preencha os dados. Ela pede um cartão só para confirmar identidade
   (pode aparecer uma cobrança de verificação que é estornada). O plano
   Always Free não cobra nada.
3. **Home Region:** escolha **Brazil East (São Paulo)** (ou Vinhedo). Isso
   não pode ser mudado depois, e quanto mais perto, menor o ping.

## 2. Criar a máquina

1. No painel, abra o menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name:** `mamacos-voz`.
3. **Image and shape** → **Edit**:
   - **Image:** Canonical **Ubuntu 24.04**.
   - **Shape:** **Ampere** → `VM.Standard.A1.Flex` com **2 OCPU e 12 GB**
     (tem o selo "Always Free-eligible").
   - Se aparecer "Out of capacity", tente de novo mais tarde ou use
     **AMD** → `VM.Standard.E2.1.Micro` (também grátis; aguenta um grupo
     pequeno).
4. **Networking:** deixe criar a rede nova e marque **Assign a public IPv4 address**.
5. **Add SSH keys:** pode escolher "No SSH keys" (não vamos usar terminal).
6. Clique em **Show advanced options** → aba **Management** →
   **Paste cloud-init script** e cole o conteúdo do arquivo
   **`servidor-voz-PRIVADO.sh`** (o que já vem com a sua chave e senha —
   NÃO o `oracle-init.sh` deste repositório, que está sem elas).
7. Clique em **Create**. Em 1–2 minutos ela fica "Running".
8. Anote o **Public IP address** que aparece na página da máquina
   (ex.: `150.230.10.20`).

## 3. Liberar as portas na rede da Oracle

1. Na página da máquina, clique na **Subnet** (em "Primary VNIC") →
   **Security Lists** → **Default Security List**.
2. **Add Ingress Rules** — adicione estas linhas (Source CIDR `0.0.0.0/0`
   em todas):

| Protocolo | Porta (Destination Port Range) | Para quê |
|---|---|---|
| TCP | 80 | Certificado HTTPS |
| TCP | 443 | Conexão do app |
| TCP | 7881 | Voz por TCP (redes que bloqueiam UDP) |
| UDP | 3478 | Ajuda de conexão (TURN) |
| UDP | 50000-60000 | Áudio e vídeo |
| UDP | 30000-40000 | Retransmissão (TURN) |

## 4. Conferir se está no ar

Uns 5 minutos depois de criar, abra no navegador:

```
https://SEU-IP-COM-HIFENS.sslip.io
```

Ex.: IP `150.230.10.20` → `https://150-230-10-20.sslip.io`

Se aparecer **OK**, o servidor está funcionando. (O `sslip.io` é um
endereço gratuito que aponta automaticamente pro seu IP — não precisa
comprar domínio.)

## 5. Apontar o app para o servidor novo

No Supabase: **Edge Functions** → **Secrets** (ou Project Settings →
Edge Functions). Troque os três valores:

| Nome | Valor |
|---|---|
| `LIVEKIT_URL` | `wss://SEU-IP-COM-HIFENS.sslip.io` |
| `LIVEKIT_API_KEY` | a chave que está no `servidor-voz-PRIVADO.sh` |
| `LIVEKIT_API_SECRET` | a senha que está no `servidor-voz-PRIVADO.sh` |

Pronto: a próxima pessoa que entrar numa sala já usa o servidor novo.
Quem estava numa chamada só precisa sair e entrar de novo.

**Voltar pro LiveKit Cloud** (se precisar): é só colocar de volta os três
valores antigos nos Secrets.

---

## Bom saber

- **Custo:** zero dentro do Always Free (até 4 OCPU / 24 GB ARM e 10 TB de
  saída por mês na conta toda).
- **Máquina parada demais:** a Oracle pode recuperar máquinas Always Free
  que ficam quase sem uso por vários dias. Se acontecer, crie de novo com
  o mesmo script (o IP muda — atualize o `LIVEKIT_URL`). Converter a conta
  para "Pay As You Go" evita isso e continua sem cobrança enquanto você
  ficar dentro dos limites grátis.
- **Se a voz parar:** reiniciar a máquina pelo painel (Reboot) sobe o
  servidor de voz de novo sozinho, sem precisar de terminal.
