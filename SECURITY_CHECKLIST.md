# Checklist de segurança — o que foi implementado e onde

Este documento mapeia cada item do plano de segurança original pro que
foi de fato implementado no código, com o arquivo responsável. Itens
marcados com ⚠️ são limitações conhecidas e documentadas, não omissões.

> **Numeração das migrations:** as antigas 007–012 viraram
> `006_ajustes_2025.sql` e as antigas 013–017 viraram as partes "PARTE 013"
> … "PARTE 017" de `007_seguranca_e_recursos_2026.sql`. Abaixo, "`013`",
> "`016`" etc. = essas partes. Referências como `004_messages.sql`,
> `006_roles_moderation.sql` são os arquivos de origem já consolidados em
> 001–005 (ver o comentário "originalmente: …" dentro deles).

## 1. Autenticação

| Item | Status | Onde |
|---|---|---|
| Login seguro | ✅ | `context/AuthContext.tsx` via Supabase Auth |
| Senhas tratadas pelo Supabase Auth | ✅ | Nunca tocamos em senha em texto puro no frontend |
| Recuperação de senha | ✅ | `SettingsModal.tsx` (trocar senha logado **exige a senha atual** — conferida num cliente descartável — ou código por e-mail via `reauthenticate`; depois derruba as outras sessões) + fluxo de "esqueci a senha" por e-mail (`ForgotPassword.tsx`/`ResetPassword.tsx`, aceita `token_hash`, `?code=` e `#access_token`) |
| Confirmação de e-mail | ✅ | Configurável no dashboard do Supabase (`supabase/README.md`) |
| Proteção contra sessões inválidas | ✅ | `onAuthStateChange` do Supabase invalida sessão expirada automaticamente |
| Logout de todas as sessões | ✅ | `SecurityTab.tsx`: "Sair de todos os outros aparelhos" (`signOut({scope:'others'})`) e "Sair de todos os aparelhos" (`scope:'global'`); redefinir senha derruba as outras sessões |
| Rate limit para tentativas de login | ✅ | Nativo do Supabase Auth (configurável no dashboard) + trava de UX no `Login.tsx` |
| Política de senha | ✅ | `lib/authValidation.ts` (mín. 8, letra + número, máx. 72 bytes) — **configure o mesmo no dashboard** (ver seção 9) |
| 2FA cobrado no banco, não só na tela | ✅ | `007_seguranca_e_recursos_2026.sql` (parte 013): `mfa_requirement_met()` + política restritiva em todas as tabelas |
| Open redirect pós-login | ✅ | `safeRedirectPath()` em `lib/authValidation.ts` |
| OAuth sem tokens na URL | ✅ | `017`/B3: `flowType: 'pkce'` em `lib/supabase.ts`; no desktop o deep link `mamacovoip://auth-callback?state=…&code=…` confere o `state` e chama `exchangeCodeForSession` (`AuthContext.tsx`) — o code não vale nada sem o verifier guardado no app |
| Sessão cifrada no app desktop | ✅ | B7: `lib/authStorage.ts` + `secure-storage:*` em `electron/main.cjs` (safeStorage: DPAPI/Keychain/libsecret); migra a sessão antiga do localStorage sem deslogar. ⚠️ Linux sem chaveiro cai no localStorage |
| Limpeza de dados locais no logout | ✅ | `AuthContext.tsx`: fecha canais Realtime, limpa cache de preview, notas/fixados locais, dispara `mamacos:signed-out` |

## 2. Banco de dados

| Item | Status | Onde |
|---|---|---|
| RLS em todas as tabelas | ✅ | Toda tabela criada tem `enable row level security` na migration correspondente |
| Usuário só acessa seus próprios dados quando aplicável | ✅ | `profiles`, `blocked_users`, `channel_read_state`, etc. |
| Usuário só acessa servidores dos quais participa | ✅ | `is_server_member()` usado em toda policy de leitura |
| Verificar permissões no PostgreSQL | ✅ | Toda regra de negócio sensível vive em funções `security definer`, não no frontend |
| Nunca confiar apenas nas permissões do frontend | ✅ | RLS é a fonte de verdade; o frontend só reflete o que o banco permite |
| Criar políticas específicas para cada operação | ✅ | Policies separadas por `select`/`insert`/`update`/`delete` em todas as tabelas |
| Backups do banco | ⚠️ | Recurso nativo do Supabase (Point-in-Time Recovery no plano pago) — não é configuração de código |

