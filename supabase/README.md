# Migrations do Mamacos Voip

## Se seu banco já está configurado (a maioria dos casos)

Você já rodou as 22 migrations originais, uma por uma, ao longo do
desenvolvimento — elas já estão aplicadas no seu banco Supabase.

**A única coisa que ainda precisa rodar é `006_content_constraint_fixes.sql`**
(corrige um bug real: mensagem só-com-anexo, tipo mensagem de voz sem
texto, estava sendo rejeitada pelo banco; e mensagens de grupo não
tinham limite de tamanho). Roda ela uma vez no SQL Editor do Supabase.

**Nunca rode os arquivos 001 a 005 num banco que já tem as migrations
originais aplicadas** — a maioria das tabelas usa `CREATE TABLE` sem
`IF NOT EXISTS`, então vai dar erro de "relação já existe". Isso é
esperado e não indica problema nenhum.

## Se você está configurando um banco NOVO do zero

Rode os arquivos de `migrations/`, em ordem (001 → 006), no SQL Editor
do Supabase.

| Arquivo | Conteúdo |
|---|---|
| `001_core.sql` | Perfis, servidores, canais, categorias |
| `002_messaging.sql` | Mensagens, anexos, reações, leitura, fixar, silenciar, modo lento |
| `003_social.sql` | Amizades, bloqueios, DM 1-pra-1, DM em grupo |
| `004_roles_moderation.sql` | Cargos, permissões, banimentos, log de moderação |
| `005_extras.sql` | Debug, emoji customizado, threads, eventos do servidor |
| `006_content_constraint_fixes.sql` | Correção de limite de tamanho de mensagem (rode por último, ou já nem precisa — os arquivos 002/003 acima já nascem corrigidos numa instalação nova) |

Cada coluna que foi adicionada aos poucos ao longo do desenvolvimento
(ex: `topic` do canal, `is_stage`, `slowmode_seconds`, etc.) já está
fundida direto na tabela onde ela pertence — não sobrou nenhum
`ALTER TABLE ADD COLUMN` solto de 1-2 linhas, exceto os pouquíssimos
casos onde isso é tecnicamente obrigatório (referência circular entre
`servers`/`channels`, e `messages.thread_id` que depende da tabela
`threads`, criada só no arquivo 005). Esses casos ficam com um
comentário explicando o motivo.

## Histórico original

A pasta `migrations_archive/` guarda os 22 arquivos originais,
exatamente como foram criados e aplicados um por um — é só pra
referência histórica de como o banco evoluiu ao longo do
desenvolvimento. Não precisa rodar nada de lá.
