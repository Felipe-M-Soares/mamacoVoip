# Capacidade estimada por plano (Supabase + LiveKit Cloud)

Limites consultados em **29/09/2026** nas páginas oficiais (fontes no fim).
Preços em dólar. As contas abaixo são **estimativas** a partir do jeito que
o app usa cada serviço hoje — confirme com o kit de carga (`README.md`) no
seu projeto de teste e com a aba **Usage** dos dois painéis depois de
algumas semanas de uso real.

## 1. Os limites que importam

### Supabase

| | Free (US$ 0) | Pro (US$ 25) — com teto de gastos | Pro sem teto / Team |
|---|---|---|---|
| Conexões Realtime simultâneas (pico) | **200** | **500** | 10.000 (US$ 10 por 1.000 acima de 500) |
| Mensagens Realtime por segundo | 100 | 500 | 2.500 |
| Entradas em canal por segundo | 100 | 500 | 2.500 |
| Mensagens de presença por segundo | 20 | 50 | 1.000 |
| Canais por conexão | 100 | 100 | 100 |
| Mensagens Realtime por mês | **2 milhões** | **5 milhões** + US$ 2,50/milhão | idem |
| Egress (saída de dados) | **5 GB** (+5 GB em cache) | 250 GB + US$ 0,09/GB | idem |
| Banco | 500 MB (compartilhado; pausa após 1 semana parado) | 8 GB + US$ 0,125/GB, compute Micro | idem |
| Storage | 1 GB | 100 GB | idem |
| Edge Functions | 500 mil chamadas | 2 milhões | idem |
| Usuários ativos/mês (Auth) | 50 mil | 100 mil | idem |

Como o Supabase conta "mensagem de Realtime": **cada entrega conta**. Uma
mudança no banco (postgres_changes) = 1 por cliente que recebe; um
broadcast = 1 enviado + 1 por cliente que recebe; presença também conta.

### LiveKit Cloud

| | Build (grátis) | Ship (a partir de US$ 50) | Scale (a partir de US$ 500) |
|---|---|---|---|
| Minutos de participante WebRTC/mês | **5.000** | 150.000 | 1.500.000 |
| Minuto extra | US$ 0,0005 | US$ 0,0005 | US$ 0,0004 |
| Conexões simultâneas (todas as salas) | **100** | 1.000 | 5.000 |
| Banda de descida (servidor → pessoas)/mês | **50 GB** | 250 GB | 3 TB |
| GB extra | US$ 0,12 | US$ 0,12 | US$ 0,10 |
| Fixar região | não | não | sim (pedido ao suporte) |

Um "minuto de participante" = 1 pessoa conectada 1 minuto (5 pessoas por
1 hora = 300 minutos). O LiveKit Cloud tem região no **Brasil** e liga cada
um ao ponto mais próximo (ver `docs/PING.md`).

## 2. Quanto o app gasta (modelo)

**Conexões Supabase:** 1 por app aberto (web, desktop ou celular). Todos os
canais (chat, presença, "digitando…", voz) andam dentro desse WebSocket.

**Mensagens Realtime por mensagem de chat** num canal com **V** pessoas
olhando: `V` (o INSERT chega pra cada uma) + ~3 avisos de "digitando…" ×
`(1 + V)` ≈ **4·V + 3**. Com V = 8: ~35 mensagens de Realtime por
mensagem de chat. (O "digitando…" é a maior fatia — ver seção 5.)

**Presença "online":** o app inteiro usa um único tópico `presence:online`.
Cada vez que alguém abre/fecha o app (ou a rede cai e volta), **todos** os
que estão online recebem o aviso: ≈ `C` mensagens por evento, com `C` =
pessoas online no momento. Isso cresce com o quadrado do número de usuários.

**Voz:** Opus até 64 kbps + RED, com DTX (silêncio quase não gasta): cada
pessoa recebe ~80 kbps por pessoa FALANDO ao mesmo tempo ≈ 36 MB/hora.
**Câmera:** 720p30 em simulcast; como o `adaptiveStream` está desligado
(ver `VoiceContext.tsx`), cada espectador recebe a camada mais alta
(~1,7 Mbps por câmera). **Transmissão "Jogo" 1080p60:** 7 Mbps, sem
simulcast ⇒ **3,15 GB por espectador por hora**.

## 3. Cenários

Premissas: cada pessoa ativa no dia abre/fecha/reconecta o app ~6 vezes;
cada mensagem gera ~3 avisos de "digitando…"; 30 dias/mês.