## 3. Servidores e permissões

| Item | Status | Onde |
|---|---|---|
| Hierarquia de cargos | ✅ | `top_role_position()` em `006_roles_moderation.sql` |
| Permissões por cargo | ✅ | `roles.permissions text[]` + `has_permission()` |
| Permissões por canal | ✅ | Canal restrito por cargo (`channel_role_access`, `004`/`011`) |
| Proteção contra alteração de permissões | ✅ | `013`: criar/editar/excluir/atribuir/remover cargo só abaixo do próprio nível, e só concedendo permissões que você tem |
| Dono do servidor protegido | ✅ | Dono nunca pode ser kickado/banido/silenciado (`kick_member`, `ban_member`, `timeout_member`) nem perde acesso de edição do servidor |
| Sistema de banimento | ✅ | `bans` + `ban_member()`/`unban_member()`, bloqueia reingresso via convite |
| Sistema de expulsão | ✅ | `kick_member()` |
| Sistema de timeout/silenciamento | ✅ | `server_members.timeout_until` + policy de insert em `messages` que bloqueia quem está em timeout |

## 4. Mensagens

| Item | Status | Onde |
|---|---|---|
| Controle de quem pode enviar mensagens | ✅ | RLS: só membros, e não quem está em timeout |
| Controle de quem pode excluir mensagens | ✅ | Autor ou quem tem `manage_messages` |
| Controle de quem pode editar mensagens | ✅ | Só o autor; `013` impede mover mensagem de canal/conversa, forjar data e moderador reescrever texto alheio |
| Proteção contra spam | ✅ | Trigger `check_message_rate_limit` |
| Rate limit de mensagens | ✅ | Máx. 8 mensagens / 10s por usuário (`004_messages.sql`, `005_friends_dms.sql`) |
| Limite de tamanho das mensagens | ✅ | `check (char_length(content) between 1 and 4000)` |
| Sistema de denúncias | ✅ | `006_ajustes_2025.sql` (antiga 012) + limites em `007` (parte 013) |
| Registro de ações administrativas | ✅ | `moderation_logs` + `ModerationLogModal.tsx` |

## 5. Uploads

| Item | Status | Onde |
|---|---|---|
| Limitar tamanho dos arquivos | ✅ | `file_size_limit` nos buckets (`server-icons`, `avatars`: 5MB; `attachments`: 25MB) |
| Validar MIME type | ✅ | `allowed_mime_types` (whitelist) em todos os buckets |
| Bloquear extensões perigosas | ✅ | Consequência da whitelist de MIME types — executáveis nunca são aceitos |
| Gerar nomes de arquivos seguros | ✅ | Paths gerados com UUID/timestamp, nunca o nome bruto do usuário sem sanitização |
| Restringir acesso ao Storage | ✅ | `017`: anexos (`attachments`, `dm-attachments`, `group-attachments`) em buckets **privados**, lidos só por URL assinada de ~1h (`lib/storageUrls.ts`, `hooks/useAttachmentUrl.ts`) pra quem é da conversa/grupo/canal. ⚠️ Ícones, avatares, banners, emojis e soundboard continuam públicos (conteúdo de perfil/servidor, não de conversa) |
| Não executar arquivos enviados pelo usuário | ✅ | Nada no backend executa arquivos — Storage é só armazenamento estático |
| Limitar quantidade de uploads | ⚠️ | Não há limite explícito de "N uploads por hora" — mitigado indiretamente pelo rate limit de mensagens |
| Criar política de retenção | ⚠️ | O app apaga o arquivo ao apagar a mensagem (best-effort); `orphan_attachment_objects()` (`017`) lista os órfãos, mas a limpeza agendada (Edge Function/cron) ainda precisa ser criada no painel |

## 6. Convites

