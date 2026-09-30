# Kit de teste de carga

Daqui (do ambiente de desenvolvimento) não dá pra testar a produção — não
há credenciais nem rede até o seu projeto. Este kit é pra **você** rodar.
Resultados e limites de cada plano: [`CAPACIDADE.md`](CAPACIDADE.md).

> **Rode num projeto de TESTE**, não no de produção: um segundo projeto
> Supabase (grátis) com as mesmas migrations 001–007, ou um branch
> (Supabase → Branching). O teste consome a cota do plano (mensagens de
> Realtime, conexões) e cria usuários.

## 1. Chat / Realtime (Supabase)

Precisa de Node 20+ e `npm install` feito na raiz do projeto (o kit usa o
`@supabase/supabase-js` que já vem com o app).

### 1a. Preparo (uma vez) — usa a service_role, SÓ na sua máquina

A service_role passa por cima de toda a segurança do banco. Ela é lida só
da variável de ambiente, nunca vai pro app, pro `.env` do Vite, pra um
commit ou pra um CI. O script de carga em si **não** usa ela.

PowerShell:

```powershell
$env:SUPABASE_URL = "https://SEU-PROJETO.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "..."   # Settings → API Keys → service_role / secret
$env:LOADTEST_N = "100"                  # quantos usuários de teste
node loadtest/preparar-usuarios.mjs
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

Cria `carga_0000…carga_0099` (e-mail `carga+0000@example.com`…, já
confirmados), o servidor "Teste de carga (carga)" com o canal `geral` e a
`Sala Geral`, e coloca todo mundo como membro. Grava
`loadtest/.carga-usuarios.json` (fora do git — tem a senha dos usuários de
teste). Rodar de novo reaproveita os mesmos usuários.

### 1b. Carga — só a chave pública (anon)

```powershell
$env:SUPABASE_URL = "https://SEU-PROJETO.supabase.co"
$env:SUPABASE_ANON_KEY = "..."   # a mesma do app (VITE_SUPABASE_ANON_KEY)
$env:CLIENTES = "100"; $env:TAXA_MSG = "5"; $env:DURACAO_S = "120"
node loadtest/carga-realtime.mjs
```

(Sem `SUPABASE_URL`/`SUPABASE_ANON_KEY`, ele usa `VITE_SUPABASE_*` do `.env`.)

Cada cliente é uma "pessoa com o app aberto": um WebSocket próprio, login,
presença na sala de voz de teste (`voice:<id>`, privado), `postgres_changes`
de INSERT em `messages` do canal de teste (igual `useMessages.ts`) e
broadcast em `typing:<canal>` (igual ao "digitando…").

| Variável | Padrão | O que é |
|---|---|---|
| `CLIENTES` | todos do arquivo | clientes simultâneos |
| `RAMPA_POR_S` | 10 | clientes novos por segundo (o plano limita *channel joins*/s: Free 100, Pro 500) |
| `TAXA_MSG` | 2 | mensagens por segundo no total (máx. 0,7 × clientes — o banco aceita 8 msgs/10s por pessoa) |
| `DURACAO_S` | 60 | tempo enviando |
| `MODO` | `ambos` | `postgres`, `broadcast` ou `ambos` |
| `PRESENCA` | 1 | 0 = não entra na presença |
| `PG_PRIVADO` | 0 | 1 = assina o `postgres_changes` num canal privado (se o seu projeto recusar canais públicos) |

Relatório: `loadtest/relatorios/carga-<data>.md` e `.json` com p50/p95/p99
de login, inscrição, INSERT (HTTP) e **entrega** (envio → chegada em cada
cliente) de `postgres_changes` e de broadcast, % de entregas, quedas de
canal, erros por tipo e o atraso do próprio Node (se passar de 100 ms, a
máquina do teste virou o gargalo — divida os clientes em 2+ terminais,
cada um com um `LOADTEST_ARQUIVO` com parte dos usuários, ou rode numa VM).

Sugestão de escada: 25 → 50 → 100 → 150 → 190 clientes (Free) ou até 450
(Pro com teto de gastos), `TAXA_MSG` 2 → 5 → 10. Pare quando aparecer
erro de inscrição/`too many`, entrega < 99% ou p95 subindo muito.

### 1c. Limpeza

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = "..."
node loadtest/limpar.mjs                        # apaga o servidor de teste (e as mensagens)
$env:LIMPAR_USUARIOS = "1"; node loadtest/limpar.mjs   # também apaga os usuários de teste
```

## 2. Voz e vídeo (LiveKit) — `lk` CLI

Instale o [LiveKit CLI](https://github.com/livekit/livekit-cli)
(`winget install LiveKit.LiveKitCLI`, `brew install livekit-cli` ou
`curl -sSL https://get.livekit.io/cli | bash`) e cadastre o projeto (mesmas
chaves das secrets da Edge Function `livekit-token`) — `lk cloud auth` faz
isso pelo navegador, ou à mão:

```bash
lk project add --url wss://SEU-PROJETO.livekit.cloud --api-key API_KEY --api-secret API_SECRET mamacos
```

(Ou passe `--url/--api-key/--api-secret` em cada comando, ou as variáveis
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.)

Use uma sala com nome de teste (não um id de canal real). No CLI atual o
comando é `lk perf load-test` (o antigo `lk load-test` ainda funciona, mas
ficou escondido; em versões velhas do CLI só existe ele).
`lk perf load-test --help` mostra tudo:

```bash
# Sala de voz: 10 pessoas falando revezado + 40 só ouvindo, 2 minutos
lk perf load-test --room carga-voz --audio-publishers 10 --subscribers 40 --duration 2m --num-per-second 5

# Chamada com câmera: 8 câmeras (simulcast 720/360/180), grade 3x3
lk perf load-test --room carga-camera --video-publishers 8 --subscribers 8 --layout 3x3 --duration 2m

# "Transmissão": 1 tela em alta, 30 assistindo
lk perf load-test --room carga-live --video-publishers 1 --video-resolution high --subscribers 30 --duration 2m
```

Flags principais: `--audio-publishers`, `--video-publishers`,
`--subscribers`, `--video-resolution low|medium|high`, `--video-codec`, `--no-simulcast`,
`--num-per-second`, `--layout speaker|3x3|4x4|5x5`, `--simulate-speakers`,
`--duration`. O relatório final mostra, por assinante, faixas recebidas,
bitrate, latência e perda (`Total Dropped`).

Importante:

- **Sua internet é o limite.** 30 assinantes de 1080p60 (~7 Mbps cada) =
  ~210 Mbps de download na máquina do teste. Pra números altos rode numa
  VM na nuvem (de preferência em São Paulo), com
  `ulimit -n 65535` antes.
- Isso **gasta a cota** do LiveKit Cloud: cada participante simulado conta
  minutos de conexão e cada assinante conta banda. O plano Build (grátis)
  tem 5.000 minutos e 50 GB/mês — 30 assinantes de vídeo por 2 min já são
  60 minutos e ~3 GB.
- O CLI simula o **servidor** (SFU e rede). Pro custo do lado do app
  (CPU do computador de quem transmite, codificação), teste manualmente
  com 2–3 computadores reais.
