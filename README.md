# Mamacos Voip

Um app completo de comunicação (servidores, texto, voz e vídeo), construído com React + Vite + TypeScript +
Tailwind no frontend e Supabase (Postgres + Auth + Storage + Realtime) no
backend. Todas as 9 fases do plano original foram implementadas, mais
identidade visual própria, app desktop instalável e configurações de áudio.

## Stack

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4, React Router
- **Backend**: Supabase (Postgres com Row Level Security, Auth, Storage, Realtime)
- **Voz/vídeo**: LiveKit (SFU) — cada participante publica sua mídia uma
  única vez pro servidor, que replica pra todo mundo; token de acesso
  emitido por uma Edge Function do Supabase (ver `supabase/functions/livekit-token`)

## Setup rápido

```bash
npm install
cp .env.example .env   # preencha com as chaves do seu projeto Supabase
```

No **SQL Editor** do seu projeto Supabase, rode as migrations em ordem:
`supabase/migrations/001_...` até `007_...` (banco novo). **Já tinha rodado
as antigas 001–012 (ou até a 017)?** Rode só o
`007_seguranca_e_recursos_2026.sql` — ele é idempotente, pode rodar de novo
sem medo. Veja `supabase/README.md` para detalhes de cada uma e das
configurações de Auth necessárias.

```bash
npm run dev       # desenvolvimento
npm run build     # build de produção (saída em dist/)
```

Latência (ping) e região: `docs/PING.md`. Teste de carga e capacidade por
plano do Supabase/LiveKit: `loadtest/README.md` e `loadtest/CAPACIDADE.md`.

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
| **8 — Voz** | LiveKit (SFU real, token emitido por Edge Function): microfone, câmera, compartilhamento de tela, detecção de fala, controle de volume por participante |
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
  functions/        # Edge Functions (livekit-token, link-preview)
  README.md         # como aplicar as migrations e configurar o Auth
