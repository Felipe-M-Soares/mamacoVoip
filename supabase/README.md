# Migrations do Mamacos Voip

São **7 arquivos** em `migrations/`, rodados em ordem no SQL Editor do
Supabase. (Antes eram 16 — 001 a 005 e 007 a 017; as antigas 007–012
viraram o `006` e as antigas 013–017 viraram o `007`.)

## Qual arquivo eu rodo?

| Você já rodou… | Rode agora |
|---|---|
| Nada (banco novo) | `001` → `002` → `003` → `004` → `005` → `006` → `007`, nessa ordem |
| As antigas 001 a 012 (e talvez algumas de 013–017) | **Só o `007_seguranca_e_recursos_2026.sql`** |
| Todas as antigas, até a 017 | **Só o `007_seguranca_e_recursos_2026.sql`** (traz as partes novas: apagar grupo e não lidos) |

- O `007` é **idempotente de ponta a ponta**: pode rodar de novo quantas
  vezes quiser, inclusive num banco que já tenha rodado qualquer uma
  das antigas 013–017. Não precisa saber quais delas você rodou.
- O `006` é a concatenação **exata** das antigas 007–012 (só ganhou
  comentários de seção). Quem já rodou as antigas 007–012 **não** roda o
  006.
- `001`–`005`: iguais aos de antes, exceto que dois trechos do `002`
  (a tabela `dm_read_state` e a política `messages_pin_update`) foram
  **movidos** pro fim do `003` e do `004` — eles usavam coisas que só
  nascem nesses arquivos, e a instalação do zero quebrava no `002`.
  Mesmo SQL; pra quem já rodou, nada muda.
- Comentários no código que citam "migration 013/014/015/016/017" se
  referem às **partes** de mesmo nome dentro do `007` (cada parte começa
  com um cabeçalho `PARTE 013 (antiga 013_audit_fixes.sql)` etc.).

| Arquivo | Conteúdo |
|---|---|
| `001_core.sql` | Perfis, servidores, canais, categorias |
| `002_messaging.sql` | Mensagens, anexos, reações, leitura, fixar, silenciar, modo lento |
| `003_social.sql` | Amizades, bloqueios, DM 1-pra-1, DM em grupo (+ `dm_read_state`) |
| `004_roles_moderation.sql` | Cargos, permissões, banimentos, log de moderação (+ política de fixar mensagem) |
| `005_extras.sql` | Emoji customizado, threads, eventos do servidor |
| `006_ajustes_2025.sql` | Antigas 007–012: Realtime de membros do servidor, limite de tamanho de assets de perfil, DM escondida reaparecendo, perfil automático do login com Google, endurecimento de segurança (RLS, permissões órfãs, `security definer`), sistema de denúncias |
| `007_seguranca_e_recursos_2026.sql` | Antigas 013–017 + apagar grupo + não lidos numa consulta só. **013**: auditoria (2FA cobrado no banco, grupos fechados, hierarquia de cargos, convites fortes, validação de perfil/URLs, Storage, limites anti-flood, índices). **014**: mover membros entre salas de voz (`move_members`, `voice_move_requests`, `move_voice_member`). **015**: canais +18. **016**: segurança parte 2 (Realtime Authorization, soundboard via RPC, canal restrito também em anexos/reações/threads, 2FA nas RPCs e no Storage, idade em `user_private_settings`, URLs presas ao Storage). **017**: anexos privados (URL assinada, `file_url` com caminho, `orphan_attachment_objects()`). **Novas**: apagar grupo e `unread_overview()` (ver abaixo) |

Ao juntar as antigas 013–017 no `007`, as definições repetidas saíram:
quando uma função ou política era recriada mais abaixo com o mesmo
nome, ficou só a última versão (um comentário marca onde ela está). Foi
conferido num Postgres 16 com um esquema simulado do Supabase: sobre os
mesmos 001–005, aplicar as antigas 007–017 (+ o SQL das partes novas) ou os novos 006+007 dá o
**mesmo** catálogo (`pg_dump --schema-only` idêntico: tabelas, funções,
políticas, gatilhos, permissões, publicação do Realtime); rodar o `007`
por cima de um banco que já tinha as antigas até a 012 ou até a 014 dá
exatamente o mesmo resultado, e por cima das antigas até a 017 (ou
rodando-o duas vezes) a única diferença é um `REVOKE` extra, inofensivo,
numa função de gatilho que não é mais usada
(`stamp_profile_age_verification`).

### Depois de rodar o 007 (PARTE 19 — revisão final) — faça no painel

