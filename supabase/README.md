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
