# Mamacos Voip

Um clone funcional do Discord, construído com React + Vite + TypeScript +
Tailwind no frontend e Supabase (Postgres + Auth + Storage + Realtime) no
backend. Todas as 9 fases do plano original foram implementadas, mais
identidade visual própria, app desktop instalável e configurações de áudio.

## Stack

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4, React Router
- **Backend**: Supabase (Postgres com Row Level Security, Auth, Storage, Realtime)
- **Voz/vídeo**: WebRTC nativo (mesh P2P), sinalizado via Supabase Realtime

## Setup rápido

```bash
npm install
cp .env.example .env   # preencha com as chaves do seu projeto Supabase
```

No **SQL Editor** do seu projeto Supabase, rode as migrations em ordem
(`supabase/migrations/001_...` até `007_...`). Veja `supabase/README.md`
para detalhes de cada uma e das configurações de Auth necessárias.

```bash
npm run dev       # desenvolvimento
npm run build     # build de produção (saída em dist/)
```

## O que foi construído, fase por fase

| Fase | O que tem |
|---|---|
| **1 — Base** | Projeto React/Vite/TS/Tailwind, cliente Supabase tipado, schema de perfis com RLS |
| **2 — Interface** | Login, cadastro, layout principal (barra de servidores, canais, chat, membros, painel de usuário) |
| **3 — Servidores** | Criar/editar/excluir servidor, convites com expiração/limite de uso, sair do servidor, ícone |
| **4 — Canais** | Canais de texto/voz, categorias, reordenação, tudo com permissão granular |
| **5 — Chat** | Mensagens em tempo real, editar, excluir, responder, reações, upload de arquivos, menções |
| **6 — Usuários** | Perfil editável, avatar, status (online/ausente/não perturbe/invisível), amigos, DMs, bloqueio |
| **7 — Administração** | Cargos com permissões granulares e hierarquia, expulsar, banir, silenciar, log de moderação |
| **8 — Voz** | WebRTC real (mesh P2P) via sinalização no Supabase Realtime: microfone, câmera, compartilhamento de tela, detecção de fala |
| **9 — Finalização** | Notificações do navegador, busca de mensagens, configurações, responsividade, PWA, otimização de bundle |

## Estrutura do projeto

```
src/
  components/
    chat/          # mensagens (canal e DM), composer, lista
    home/          # painel de amigos
    layout/        # barra de servidores, sidebar de canais, chat, membros, voz
    modals/        # todos os modais (criar servidor, cargos, moderação, perfil...)
    ui/             # componentes de UI genéricos (Avatar, etc.)
  context/          # AuthContext
  hooks/            # toda a lógica de dados (useServers, useMessages, useVoiceChannel...)
  lib/              # cliente Supabase, notificações
  pages/            # Login, Register, MainLayout
  types/            # tipos do banco (Database) e dos modelos

supabase/
  migrations/       # 001 a 007, na ordem que devem ser executadas
  README.md         # como aplicar as migrations e configurar o Auth
```

## Limitações conhecidas (documentadas, não escondidas)

- **TURN não configurado**: só STUN público está disponível neste ambiente.
  Chamadas de voz atrás de NAT restritivo podem falhar em produção sem um
  servidor TURN real (coturn ou serviço pago).
- **Voz é mesh P2P**, não SFU — funciona bem até ~8 pessoas por canal.
- **Notificações** só disparam para conversas com uma aba/subscription já
  aberta (não é push de verdade — exigiria Web Push + Service Worker com
  VAPID keys).
- **Buckets de storage são públicos** (ícones, avatares, anexos) — RLS
  protege *quem descobre* o link pela aplicação, mas um link vazado
  funciona sem autenticação, igual ao CDN de anexos do Discord.

Veja `SECURITY_CHECKLIST.md` para o mapeamento completo de cada item do
plano de segurança original contra o que foi implementado.

## App desktop (Windows/Mac/Linux)

O projeto tem um empacotamento Electron pronto em `electron/`. Pra gerar o instalador:

```bash
npm install          # baixa electron, electron-builder e electron-updater
npm run electron:build
```

Isso gera os instaladores em `release/` — `.exe` (Windows, NSIS), `.dmg` (Mac) e `.AppImage`/`.deb` (Linux),
dependendo do sistema operacional onde você rodar o comando (o electron-builder não faz cross-compile
completo sem configuração extra — geralmente você gera o instalador de cada SO na própria máquina daquele SO,
ou usa CI como GitHub Actions com runners de cada plataforma).

**Permissões**: o app já vem configurado pra aceitar as permissões de microfone, câmera, compartilhamento
de tela e notificações automaticamente (não fica perguntando toda vez) — veja `electron/main.cjs`.

**Atualizações automáticas**: usa `electron-updater`, configurado pra checar releases no GitHub. Pra
funcionar de verdade, você precisa:
1. Trocar `SEU_USUARIO_GITHUB`/`SEU_REPOSITORIO` no bloco `"publish"` do `package.json` pelo seu repositório real
2. Publicar os instaladores gerados como um GitHub Release
3. Trocar a mesma URL em `src/lib/config.ts` (é o link do botão "Baixar o app pra PC" na tela de login)

**Testar em desenvolvimento** (sem gerar instalador):
```bash
npm run dev              # em um terminal, sobe o Vite
npm run electron:start   # em outro terminal, abre a janela do Electron apontando pro Vite
```

**Reconhecimento de jogos**: o app desktop verifica a cada 15 segundos quais processos estão rodando no
seu PC (comparando com uma lista de jogos populares em `electron/main.cjs`) e atualiza automaticamente
seu status pra "🎮 Jogando X". Isso só funciona no app desktop — nenhum navegador dá acesso à lista de
processos do sistema por segurança, então essa função não existe na versão web. A detecção funciona melhor
no Windows; no Mac/Linux a cobertura é mais limitada porque os nomes de processo variam mais.

## Deploy em produção (Vercel)

1. Suba este repositório pro GitHub
2. Importe o projeto na [Vercel](https://vercel.com/new)
3. Configure as variáveis de ambiente no dashboard da Vercel:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. O `vercel.json` já está configurado (build command, output directory,
   e rewrite de rotas pra funcionar como SPA)
5. Deploy

Depois do primeiro deploy, volte no dashboard do Supabase em
**Authentication → URL Configuration** e adicione o domínio da Vercel
como Site URL / Redirect URL — senão o fluxo de confirmação de e-mail e
reset de senha vai redirecionar pro `localhost`.