| Cenário | Pessoas ativas/dia | Online em média (pico) | Mensagens/dia | V | Mensagens Realtime/mês |
|---|---|---|---|---|---|
| A — grupo de amigos | 30 | 10 (25) | 1.500 | 5 | ~1,1 milhão (presença 0,06 M + chat 0,23 M + digitando 0,81 M) |
| B — comunidade pequena | 150 | 40 (120) | 8.000 | 15 | ~16 milhões (1,1 + 3,6 + 11,5) |
| C — servidor grande | 1.000 | 250 (600) | 40.000 | 40 | ~240 milhões (45 + 48 + 148) |

### Só chat

| Plano | Até onde vai | Gargalo |
|---|---|---|
| **Supabase Free** | Cenário **A** tranquilo. Uns **~1.900 mensagens de chat/dia** com ~8 pessoas por canal esgotam os 2 M/mês. Teto duro: **200 apps abertos** ao mesmo tempo. | Cota de mensagens Realtime ("digitando…" + presença), depois as 200 conexões. Banco de 500 MB ≈ 800 mil mensagens. |
| **Supabase Pro** (teto ligado) | Cenário **B**: ~16 M mensagens ⇒ US$ 25 + ~US$ 28 de excedente. **500 apps abertos** no máximo. | 500 conexões (desligar o teto libera até 10.000 a US$ 10/1.000). |
| **Pro sem teto** | Cenário **C** funciona até ~**2.000–3.000 online**, mas custa ~US$ 590/mês só de mensagens Realtime. | Presença global (N²), `postgres_changes` sem filtro (1 checagem de RLS por assinante por evento, fila única — o Supabase recomenda Broadcast acima de ~3.000 assinantes) e o custo das mensagens. Precisa das mudanças da seção 5. |

### Voz (X pessoas por sala)

Simultâneos em voz = soma de todas as salas.

| Plano | Simultâneos em voz | Uso mensal incluso | Exemplos |
|---|---|---|---|
| **Build** | **100** (ex.: 10 salas × 10, 4 × 25) | 5.000 min ≈ **83 horas-pessoa** | 5 amigos 2 h/dia = 18.000 min ⇒ passa (13.000 × US$ 0,0005 = ~US$ 6,50, se o plano deixar exceder) |
| **Ship** | 1.000 | 150.000 min ≈ 2.500 h-pessoa | Cenário B com 30 pessoas 3 h/dia = 162.000 min ⇒ US$ 50 + ~US$ 6 |
| **Scale** | 5.000 | 1,5 M min | Cenário C, 200 pessoas 3 h/dia = 1,08 M min ⇒ US$ 500 |

Banda de voz raramente é o limite: 5.000 min de voz ≈ 3 GB. Numa sala
grande (25+), o que pesa é o computador/celular de cada um e a interface
(grade), não o servidor — o próprio LiveKit mediu 10 falando + 3.000
ouvindo num servidor de 16 núcleos.

### Transmissão de tela 1080p60 (preset "Jogo", 7 Mbps)

| Plano | Horas-espectador/mês inclusas | Depois |
|---|---|---|
| **Build** | 50 GB ÷ 3,15 ≈ **16 h** (ex.: UMA live de 2 h com 8 assistindo) | — |
| **Ship** | 250 GB ≈ **79 h** | US$ 0,12/GB ≈ **US$ 0,38 por espectador-hora** |
| **Scale** | 3 TB ≈ 950 h | US$ 0,10/GB ≈ US$ 0,32 por espectador-hora |

Cada espectador também ocupa 1 conexão simultânea do plano. O upload de
quem transmite (7 Mbps + áudio) não é cobrado, mas precisa caber na
internet dele.

## 4. Onde está o gargalo, em ordem

1. **LiveKit Build, banda:** a transmissão 1080p60 acaba com os 50 GB em
   poucas lives. Primeiro limite que um grupo de amigos encontra.
2. **LiveKit Build, minutos e 100 simultâneos:** voz diária de um grupo de
   5+ pessoas passa dos 5.000 minutos.
3. **Supabase, mensagens Realtime:** "digitando…" e presença global.
4. **Supabase, egress:** anexos (imagens/vídeos) baixados por URL assinada.
   Antes desta revisão, a checagem de "não lidos" baixava até 2.000 linhas
   a cada 20 s por pessoa — com o histórico passando de 1.000 mensagens,
   isso sozinho dava ~117 GB/mês no cenário A (o Free tem 5 GB). Agora é
   uma consulta só que devolve poucas linhas (~1 GB/mês no mesmo cenário).
5. **Supabase, conexões:** 200 (Free) / 500 (Pro com teto).
6. **Banco:** 500 MB no Free ≈ 800 mil mensagens (cenário B enche em ~3–4 meses).