1. **Configure a URL do projeto (recomendado)** — no SQL Editor:

   ```sql
   alter database postgres set app.settings.supabase_url = 'https://<ref>.supabase.co';
   ```

   (Use o mesmo valor de `VITE_SUPABASE_URL`; com domínio próprio, o
   domínio próprio.) As URLs de avatar/banner/ícone/emoji/anexo só são
   aceitas se apontarem pro Storage **deste** projeto. Sem essa
   configuração o banco usa o host da própria requisição (cabeçalho
   `x-forwarded-host`/`host` que o PostgREST repassa em `request.headers`)
   — funciona, mas a configuração explícita é mais previsível. Antes
   valia **qualquer** `*.supabase.co` (dava pra apontar pra um projeto do
   atacante e rastrear IP).
2. **Realtime → Settings → desligar "Allow public access"** (se ainda
   não desligou). Agora **todos** os canais do app são privados — inclusive
   os de `postgres_changes` (tópicos `pgc:*`, liberados só pra leitura a
   quem está logado; o conteúdo continua filtrado pela RLS de cada tabela).
3. **Administrador da plataforma** (recebe denúncias de usuário/DM/grupo
   e as escaladas pelos moderadores): pegue seu id em **Authentication →
   Users** e rode no SQL Editor:

   ```sql
   insert into public.app_admins values ('<seu uuid>');
   ```

   Não há política de INSERT pra ninguém pela API — só pelo SQL Editor.
   RPCs novas: `is_app_admin()`, `admin_report_context(report_id)`,
   `admin_remove_reported_message(report_id)`.
4. **Deploy das Edge Functions**: `supabase functions deploy
   livekit-moderate` (agora exige o 2FA do moderador e não devolve erro
   interno cru) e `supabase functions deploy livekit-token` (grupo: só
   membro atual ganha token).
5. Outras mudanças: criador que saiu do grupo perde o acesso (quem cria
   vira membro por gatilho); moderador não tira o próprio castigo;
   buckets públicos não podem mais ser **listados** (a URL pública continua
   funcionando); upload no soundboard só no caminho de um som criado antes
   (limite de 60 sons por servidor e 10 por pessoa); aceite dos termos
   (`accept_terms(p_version, p_is_adult)` → colunas `terms_accepted_at`,
   `terms_version`, `age_declared_adult_at` em `user_private_settings`).
   **Atualize o app junto**: versões antigas deixam de criar grupo
   (liam o grupo antes de virar membro) e de enviar som (subiam o arquivo
   antes de criar a linha).

### Depois de rodar o 007 (parte nova: apagar grupo)

- Quem **criou** um grupo vê "Apagar grupo" no topo da conversa e no
  botão direito do grupo na barra lateral. Apaga mensagens, anexos e
  membros (cascata no banco) e os arquivos do bucket `group-attachments`
  (pela API do Storage, antes de apagar o grupo). Os outros membros só
  têm "Sair do grupo".
- O banco ganhou `is_group_creator()`, `group_attachment_objects()` e a
  política de Storage `group_attachments_delete_creator`.
- `group_conversations` e `group_conversation_members` entram na
  publicação `supabase_realtime` (a lista de grupos atualiza sozinha:
  grupo apagado some, grupo novo aparece). Confira em **Database →
  Publications**.

### Depois de rodar o 007 (parte nova: não lidos numa consulta só)

- Nova RPC `unread_overview()` (SECURITY INVOKER — a RLS de sempre vale):
  as bolinhas de não lido passam de 7 consultas + até 2.000 linhas a cada
  20 s por pessoa pra uma chamada que devolve só o que está não lido. É a
  maior economia de egress/carga do banco desta revisão (ver
  `loadtest/CAPACIDADE.md`). App antigo ou banco sem a função: continua
  funcionando pelo caminho antigo.

### Depois de rodar a parte 017 (dentro do 007)

- Os links antigos `/storage/v1/object/public/(dm-|group-)attachments/...`
  **param de funcionar** (era o objetivo: eles baixavam sem login, pra
  sempre). O app novo exibe tudo — inclusive as mensagens antigas — por
  URL assinada de ~1h (`src/lib/storageUrls.ts`). Versões antigas do app
  deixam de mostrar anexos até atualizar.
- **Limpeza de arquivos órfãos (recomendado)**: o app apaga o arquivo do
  Storage quando a mensagem é apagada, mas é best-effort (canal/servidor
  excluído em cascata, app fechado no meio, versão antiga...). Agende uma
  Edge Function (ou pg_cron + pg_net) com a `service_role` que chame
  `rpc('orphan_attachment_objects')` e depois
  `storage.from(bucket).remove(nomes)` — sempre pela API do Storage, nunca
  `delete from storage.objects` direto.
