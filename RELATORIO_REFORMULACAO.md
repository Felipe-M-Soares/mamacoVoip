# Reformulação e auditoria — Mamacos Voip

Auditoria completa (segurança, voz/transmissão, download/atualização, dados/desempenho) seguida de uma
reformulação visual ("Mamacos Neo"). Estado final: `tsc` sem erros, 92 testes passando (eram 89 antes; 7 arquivos
de teste novos), build web e build Electron funcionando.

## ⚠️ O que você precisa fazer antes de publicar

1. **Banco:** rodar `supabase/migrations/013_audit_fixes.sql` no SQL Editor (não mexe nas 001–012). Se aparecer
   aviso de usernames repetidos (diferença só de maiúscula), resolva as duplicatas e rode de novo.
2. **Edge Functions:** `supabase functions deploy livekit-token` e `supabase functions deploy link-preview`.
3. **Supabase → Authentication:**
   - Senha mínima 8, exigir letras e dígitos, ligar "Secure password change" e "Leaked password protection".
   - Redirect URLs: só `https://mamaco-voip.vercel.app/**` e `mamacovoip://auth-callback**`.
4. **Storage:** conferir se o bucket `soundboard` não tem políticas antigas mais permissivas que as novas `soundboard_objects_*`.
5. **CSP (`vercel.json`):** se seu LiveKit não for `*.livekit.cloud`, acrescente o domínio em `connect-src`.
6. **Commite o novo `package-lock.json`.** Ele agora é completo (binários de Windows/Mac/Linux) e o workflow de release usa `npm ci`. O jeito antigo (apagar o lock e rodar `npm install`) passou a quebrar no CI com `Cannot read properties of null (reading 'edgesOut')`, um bug do npm ao resolver as versões mais novas do registro — acontecia também com o projeto original.
7. `npm install` (entraram as fontes auto-hospedadas `@fontsource-variable/inter` e `sora`).
8. **Teste manual** antes de soltar: entrar/sair de canal de voz, compartilhar tela, rolar mensagens antigas,
   presença online e "digitando…". São os pontos de maior risco sem teste automatizado.

**Mudança de comportamento:** quem tem 2FA ativo agora precisa digitar o código antes de o banco responder qualquer
coisa (antes o 2FA era só uma tela e dava pra pular usando a API direto).

## Problemas graves corrigidos (resumo)

### Conta e segurança
- Qualquer usuário logado conseguia **se colocar em qualquer grupo de DM** e ler o histórico.
- Autor podia **mover a própria mensagem** para canal de outro servidor ou para a DM de outras pessoas.
- **Flood ilimitado**: `created_at` vinha do cliente, então o anti-flood e o modo lento nunca contavam.
- Moderador com `manage_messages` podia **reescrever mensagens dos outros**.
- **Escalada de privilégio** com `manage_roles` (dar `administrator` ao próprio cargo, mexer em cargos acima).
- **2FA só na interface**: agora exigido pelo banco (RLS).
- Qualquer sessão logada abria `/redefinir-senha` e **trocava a senha sem saber a atual**.
- `link-preview` permitia **SSRF** (acessar a rede interna do servidor): agora exige login, bloqueia IPs internos,
  valida redirecionamentos, limita tamanho/tempo e tem limite de uso.
- Token do LiveKit: limite de usuários vinha do cliente (dava pra furar), canal Palco não era aplicado no servidor,
  canal de texto gerava token de voz, permissões além do necessário.
- XSS: links `javascript:` em anexos, emojis, prévias e perfil; cores de cargo não validadas.
- Senha mínima subiu de 6 para 8 (com letra e número), confirmação de senha, indicador de força, checagem de
  username disponível, proteção contra redirecionamento para outro site após login.
- Logout agora limpa tudo (tempo real, caches, rascunhos, preferências locais) e há "sair de todos os aparelhos".
- Android: `allowBackup` copiava o token de sessão para o backup do Google — desligado.

### Voz e transmissão
- **Vídeo remoto podia nunca aparecer / congelar** (`adaptiveStream` sem elementos registrados).
- Clique duplo em entrar abria **duas salas e dois microfones**; sair durante o "Conectando…" não cancelava;
  falhas no meio da entrada deixavam o **microfone aberto para sempre**.
