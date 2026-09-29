# Checklist de segurança — o que foi implementado e onde

Este documento mapeia cada item do plano de segurança original pro que
foi de fato implementado no código, com o arquivo responsável. Itens
marcados com ⚠️ são limitações conhecidas e documentadas, não omissões.

## 1. Autenticação

| Item | Status | Onde |
|---|---|---|
| Login seguro | ✅ | `context/AuthContext.tsx` via Supabase Auth |
| Senhas tratadas pelo Supabase Auth | ✅ | Nunca tocamos em senha em texto puro no frontend |
| Recuperação de senha | ✅ | `SettingsModal.tsx` (trocar senha logado) + Supabase Auth cuida do fluxo de "esqueci a senha" por e-mail |
| Confirmação de e-mail | ✅ | Configurável no dashboard do Supabase (`supabase/README.md`) |
| Proteção contra sessões inválidas | ✅ | `onAuthStateChange` do Supabase invalida sessão expirada automaticamente |
| Logout de todas as sessões | ✅ | `SecurityTab.tsx`: "Sair de todos os outros aparelhos" (`signOut({scope:'others'})`) e "Sair de todos os aparelhos" (`scope:'global'`); redefinir senha derruba as outras sessões |
| Rate limit para tentativas de login | ✅ | Nativo do Supabase Auth (configurável no dashboard) + trava de UX no `Login.tsx` |
| Política de senha | ✅ | `lib/authValidation.ts` (mín. 8, letra + número, máx. 72 bytes) — **configure o mesmo no dashboard** (ver seção 9) |
| 2FA cobrado no banco, não só na tela | ✅ | `013_audit_fixes.sql`: `mfa_requirement_met()` + política restritiva em todas as tabelas |
| Open redirect pós-login | ✅ | `safeRedirectPath()` em `lib/authValidation.ts` |
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
| Sistema de denúncias | ✅ | `012_content_reports.sql` + limites em `013` |
| Registro de ações administrativas | ✅ | `moderation_logs` + `ModerationLogModal.tsx` |

## 5. Uploads

| Item | Status | Onde |
|---|---|---|
| Limitar tamanho dos arquivos | ✅ | `file_size_limit` nos buckets (`server-icons`, `avatars`: 5MB; `attachments`: 25MB) |
| Validar MIME type | ✅ | `allowed_mime_types` (whitelist) em todos os buckets |
| Bloquear extensões perigosas | ✅ | Consequência da whitelist de MIME types — executáveis nunca são aceitos |
| Gerar nomes de arquivos seguros | ✅ | Paths gerados com UUID/timestamp, nunca o nome bruto do usuário sem sanitização |
| Restringir acesso ao Storage | ⚠️ | Ícones/avatares/anexos usam buckets **públicos** com RLS na escrita — quem tem o link direto acessa sem checar RLS (mesmo modelo do CDN de anexos do Discord). Documentado em `004_messages.sql`. Storage totalmente privado exigiria signed URLs com expiração |
| Não executar arquivos enviados pelo usuário | ✅ | Nada no backend executa arquivos — Storage é só armazenamento estático |
| Limitar quantidade de uploads | ⚠️ | Não há limite explícito de "N uploads por hora" — mitigado indiretamente pelo rate limit de mensagens |
| Criar política de retenção | ⚠️ | Não implementado — arquivos órfãos (de mensagens excluídas) não são limpos automaticamente do Storage |

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
| Proteger signaling | ⚠️ | Sinalização via Supabase Realtime Broadcast, que exige um JWT autenticado válido — mas não usamos o recurso "Realtime Authorization" (RLS em `realtime.messages`) por não ter como validar a sintaxe exata sem um projeto Supabase real. Documentado em `hooks/useVoiceChannel.ts` |
| Validar participação na sala | ⚠️ | O `channel_id` da sala de voz só é descoberto por membros (via RLS na tabela `channels`), mas a entrada na sala Realtime em si não tem uma segunda checagem server-side |
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
| Não armazenar dados sensíveis no localStorage | ✅ | Sessão fica no armazenamento gerenciado pelo próprio SDK do Supabase (que usa práticas seguras por padrão); nenhum dado sensível é colocado manualmente em `localStorage` |
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

1. **Rodar `supabase/migrations/013_audit_fixes.sql`** no SQL Editor.
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
8. **Buckets `dm-attachments` e `group-attachments` são públicos** ⚠️ —
   quem tiver o link direto de um arquivo de DM baixa sem login. O ideal
   é torná-los privados e usar `createSignedUrl` no app (mudança de
   código no chat, ainda não feita).
9. **CSP (`vercel.json`)**: se o LiveKit for auto-hospedado (não
   `*.livekit.cloud`), acrescente o domínio dele em `connect-src`.