## 5. Revisão do cliente: o que escala mal

Corrigido nesta revisão (baratos):

- **Não lidos** (`useUnreadOverview.ts`): eram 7 consultas + até 2.000
  linhas a cada 20 s por pessoa; agora 1 RPC `unread_overview()` (migration
  007, parte nova) que devolve só o que está não lido. Sem a função no
  banco, o app usa o caminho antigo.
- **"Digitando…"** (`useTypingIndicator.ts`): 1 aviso a cada 3 s (era 2 s),
  indicador dura 5 s — ~1/3 menos mensagens Realtime, sem piscar.
- **Membros de grupo** (`GroupConversationsContext.tsx`): a tabela passou a
  ir pro Realtime (antes o evento nem chegava). Como o Realtime **não
  filtra DELETE**, sem cuidado cada pessoa saindo de QUALQUER grupo faria
  todo mundo online recarregar a lista — o app agora confere se o DELETE
  é seu antes.

Pendentes (não são baratos — fazer quando crescer):

1. **Presença global `presence:online`** (`PresenceContext.tsx`): N² — com
   250 online, ~45 M mensagens/mês só disso. Caminho: presença só entre
   amigos/servidores (tópicos menores) ou "visto por último" gravado no
   banco + aviso só pros amigos.
2. **Listeners sem filtro** em `useMessages.ts`, `useDirectMessages.ts`,
   `useGroupMessages.ts` e `FriendsContext.tsx`: DELETE de mensagens/
   reações/amizades (o Realtime manda o DELETE do app inteiro pra todo
   mundo com um chat aberto — só o id, sem vazar conteúdo) e INSERT de
   reações/anexos (cada um passa pela RLS de **todos** os assinantes).
   Caminho recomendado pelo Supabase: **Broadcast a partir do banco**
   (`realtime.broadcast_changes` em gatilhos) em tópicos privados por canal
   (`chat:<canal>`), autorizados uma vez ao entrar — a infraestrutura de
   tópicos privados (`realtime_topic_allowed`) já existe.
3. **Câmeras sem `adaptiveStream`**: cada espectador puxa a camada 720p de
   todas as câmeras. Dá pra pedir a camada baixa pros quadrinhos pequenos
   (`RemoteTrackPublication.setVideoQuality`).
4. **Transmissão 1080p60 sem simulcast**: todo espectador recebe 7 Mbps; um
   simulcast com camada 720p30 cortaria a banda de quem assiste em
   miniatura ou com internet fraca.
5. **Barra lateral de voz**: 1 inscrição de presença por sala de voz do
   servidor aberto (limite de 100 canais por conexão — ok até servidores com
   dezenas de salas).

## 6. O que fazer ao crescer

1. **Agora:** rode o `007` (não lidos + grupos). Se o Supabase não estiver
   em `sa-east-1`, planeje a migração (`docs/PING.md`).
2. **Quando fizer lives ou voz todo dia:** LiveKit **Ship** (US$ 50) — é o
   primeiro limite. Pra lives, prefira 1080p30/720p60 quando não precisar
   de 60 fps (metade da banda).
3. **Passou de ~1.500 mensagens de chat/dia ou ~150 online:** Supabase
   **Pro** (US$ 25), com o teto de gastos ligado no começo.
4. **Passou de ~400 online no pico:** desligue o teto de gastos no Pro (500
   conexões é duro com ele ligado) e acompanhe a aba Usage.
5. **Rumo a 1.000+ online:** itens 1 e 2 da seção 5 (presença menor e
   Broadcast a partir do banco); compute maior no Supabase ajuda o banco,
   mas **não** acelera `postgres_changes` (fila única).
6. **Banda de vídeo cara:** LiveKit auto-hospedado numa VPS em São Paulo
   (banda de VPS costuma ser bem mais barata que US$ 0,12/GB); o app só
   precisa trocar as secrets `LIVEKIT_*`.

## Fontes

- Supabase — limites do Realtime: https://supabase.com/docs/guides/realtime/limits
- Supabase — preços: https://supabase.com/pricing
- Supabase — como contam as mensagens Realtime: https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages
- Supabase — conexões de pico: https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections
- Supabase — limites de Postgres Changes (RLS por assinante, fila única, DELETE sem filtro): https://supabase.com/docs/guides/realtime/postgres-changes
- LiveKit Cloud — preços e limites: https://livekit.com/pricing
- LiveKit — benchmarks e `lk perf load-test`: https://docs.livekit.io/transport/self-hosting/benchmark.md e https://github.com/livekit/livekit-cli
- LiveKit — regiões (inclui Brasil): https://docs.livekit.io/deploy/admin/regions/endpoints