- **Participantes fantasmas** na call seguinte e eventos da sala antiga derrubando a nova.
- Sair compartilhando tela deixava rodando captura nativa, áudio do sistema e AudioContext.
- **Push-to-talk deixava o microfone aberto** após trocar dispositivo; PTT preso depois de alt-tab.
- DM/grupo: minimizar a chamada cortava o áudio de todos; ensurdecer e volume por pessoa não funcionavam.
- Microfone desplugado agora troca sozinho para o padrão; mensagens de erro em pt-BR por tipo.
- Soundboard aceitava URL arbitrária de qualquer participante — agora só do bucket do app, máx. 6 sons simultâneos.
- Banda: voz de ~256 kbps (128 + redundância) para 64 kbps (transparente para voz em Opus); áudio de tela sem
  redundância dobrada. Câmera em 720p/30 com simulcast. Nitidez de texto na tela a 15 fps.
- Áudio por aplicativo acumulava atraso sem limite (segundos depois de um tempo) — agora teto de 0,3 s.
- Novo estado "reconectando" visível na tela.

### App desktop, download e atualização
- Protocolo `app://` aceitava **path traversal** (`..%2f`); IPC aceitava qualquer remetente; microfone/câmera/tela
  eram concedidos a qualquer origem (inclusive iframes).
- Os `.exe` nativos de captura **continuavam rodando para sempre** se o app fechasse/travasse (codificando JPEG a 24 fps
  para ninguém). Agora morrem junto com o app. Vários processos PowerShell órfãos também corrigidos.
- Leitura fora da memória na captura WGC após mudança de resolução.
- Log crescia sem limite e travava a thread principal — agora assíncrono com rotação em 5 MB.
- **Atualização:** release nascia publicado e vazio (causa dos 404 do `latest.yml`) — agora rascunho, publicado só com
  os arquivos prontos; retentativa em 1/2/5/10 min; sem "Verificando…" piscando a cada 30 min; botão "Reiniciar" não
  some mais; progresso sem inundar o app de mensagens.
- **Detecção de jogo:** Fortnite e Valorant nunca eram detectados (nome cortado em 25 caracteres) e `trust.exe` batia
  com `rust.exe`.
- Renderer travado recarrega sozinho; o app não segura mais o desligamento do Windows.

### Dados, chat e desempenho
- **Mensagens recentes não apareciam** em canais/DMs com mais de 100 mensagens (buscava as 100 mais ANTIGAS).
  Agora carrega as 50 mais recentes com rolagem infinita para cima.
- Troca rápida de canal **misturava mensagens** de canais diferentes; anexos e "respondendo a…" iam para o canal errado.
- Exclusões feitas por outras pessoas nunca chegavam em tempo real.
- Presença caía a cada renovação de token (~1 h) e a pessoa aparecia offline.
- Microfone da gravação de áudio no chat ficava ligado; Enter duplo mandava mensagem em dobro.
- Consultas N+1 e assinaturas duplicadas (até 7 por servidor) unificadas; amizades desfeitas faziam **todos os clientes
  online** recarregarem.
- Contextos memoizados (antes qualquer mudança re-renderizava o app inteiro), `React.memo` nas mensagens.
- **Bundle inicial: 423 KB → ~46 KB** (divisão de código: telas, modais e LiveKit em pedaços separados).
- Fontes agora auto-hospedadas: funcionam offline no app desktop e abrem mais rápido.
- Bug encontrado durante a verificação visual: abrir qualquer servidor derrubava o app (`supabase.rpc` desvinculado) — corrigido.
- A gaveta lateral prendia menus e modais dentro dela (propriedade `translate`) — corrigido.

## Reformulação visual — "Mamacos Neo"

- **Design system** em `src/index.css`: superfícies em camadas com bordas finas, cantos arredondados, gradiente da
  marca (vermelho → laranja) só nos destaques, tipografia Inter + Sora, animações curtas, foco visível para teclado,
  respeito a "reduzir movimento" do sistema. Classes prontas: `btn-primary/secondary/ghost/danger`, `icon-btn`,
  `surface-elevated`, `glass`, `chip`, `badge-count`, `field-label`, etc.
