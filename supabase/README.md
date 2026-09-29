# Migrations do Mamacos Voip

São os arquivos em `migrations/` (001 a 015 — o 006 nunca existiu).
Rode todos eles, em ordem, no SQL Editor do Supabase. Se
preferir rodar tudo de uma vez, use o arquivo único consolidado
(`mamacoVoip_setup_completo.sql`, se você tiver recebido um).

| Arquivo | Conteúdo |
|---|---|
| `001_core.sql` | Perfis, servidores, canais, categorias |
| `002_messaging.sql` | Mensagens, anexos, reações, leitura, fixar, silenciar, modo lento |
| `003_social.sql` | Amizades, bloqueios, DM 1-pra-1, DM em grupo |
| `004_roles_moderation.sql` | Cargos, permissões, banimentos, log de moderação |
| `005_extras.sql` | Emoji customizado, threads, eventos do servidor |
| `007_server_members_realtime.sql` | Corrige Realtime de membros do servidor |
| `008_profile_asset_size.sql` | Limite de tamanho de assets de perfil |
| `009_dm_unhide_on_recreate.sql` | Corrige DM escondida reaparecer ao recriar |
| `010_google_oauth_profile.sql` | Perfil automático ao entrar com Google |
| `011_security_hardening.sql` | Correções de segurança (RLS, permissões órfãs, funções `security definer`) |
| `012_content_reports.sql` | Sistema de denúncias |
| `013_audit_fixes.sql` | Auditoria de segurança: 2FA cobrado no banco, bloqueio de mover/forjar mensagens, grupos de DM fechados, hierarquia de cargos, convites fortes, validação de perfil/URLs, Storage, limites anti-flood e índices |
| `014_move_members.sql` | Mover membros entre canais de voz (arrastar estilo Discord): permissão `move_members`, tabela `voice_move_requests` (Realtime, só o alvo lê), RPC `move_voice_member` (valida permissão, hierarquia, canal de voz e acesso) e ação `member_moved` no log de moderação |
| `015_nsfw_channels.sql` | Canais com restrição de idade (+18): `channels.is_nsfw` e `profiles.age_verified_adult_at` (confirmação de idade, carimbada com a hora do servidor) |

### Depois de rodar a 013

- Quem tem 2FA ativado passa a ser **obrigado** a digitar o código pra
  a API responder (antes era só a tela do app que cobrava).
- Funções RPC deixam de ser chamáveis sem login (papel `anon`), exceto
  `is_username_available` (usada no cadastro).
- Confira em **Storage → Policies** se existem políticas antigas no
  bucket `soundboard` com nomes diferentes de `soundboard_objects_*` —
  políticas se somam, então uma antiga mais permissiva continuaria
  valendo.
- Se aparecer o aviso "Existem usernames repetidos ignorando
  maiúsculas", resolva as duplicatas e rode a 013 de novo.

### Depois de rodar a 015

- Em **Editar canal** (canais de texto) aparece "Canal +18 (restrição
  de idade)". Quem abre um canal marcado vê um aviso de idade antes do
  conteúdo; a confirmação fica no perfil e pode ser revogada em
  Configurações › Privacidade.
- O seletor de GIF usa `rating=r` **só** nesses canais (é o máximo que
  a API da GIPHY oferece — ela não tem pornografia explícita). Em
  canais comuns e DMs continua `pg-13`.
- Antes de rodar a 015 o app continua funcionando: o selo/aviso só
  aparece quando a coluna existe.

### Depois de rodar a 014

- Aparece a permissão **Mover membros** nos cargos (dono e
  `administrator` já podem). Arrastar alguém na lista de voz da barra
  lateral (ou botão direito → "Mover para…") chama `move_voice_member`;
  o app da pessoa movida escuta `voice_move_requests` e troca de sala
  sozinho. Confira em **Database → Publications** que
  `voice_move_requests` está em `supabase_realtime`.

## Pode rodar de novo sem medo

Todos os arquivos são **seguros de rodar quantas vezes quiser**, mesmo
se seu banco já tiver tudo aplicado — cada `CREATE TABLE`, `CREATE
INDEX` e `CREATE TRIGGER` verifica se já existe antes de criar de
novo. Se aparecer algum aviso de "já existe" no meio do caminho, é
normal, não é erro.

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

## Impedir que o Supabase pause (plano grátis)

O plano grátis do Supabase pausa o projeto sozinho depois de um tempo
sem atividade real de API — e um projeto pausado derruba o app inteiro
até alguém entrar no dashboard e reativar na mão. Tem dois esquemas
prontos pra evitar isso, use um ou os dois juntos (são independentes):

**Opção 1 — dentro do próprio Supabase (`keepalive.sql`).** O banco se
auto-pinga sozinho, sem depender de nada externo, via `pg_cron` +
`pg_net`. Abra `supabase/keepalive.sql`, troque os dois placeholders
(URL do projeto e anon key — os dois já estão no seu `.env`) pelos seus
valores reais, e rode o arquivo inteiro no SQL Editor. Verifique depois
com `select * from cron.job;`.

**Opção 2 — GitHub Actions (`.github/workflows/supabase-keepalive.yml`).**
Roda nos servidores do GitHub em vez de dentro do banco — útil como
segunda camada, já que continua funcionando mesmo se o projeto já
tiver pausado por algum outro motivo (o pg_cron para junto com o
banco pausado; isso aqui não). Precisa só cadastrar dois secrets no
repositório (`SUPABASE_URL` e `SUPABASE_ANON_KEY`, mesmos valores do
`.env`) — ver o comentário no topo do arquivo do workflow pro passo a
passo.

Os dois rodam a cada 3 dias — bem dentro da janela de 7 dias de
inatividade que causaria a pausa, com folga mesmo se um ciclo falhar.
