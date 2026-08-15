# Setup do banco de dados

## Como aplicar as migrations

No dashboard do Supabase, vá em **SQL Editor** e rode cada arquivo de
`migrations/` **na ordem numérica**, um de cada vez:

1. `001_profiles.sql` — perfis de usuário, sincronizados com `auth.users`
2. `002_servers.sql` — servidores, membros, convites, ícones
3. `003_channels.sql` — canais, categorias, reordenação
4. `004_messages.sql` — mensagens, anexos, reações, rate limit
5. `005_friends_dms.sql` — amizades, bloqueio, mensagens diretas, avatares
6. `006_roles_moderation.sql` — cargos, permissões, kick/ban/timeout, log de moderação
7. `007_read_state.sql` — estado de leitura (badges de não lido)

Cada arquivo depende dos anteriores (referências de chave estrangeira,
funções reutilizadas como `is_server_member()` e `has_permission()`), então
a ordem importa.

## Configurações de Auth (dashboard, não SQL)

Em **Authentication > Settings**:
- ☐ Habilitar **Confirm email** (confirmação de e-mail no cadastro)
- ☐ Configurar o template de **Reset Password**
- ☐ Em **Rate Limits**, revisar o limite de tentativas de login (proteção contra brute-force)
- ☐ Em **URL Configuration**, definir o Site URL (`localhost:5173` em dev, domínio de produção depois do deploy)

## Realtime

As migrations 004 e 005 já adicionam `messages`, `message_reactions`,
`dm_messages` e `friendships` à publicação `supabase_realtime`. Se o seu
projeto Supabase tiver Realtime desabilitado por padrão em alguma dessas
tabelas (verificável em **Database > Replication**), confirme que elas
aparecem como habilitadas.

## Storage

Três buckets são criados automaticamente pelas migrations:
- `server-icons` (público, 5MB, migration 002)
- `attachments` (público, 25MB, migration 004)
- `avatars` (público, 5MB, migration 005)

Todos têm `allowed_mime_types` restrito a imagens/vídeos/documentos comuns
— nada executável é aceito.

## O que cada função `security definer` faz

Várias regras de negócio (convites, amizades, moderação, cargos) vivem em
funções PostgreSQL com `security definer`, chamadas via `supabase.rpc(...)`
no frontend, em vez de `insert`/`update`/`delete` diretos. Isso existe
porque essas operações têm validações que RLS sozinha não expressa bem
(ex: "só aceita o pedido de amizade se você for o destinatário", "não deixa
banir alguém com cargo igual ou superior ao seu"). Veja o comentário no
topo de cada função no SQL pra entender a regra.

## Segurança

Veja `../SECURITY_CHECKLIST.md` na raiz do projeto para o mapeamento
completo de cada item do plano de segurança original contra o que foi
implementado em cada migration.