- **4 temas**: Vermelho (padrão), Clássico, Roxo Meia-noite e o novo **Oceano**.
- **Campos de texto** que eram invisíveis (mesma cor do fundo) agora têm borda e anel de foco.
- **Avatares e servidores** sem imagem ganharam cores de identidade distintas (antes todos vermelhos).
- **Telas de entrada** em duas colunas com painel da marca, mostrar/ocultar senha, força da senha.
- **Chat**: mensagens com hover e barra de ações flutuante, menção destacada, reações em pílula, composer moderno,
  "digitando…" animado, botão "Novas mensagens ↓", estados vazios e skeletons.
- **Voz**: grade de cartões 16:9 com anel de fala, barra de controles flutuante em vidro, botão dedicado de ensurdecer,
  banner de reconexão, seu próprio cartão agora acende quando você fala.
- **Configurações**: menu agrupado com ícones, cartões, interruptores, prévia visual de cada tema, zona de perigo.
- **Busca e troca rápida (Ctrl+K)** em estilo paleta de comandos.
- **Usabilidade**: `alert/confirm` nativos trocados por confirmação na própria tela (excluir mensagem, bloquear,
  sair de grupo, remover amigo, etc.), menus navegáveis por teclado, modais com foco preso e Esc, `aria-label` em
  botões só de ícone.

## Encontrado e não alterado (decisões para você)

- Anexos de DM/grupo ficam em buckets **públicos**: quem tiver o link baixa sem login. Resolver exige bucket privado
  com links assinados.
- Primeira atualização diferencial cai para download completo por causa do nome fixo `MamacosVoip-Setup.exe`
  (usado no link de download do site).
- Atalho global Ctrl+Shift+I (DevTools) sequestra o atalho de outros apps — sugerido trocar.
- `VoiceContext` ainda re-renderiza quem usa `useVoice()` a cada mudança de "quem está falando"; separar exige
  refatorar vários componentes.
- Canais criados por outra pessoa só aparecem ao recarregar (tabelas fora da publicação Realtime).
- Links dentro do texto das mensagens não viram links clicáveis (comportamento atual preservado).

## Rodada 2 (pedidos de 29/09)

- **Crash ao compartilhar tela inteira / janela em tela cheia:** o quadro do monitor inteiro (4K, ultrawide) ia sem limite
  pro codificador H.264, que não aceita acima de ~4096×2304 e roda dentro do processo da página. Agora há teto de 1440p
  aplicado ANTES de publicar, troca automática pra VP8 se ainda passar do limite, e a flag experimental de captura de tela
  (WGC) foi removida. Se o processo cair mesmo assim, o app recarrega sozinho com uma notificação (sem a caixa "processo
  travou") e registra tudo em `%APPDATA%\Mamacos Voip\mamacos-debug.log`.
- **Lentidão dos botões:** modais agora são pré-carregados em segundo plano (o 1º clique esperava baixar o código),
  a voz não redesenha mais o app inteiro a cada "fulano está falando", canais/servidores já visitados abrem na hora
  (cache), menos idas ao servidor, animações mais curtas e sem desfoque de fundo pesado. Ex.: Configurações 414→222 ms,
  voltar a um canal 448→~140 ms (medido com CPU 4× mais lenta).
- **Arrastar usuários entre salas:** dono (ou cargo com "Mover membros") arrasta o participante na barra lateral para
  outro canal de voz, ou botão direito → "Mover para…". Validado no banco (migration **014**), respeita hierarquia de
  cargos e fica no log de moderação.
- **GIFs +18:** canais marcados como +18 (migration **015**) com confirmação de idade; neles o GIF usa o nível máximo do
  GIPHY (`r`). O GIPHY não oferece pornografia explícita — `r` é o limite da API. Opção em Configurações › Privacidade.
- **Instalador:** assistente em português com imagens da marca, licença, escolha de pasta, atalho na área de trabalho e
  "abrir ao terminar"; ícone `.ico` próprio. Build opcional para a **Microsoft Store** (grátis, tira o aviso do Windows) —
  ver `COMO_TIRAR_AVISO_DO_WINDOWS.md`.

Rodar no Supabase, na ordem: `014_move_members.sql` e `015_nsfw_channels.sql`.