| Item | Status | Onde |
|---|---|---|
| Códigos aleatórios | ✅ | `create_server_invite()` gera código de 8 caracteres via `md5(random())` |
| Expiração | ✅ | `expires_at` opcional |
| Limite de utilizações | ✅ | `max_uses` + contador `uses` |
| Possibilidade de revogar convite | ✅ | Policy de delete em `server_invites` |
| Proteção contra criação massiva de convites | ⚠️ | Criação só é possível por membros (`is_server_member`), mas não há rate limit numérico explícito de "N convites por hora" |

## 7. Proteção contra abuso

| Item | Status | Onde |
|---|---|---|
| Rate limiting | ✅ | Mensagens de canal e DM (seção 4) |
| Anti-spam | ✅ | Mesmo mecanismo |
| Anti-flood | ✅ | Mesmo mecanismo |
| Proteção contra criação massiva de contas | ⚠️ | Depende do rate limit nativo do Supabase Auth (dashboard) — nenhuma lógica extra no código |
| Proteção contra bots abusivos | ⚠️ | Não há CAPTCHA nem detecção de bot — fora do escopo deste clone |
| Bloqueio de IP/comportamento | ⚠️ | Não implementado — exigiria infraestrutura de borda (ex: Cloudflare) |
| Sistema de denúncias | ⚠️ | Mesmo item da seção 4 — não implementado |

## 8. WebRTC / Voz

| Item | Status | Onde |
|---|---|---|
| Não expor credenciais privadas | ✅ | Só STUN público é usado; nenhuma credencial de TURN existe no código |
| Proteger signaling | ✅ | `016`: Realtime Authorization — `voice:`/`typing:`/`presence:online` são canais privados (`lib/realtimeChannel.ts`, `useVoicePresence.ts`, `VoiceContext.tsx`) com políticas em `realtime.messages` (`realtime_topic_allowed()`, exige 2FA). **Requer desligar "Allow public access" em Realtime → Settings.** ⚠️ Residual: o payload/key de presence e o `userId` do "digitando" ainda vêm do cliente (só quem tem acesso ao tópico pode forjar) |
| Soundboard sem forjar | ✅ | `016`: RPC `play_soundboard_sound` (acesso ao canal, castigo, som do mesmo servidor, anti-spam) + `soundboard_plays` via postgres_changes; nada de URL vinda de outro cliente |
| Voz após ban/kick/castigo | ✅ | `livekit-token` nega publicação a quem está em castigo; Edge Function `livekit-moderate` remove/silencia no LiveKit após a moderação (`useModeration.ts`, best-effort) |
| Validar participação na sala | ✅ | `livekit-token` confere acesso à sala (RLS) e o tópico Realtime `voice:<id>` também (`can_access_voice_room()`, `016`) |
| STUN/TURN configurados corretamente | ⚠️ | STUN público configurado; **TURN não está disponível neste ambiente** (exige servidor coturn ou serviço pago em produção) |
| Impedir acesso a canais privados | ✅ | Canal de voz segue a mesma RLS de `channels` — só membros do servidor o veem |
| Limitar criação de conexões | ✅ | `MAX_PARTICIPANTS = 8` em `useVoiceChannel.ts` (mesh P2P não escala além disso) |
| Monitorar abuso | ⚠️ | Não implementado — não há logging de uso de voz/tempo de chamada |

## 9. Frontend