```

## Limitações conhecidas (documentadas, não escondidas)

- **Voz depende de um servidor LiveKit configurado** (`LIVEKIT_URL`,
  `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` nas secrets da Edge Function —
  ver `supabase/README.md`). Sem isso, entrar num canal de voz falha com
  uma mensagem explicando o que falta configurar. TURN/NAT traversal é
  responsabilidade do próprio servidor LiveKit escolhido (LiveKit Cloud já
  inclui; auto-hospedado precisa configurar TURN separadamente).
- **Notificações** só disparam para conversas com uma aba/subscription já
  aberta (não é push de verdade — exigiria Web Push + Service Worker com
  VAPID keys).
- **Storage**: anexos (canais, DMs e grupos) ficam em buckets **privados**,
  lidos só por URL assinada de curta duração. Ícones, avatares, banners,
  emojis e sons do soundboard continuam em buckets públicos (quem tem o
  link consegue abrir). Arquivos órfãos (de mensagens ou contas apagadas)
  só saem com a limpeza periódica (`orphan_attachment_objects()`), que
  ainda precisa ser agendada — ver `SECURITY_CHECKLIST.md`.

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
1. Conferir o bloco `"publish"` do `package.json` (hoje aponta pra `Felipe-M-Soares/mamacoVoip`)
2. Publicar os instaladores gerados como um GitHub Release
3. Trocar a mesma URL em `src/lib/config.ts` (é o link do botão "Baixar o app pra PC" na tela de login)

**Atualização automática ao dar deploy**: existe um workflow em `.github/workflows/release-desktop.yml`
que roda sozinho toda vez que você der `push` pra branch `main` — ele gera os instaladores de Windows,
Mac e Linux e já publica como um novo GitHub Release. Como o `electron-updater` (configurado em
`electron/main.cjs`) checa por atualizações toda vez que o app abre, isso significa que o mesmo `push` que
atualiza o site na Vercel também deixa uma atualização pronta pra quem já tem o app instalado — na próxima
vez que a pessoa abrir o Mamacos Voip, ele baixa e aplica sozinho. Só precisa:
1. Conferir o repositório no `package.json` (bloco `"publish"`)
2. Isso já é suficiente — o workflow usa o token automático do GitHub Actions, não precisa configurar nada a mais

**Testar em desenvolvimento** (sem gerar instalador):
```bash
npm run dev              # em um terminal, sobe o Vite
npm run electron:start   # em outro terminal, abre a janela do Electron apontando pro Vite
```

**Reconhecimento de jogos**: o app desktop verifica a cada 15 segundos quais processos estão rodando no
seu PC (comparando com o catálogo em `electron/gameCatalog.cjs` e com as pastas de bibliotecas das lojas de
jogos) e atualiza automaticamente seu status pra "🎮 Jogando X". Só o nome do jogo vai pro servidor; a
lista de processos fica no PC. Isso está descrito na Política de Privacidade (seção 4) — se mudar o que é
detectado ou enviado, atualize o texto também. Isso só funciona no app desktop — nenhum navegador dá acesso à lista de
processos do sistema por segurança, então essa função não existe na versão web. A detecção funciona melhor
no Windows; no Mac/Linux a cobertura é mais limitada porque os nomes de processo variam mais.

## Segurança

Um app "impossível de invadir" não existe — nem pra Mamacos Voip, nem pro apps de chat populares, nem pra nenhum
software que roda no computador de alguém. Quem tem o `.exe` instalado sempre consegue, em algum grau,
inspecionar como ele funciona. O que dá pra fazer de verdade é: (1) fechar as portas que existem no app
desktop, e (2) garantir que a decisão de "quem pode ver/editar o quê" fique no servidor, não no aplicativo —
porque isso é a única parte que ninguém com acesso ao instalador consegue burlar.

**O que já está implementado:**

- **RLS (Row Level Security) em toda tabela do banco** — essa é a proteção real. Mesmo que alguém
  desmontasse o app inteiro e recriasse toda chamada que ele faz, o Postgres ainda barra qualquer
  leitura/escrita que a pessoa não tenha permissão de fazer. É por isso que a chave pública do Supabase
  (`VITE_SUPABASE_ANON_KEY`) pode aparecer no código sem problema — ela não é secreta, é a RLS que protege.
- **Content-Security-Policy** (`index.html` + `vercel.json`) — trava de onde o app pode carregar
  script/estilo/conexão, reduzindo bastante o impacto de um ataque de XSS caso um dia apareça algum.
- **Configuração de segurança do Electron** (`electron/main.cjs`): `contextIsolation`, `nodeIntegration:
  false`, `sandbox: true`, `webSecurity: true`, sem tag `<webview>`, navegação travada só pro próprio app
  (qualquer link externo abre no navegador do sistema, não dentro da janela do app).
- **ASAR habilitado** no empacotamento — o código fonte vai compactado num arquivo único em vez de arquivos
  soltos e editáveis. Isso NÃO é criptografia (existem ferramentas públicas que desempacotam ASAR em
  segundos), só dificulta um pouco a alteração casual.
- **Rate limit de mensagens** (8 mensagens/10s por usuário), já configurado no banco desde a Fase 5.
- **Cabeçalhos de segurança** no deploy web (`vercel.json`): `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`.
- **Nenhuma senha passa pelo nosso código** — login/cadastro vai direto pro Supabase Auth via HTTPS, que
  faz o hash da senha do lado dele. O app nunca vê nem guarda senha em texto puro.

**O que ainda vale a pena fazer, mas exige algo fora do meu alcance aqui:**

- **Assinatura de código (code signing)** — um certificado (pago, ~200-400 USD/ano pra Windows) que faz o
  Windows/Mac pararem de mostrar aviso de "editor desconhecido" no instalador, e garante que ninguém
  consiga adulterar o `.exe` sem invalidar a assinatura. Sem isso, o SmartScreen do Windows vai avisar que
  o app "não é comumente baixado" — é chato, mas não significa que o app tem algum problema.
  `electron-builder` já suporta assinatura automática assim que você tiver o certificado.
  [Guia oficial](https://www.electron.build/code-signing).
- Manter as dependências atualizadas (`npm audit` de tempos em tempos).

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

## Documentos legais, licenças e marcas

- **Termos de Uso** e **Política de Privacidade**: `src/pages/legal/` (rotas `/termos` e `/privacidade`).
  Responsável: Felipe Moreira Soares — contato: mamacovoip@gmail.com (se mudar, troque nos dois arquivos e em `DeleteAccountInfo.tsx`).
  O termo mostrado pelo instalador do Windows fica em `build/license.txt`. Sempre que o app passar a
  coletar ou enviar algum dado novo (novo provedor, analytics, gravação etc.), atualize os três.
- **Exclusão de conta pela web** (exigida pela Google Play): `/privacidade#excluir-conta` explica o passo a
  passo; o ideal é ter uma rota própria (ex.: `/excluir-conta`).
- **Componentes de terceiros**: `THIRD_PARTY_NOTICES.md` lista as licenças das dependências que vão no app
  (gerado com `npx license-checker --production`). Regere ao atualizar dependências. Nenhuma dependência de
  produção é GPL/AGPL; a `libuiohook` (dentro do `uiohook-napi`) é LGPL-3.0 e o Electron traz o FFmpeg
  (LGPL-2.1) — os avisos estão no arquivo.
- **Código deste repositório**: todos os direitos reservados ao autor (o `package.json` está como
  `private`, sem licença de código aberto). Se quiser abrir o código, adicione um arquivo `LICENSE`.
- **Marcas**: nomes de jogos, lojas e anti-cheats aparecem só para identificar o jogo detectado (uso
  nominativo). Não use logotipos de terceiros nem sugira parceria ou endosso. Evite citar apps concorrentes
  por nome em textos, telas e descrições de loja.
