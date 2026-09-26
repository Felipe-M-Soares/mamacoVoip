# Migrations do Mamacos Voip

São **5 arquivos**, em `migrations/`. Rode todos eles, em ordem
(001 → 005), no SQL Editor do Supabase.

| Arquivo | Conteúdo |
|---|---|
| `001_core.sql` | Perfis, servidores, canais, categorias |
| `002_messaging.sql` | Mensagens, anexos, reações, leitura, fixar, silenciar, modo lento |
| `003_social.sql` | Amizades, bloqueios, DM 1-pra-1, DM em grupo |
| `004_roles_moderation.sql` | Cargos, permissões, banimentos, log de moderação |
| `005_extras.sql` | Emoji customizado, threads, eventos do servidor |

## Pode rodar de novo sem medo

Todos os 5 arquivos são **seguros de rodar quantas vezes quiser**,
mesmo se seu banco já tiver tudo aplicado — cada `CREATE TABLE`,
`CREATE INDEX` e `CREATE TRIGGER` verifica se já existe antes de
criar de novo. Se aparecer algum aviso de "já existe" no meio do
caminho, é normal, não é erro.

Isso significa que, daqui pra frente, sempre que eu adicionar uma
funcionalidade nova, a mudança entra direto num desses 5 arquivos
(no lugar que já existe) — nunca mais vai aparecer um `006`, `007`,
etc. Só roda os 5 de novo e pronto.

## Voz e vídeo (LiveKit)

A partir desta versão, a transmissão de voz/vídeo/tela usa o
[LiveKit](https://livekit.io) (um SFU de verdade) em vez do mesh de
WebRTC manual de antes. Isso precisa de uma Edge Function própria
(`functions/livekit-token`) que emite o token de acesso — o par de
credenciais do LiveKit nunca pode ir pro código do cliente.

**1. Tenha um servidor LiveKit.** O mais simples é criar um projeto
grátis em [livekit.io/cloud](https://livekit.io/cloud) (o "LiveKit
Cloud") — ele te dá a URL (`wss://seu-projeto.livekit.cloud`) e o par
API Key/Secret na hora. Se preferir, também dá pra auto-hospedar
([docs.livekit.io/home/self-hosting](https://docs.livekit.io/home/self-hosting/)).

**2. Faça o deploy da Edge Function:**

```bash
supabase functions deploy livekit-token
```

**3. Configure as secrets da função** (Project Settings > Edge
Functions > Secrets no dashboard, ou via CLI):

```bash
supabase secrets set LIVEKIT_URL=wss://seu-projeto.livekit.cloud
supabase secrets set LIVEKIT_API_KEY=sua-api-key
supabase secrets set LIVEKIT_API_SECRET=seu-api-secret
```

Não precisa configurar nada no cliente (`.env`) — a URL do LiveKit
vem embutida no token que a função devolve.