| Item | Status | Onde |
|---|---|---|
| Nunca colocar service_role key no frontend | ✅ | Só a chave `anon` é usada (`lib/supabase.ts`); toda lógica sensível vive em funções `security definer` no banco, não em código com privilégios elevados no cliente |
| Usar somente chaves públicas apropriadas | ✅ | Mesma resposta acima |
| Validar dados recebidos do usuário | ✅ | Validação client-side (ex: `EditProfileModal`, `Register`) + constraints no banco (`check` nas colunas) como última linha de defesa |
| Evitar XSS | ✅ | React escapa strings por padrão; nenhum `dangerouslySetInnerHTML` é usado em nenhum componente |
| Sanitizar conteúdo quando necessário | ✅ | Mesma resposta acima |
| Não armazenar dados sensíveis no localStorage | ✅ | Desktop: sessão cifrada com safeStorage (B7). ⚠️ Web: a sessão do Supabase fica no `localStorage` (padrão do SDK) — protegida pela CSP contra XSS |
| CSP no app desktop | ✅ | B4: cabeçalho `Content-Security-Policy` nas páginas do `app://` (`APP_CONTENT_SECURITY_POLICY` em `electron/main.cjs`, igual ao `vercel.json` sem `frame-ancestors`) |
| Segredos fora do bundle | ✅ | B2: chave da GIPHY só por `VITE_GIPHY_API_KEY` (sem valor de reserva no código). **Revogar a chave antiga no painel da GIPHY** |
| Não expor informações internas nos erros | ✅ | Erros do Supabase são traduzidos e resumidos (`AuthContext.tsx`) antes de chegar na UI |

## 10. API / Edge Functions

A maior parte da lógica de backend vive em funções PostgreSQL (`security
definer`) chamadas via RPC, que herdam a identidade do usuário autenticado
automaticamente (`auth.uid()`). Duas coisas, porém, PRECISAM rodar fora do
banco (segredos que nunca podem chegar no cliente) e viraram Edge
Functions (`supabase/functions/`): `livekit-token` (emite o token de
acesso à chamada de voz, mantendo a API key/secret do LiveKit só no
servidor) e `link-preview` (busca metadados de links compartilhados no
chat sem expor a máquina do usuário que enviou o link).

| Item | Status | Onde |
|---|---|---|
| Validar autenticação | ✅ | RPC: `auth.uid()`. Edge Functions: `supabase.auth.getUser()` a partir do JWT do header `Authorization` — nunca confia em nada vindo do corpo da requisição |
| Validar autorização | ✅ | RPC: `has_permission()` / checagens de dono. `livekit-token`: confirma que o usuário é membro do servidor/participante do grupo/DM daquela sala (reaproveitando a mesma RLS das tabelas, ver o comentário na função) antes de emitir o token — corrigido na TRIGÉSIMA NONA RODADA após auditoria encontrar essa checagem faltando |
| Validar parâmetros | ✅ | Constraints de banco (`check`) + validação de existência; `livekit-token` valida tamanho/tipo do nome da sala |
| Rate limiting | ✅ | Nível de mensagens (seção 4); não há rate limit genérico de chamadas RPC nem das Edge Functions |
| Logs | ✅ | `moderation_logs` para ações administrativas |
| Tratamento seguro de erros | ✅ | `raise exception`/respostas JSON com mensagens em português, sem vazar detalhes internos (chave de API do LiveKit nunca aparece em nenhuma resposta) |
| Nunca retornar informações internas do servidor | ✅ | Mesma resposta acima |

---

**Resumo**: dos ~70 itens do plano de segurança original, a esmagadora
maioria foi implementada de verdade (não só documentada). Os itens ⚠️
são lacunas conscientes — coisas que dependem de infraestrutura externa
(TURN, CDN privado, proteção de borda) ou são funcionalidades adicionais
de produto (denúncias, política de retenção) que ficam como próximos
passos claros, não como buracos de segurança escondidos.

## 9. Auditoria 013 — o que o dono do projeto precisa fazer no painel

Coisas que não dá pra resolver só com código/migration:

1. **Rodar `supabase/migrations/007_seguranca_e_recursos_2026.sql`** no SQL Editor (contém a antiga 013; idempotente).
2. **Authentication → Providers → Email**: "Minimum password length" = 8 e
   "Password requirements" = letras e dígitos (igual `authValidation.ts`).
   Ligar **"Secure password change"** (troca de senha exige reautenticação).
3. **Authentication → Settings**: ligar **"Leaked password protection"**.
4. **Authentication → URL Configuration**: "Redirect URLs" só com
   `https://mamaco-voip.vercel.app/**` e `mamacovoip://auth-callback**`
   (nada de curinga amplo tipo `**`).
5. **Authentication → Rate Limits**: revisar limites de login/cadastro/OTP.
6. **Edge Functions**: redeploy da `link-preview` (agora exige usuário
   logado e bloqueia SSRF). `supabase functions deploy link-preview`.