- **Auth mudou pra PKCE** (app): o login com Google volta com `?code=` em
  vez de tokens na URL. Em **Authentication → URL Configuration** as
  "Redirect URLs" continuam `https://mamaco-voip.vercel.app/**` e
  `mamacovoip://auth-callback**`.
- **E-mail de redefinir senha (recomendado)**: em **Authentication →
  Email Templates → Reset Password**, troque o link por
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` — assim
  o link não carrega tokens na URL e funciona em qualquer aparelho/
  navegador. O template padrão (`{{ .ConfirmationURL }}`) continua
  funcionando (a tela `/redefinir-senha` aceita os dois formatos).
- **Revogue a chave antiga da GIPHY** no painel de desenvolvedor da
  GIPHY: ela ficava escrita no código (`src/lib/config.ts`). Gere outra
  e configure só como `VITE_GIPHY_API_KEY` (Vercel + GitHub Actions).

### Depois de rodar a parte 016 (dentro do 007) — obrigatório no painel

- **Realtime → Settings → desligar "Allow public access"**. O app agora
  abre os tópicos `voice:<id>`, `typing:<id>` e `presence:online` como
  canais **privados** (`private: true`), e as políticas em
  `realtime.messages` decidem quem entra/envia. Enquanto o acesso
  público estiver ligado, um cliente modificado ainda consegue abrir o
  mesmo tópico como canal público e ignorar as políticas.
- Confira em **Database → Publications** que `soundboard_plays` está em
  `supabase_realtime` (o soundboard deixou de usar broadcast).
- **Deploy das Edge Functions**: `supabase functions deploy livekit-token`
  (castigo agora entra só ouvindo), `supabase functions deploy
  livekit-moderate` (nova — tira da voz quem foi expulso/banido e corta o
  microfone de quem levou castigo; usa as mesmas secrets do LiveKit) e
  `supabase functions deploy link-preview` (falha fechado sem DNS).
- **Domínio próprio / desenvolvimento local**: as URLs de avatar,
  banner, ícone, emoji e anexo agora precisam apontar pro Storage do
  projeto. Desde a PARTE 19 o host aceito é o de
  `app.settings.supabase_url` ou, sem ela, o da própria requisição
  (ver acima) — não mais qualquer `*.supabase.co`. Domínio próprio ou
  `http://127.0.0.1:54321` local:
  `alter database postgres set app.settings.supabase_url = 'https://api.seudominio.com';`
- A confirmação de idade (+18) saiu de `profiles` (a coluna
  `age_verified_adult_at` é **removida** — era legível por qualquer um)
  e foi pra `user_private_settings` (só o dono lê). Os dados existentes
  são migrados. Versões antigas do app deixam de salvar a confirmação.
- Mensagens de canal +18 só são entregues pelo banco a quem confirmou a
  idade (antes o portão era só visual).

### Depois de rodar a parte 013 (dentro do 007)

- Quem tem 2FA ativado passa a ser **obrigado** a digitar o código pra
  a API responder (antes era só a tela do app que cobrava).
- Funções RPC deixam de ser chamáveis sem login (papel `anon`), exceto
  `is_username_available` (usada no cadastro).
- Confira em **Storage → Policies** se existem políticas antigas no
  bucket `soundboard` com nomes diferentes de `soundboard_objects_*` —
  políticas se somam, então uma antiga mais permissiva continuaria
  valendo.
- Se aparecer o aviso "Existem usernames repetidos ignorando
  maiúsculas", resolva as duplicatas e rode o 007 de novo.

### Depois de rodar a parte 015 (dentro do 007)

- Em **Editar canal** (canais de texto) aparece "Canal +18 (restrição
  de idade)". Quem abre um canal marcado vê um aviso de idade antes do
  conteúdo; a confirmação fica no perfil e pode ser revogada em
  Configurações › Privacidade.
- O seletor de GIF usa `rating=r` **só** nesses canais (é o máximo que
  a API da GIPHY oferece — ela não tem pornografia explícita). Em
  canais comuns e DMs continua `pg-13`.
- Antes de rodar a parte 015 o app continua funcionando: o selo/aviso só
  aparece quando a coluna existe.

### Depois de rodar a parte 014 (dentro do 007)

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

**2. Faça o deploy das Edge Functions:**

```bash
supabase functions deploy livekit-token
supabase functions deploy livekit-moderate
```

(`livekit-moderate` — parte 016 do `007` — é chamada pelo app depois de
expulsar/banir/silenciar alguém: tira a pessoa das salas de voz do
servidor ou corta o microfone dela no LiveKit. Usa as mesmas secrets.)

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