7. **Storage → Policies**: conferir se o bucket `soundboard` não tem
   políticas antigas mais permissivas que as `soundboard_objects_*`.
8. ~~Buckets de anexos públicos~~ — resolvido na parte 017 do `007` (buckets privados
   + URL assinada).
9. **CSP (`vercel.json`)**: se o LiveKit for auto-hospedado (não
   `*.livekit.cloud`), acrescente o domínio dele em `connect-src`.


## 10. Revisão de segurança 016 — resumo

| Item | Status | Onde |
|---|---|---|
| Realtime broadcast/presence com autorização (A2) | ✅ | `016` + canais `private: true`; **desligar "Allow public access"** no painel |
| Canal restrito/+18 em anexos, reações e threads (A3/B5) | ✅ | `can_read_channel_content()` em todas as políticas de leitura |
| 2FA em todas as RPCs `security definer` que escrevem/retornam dados (M1) | ✅ | `016` item 7; política restritiva também em `storage.objects`. ⚠️ Helpers de RLS (`has_permission`, `is_server_member`, etc.) só devolvem booleanos e continuam sem a checagem |
| Voz após ban/kick/timeout (M2) | ✅ | `livekit-token` + `livekit-moderate` |
| Edição após ban/castigo/bloqueio (M3) | ✅ | Políticas de UPDATE de `messages`/`dm_messages` e INSERT de `message_attachments` |
| Confirmação de idade privada (M6) | ✅ | `user_private_settings` (RLS só do dono); coluna removida de `profiles` |
| Imagens rastreadoras (B1) | ✅ | `is_trusted_storage_url()`: host `*.supabase.co` (ou `app.settings.supabase_url`) + bucket/pasta certos em avatar, banner, decoração, ícone/banner de servidor, emoji e anexos. (Desde a PARTE 19: só o host do próprio projeto — ver seção 13) |
| link-preview falha fechado sem DNS (B6) | ✅ | `functions/link-preview` |
| `reorder_channels` com categoria de outro servidor (B9) | ✅ | `016` |
| Denúncia de mensagem de canal restrito (B10) | ✅ | `limit_reports()` usa `can_view_channel()` |

## 11. Revisão de segurança 017 — anexos privados, PKCE, desktop

| Item | Status | Onde |
|---|---|---|
| Anexos em buckets públicos (A1) | ✅ | `007_seguranca_e_recursos_2026.sql`, parte 017 (buckets privados, SELECT por participante/membro/acesso ao canal, 2FA) + `lib/storageRef.ts`/`lib/storageUrls.ts`/`hooks/useAttachmentUrl.ts`/`chat/SignedAttachment.tsx` (URL assinada ~1h, cache em memória, renovação antes de expirar, compatível com `file_url` antigo = URL pública). Arquivo apagado do Storage ao apagar a mensagem (`useMessages`/`useDirectMessages`/`useGroupMessages`, best-effort). ⚠️ Limpeza agendada de órfãos: criar no painel (`orphan_attachment_objects()`) |
| Troca de senha sem reautenticação (M4) | ✅ | `SettingsModal.tsx` → `AccountTab` |
| Chave GIPHY no código (B2) | ✅ | `lib/config.ts`; **revogar a chave antiga** |
| OAuth implícito no desktop (B3) | ✅ | `lib/supabase.ts` (`pkce`), `AuthContext.tsx` (deep link com `code`), `ForgotPassword.tsx`/`ResetPassword.tsx` |
| Electron sem CSP (B4) | ✅ | `electron/main.cjs` (`protocol.handle('app')`) |
| Tokens em texto puro no desktop (B7) | ✅ | `lib/authStorage.ts`, `electron/main.cjs`, `electron/preload.cjs` |
| DevTools como atalho global | ✅ | Removido o `globalShortcut` de Ctrl+Shift+I; continua via `before-input-event` com a janela focada |

## 12. Apagar grupo (parte nova do `007`)

| Item | Status | Onde |
|---|---|---|
| Só quem criou apaga o grupo | ✅ | Política `group_conversations_delete` (`created_by = auth.uid()`) + 2FA restritivo; a UI só mostra "Apagar grupo" pro criador (`GroupChatArea.tsx`, menu do botão direito em `HomeSidebar.tsx`) |
| Mensagens/anexos/membros apagados junto | ✅ | `on delete cascade` em `group_conversation_members`, `group_messages`, `group_message_attachments` |
| Arquivos do Storage apagados | ✅ | `group_attachment_objects()` (só o criador lista) + política `group_attachments_delete_creator`; o app apaga pela API do Storage antes de apagar o grupo. ⚠️ Best-effort — o que sobrar sai na limpeza de órfãos (`orphan_attachment_objects()`) |
| Lista atualiza em tempo real | ✅ | `group_conversations`/`group_conversation_members` na publicação `supabase_realtime`; DELETE chega sem RLS (só o id) e o app ignora ids que não conhece |

## 13. Revisão final (PARTE 19 do `007`)

| Item | Status | Onde |
|---|---|---|
| Todos os canais Realtime privados | ✅ | `lib/realtimeChannel.ts`: `changesChannel(nome)` abre `pgc:<nome>:<aleatório>` com `private: true` e espera `ensureRealtimeAuth()`; `realtime_topic_allowed()` libera `pgc:*` só pra LEITURA (join) a logado com 2FA em dia, nunca envio. Dados de postgres_changes seguem a RLS das tabelas. **Desligar "Allow public access".** ⚠️ `hooks/useConversations.ts` ainda usa `supabase.channel(uniqueTopic(...))` sem `private` — trocar por `changesChannel(...)` |
| Imagem/anexo rastreador em outro projeto Supabase | ✅ | `is_trusted_storage_url()`: host = `app.settings.supabase_url` → senão `x-forwarded-host`/`host` de `request.headers` → senão recusa URL absoluta. Cliente: `lib/storageRef.ts` marca URL de outro host como `unavailable` e `chat/SignedAttachment.tsx` mostra "Anexo indisponível" sem buscar o arquivo |
| `livekit-moderate` sem 2FA | ✅ | Usa `my_permissions` (recusa sessão aal1 de conta com 2FA); erro interno só no log (também em `livekit-token`) |
| Criador que saiu do grupo continuava com acesso | ✅ | `group_conversations_select` só membro; gatilho `on_group_conversation_created_add_creator`; `is_group_creator()` exige ser membro; `livekit-token` confere `is_group_member`; `createGroup` gera o id no cliente e não lê de volta |
| Moderador tirava o próprio castigo | ✅ | `remove_timeout()` sem exceção; `unban_member()` respeita o cargo de quem baniu |
| Listagem de buckets públicos | ✅ | Removidas as políticas SELECT amplas de `avatars`/`profile-banners`/`avatar-decorations`/`server-icons`; ficam SELECT só da própria pasta (perfil) e das pastas dos seus servidores (dono) — necessárias pra `remove()`/upsert |
| Soundboard como hospedagem de arquivo | ✅ | Upload só no `storage_path` de uma linha própria (`soundboard_upload_allowed()`); limite 60/servidor e 10/pessoa (`limit_soundboard_sounds()`); tamanho/tipo pelo bucket |
| Aceite de termos e maioridade | ✅ | `accept_terms(p_version, p_is_adult)` + colunas em `user_private_settings` (hora do servidor) |
| Denúncias para a plataforma | ✅ | `app_admins` (insert só pelo SQL Editor), `is_app_admin()`, `reports.target_type` `dm_message`/`group_message`, `escalated`, `scope`, `content_snapshot`, `admin_report_context()`, `admin_remove_reported_message()` |
| Electron fuses | ✅ | `package.json` → `build.electronFuses` (runAsNode off, cookies cifrados, sem `NODE_OPTIONS`/`--inspect`, integridade do asar, só carrega do `app.asar`) |
| ⚠️ Residual aceito | — | DELETE em `server_members`/`group_conversation_members` chega pelo Realtime sem RLS: quem assina a tabela recebe o par de UUIDs (servidor/grupo + usuário) de quem saiu. Mudar a PK afetaria o app inteiro |
