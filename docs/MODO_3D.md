# Modo 3D (beta)

Botão **3D** ao lado do nome do servidor (na lista de canais). Abre o
servidor como um escritório 3D por cima do app. O modo principal continua
sendo o **clássico**: o 3D é opcional e o botão "← Voltar ao clássico" (ou
Esc) fecha.

## Visual

Isométrico estilo RPG (tipo Habbo/Ragnarok): câmera fixa na diagonal que
segue você, sombra em faixas (cel shading), contorno suave e bordas lisas
(antisserrilhado). **Z/C** (ou
os botões ⟲ ⟳) giram a câmera de 90°; a roda do mouse (ou − +) dá zoom
contínuo.
O mamaco é o da ficha de personagem, com 17 skins, acessórios (coroa,
chapéu, boné, gorro, óculos, fone, mochila, asas, cachecol) e animações
quadro a quadro: andar, correr, pular, sentar, digitar, deitar, cochilar,
acenar, beber café e falar.

## Como o servidor vira escritório

| No app | No 3D |
|---|---|
| Categoria | Setor (área com mesas, tema pelo nome: TI, Comercial, Financeiro, RH, Marketing/Design, Suporte…) |
| Canal de voz | Sala de vidro. Entrar na sala = entrar na call |
| Canal de texto | Aba do chat do setor |
| Canal AFK do servidor | Sala de descanso |
| Status "Ausente" | Pessoa descansando no sofá da sala **Descanso** |
| Offline | Pessoa dormindo na sala **Offline** |
| Online / Não perturbe | Na mesa, digitando |

O tema de cada sala sai do nome do canal de voz: "Sala de Games", "Cinema",
"Copa/Café", "Estúdio de Podcast", "Sala Zen", "Biblioteca", "Auditório",
"Minigames", "RH / 1:1". Qualquer outro nome vira sala de reunião.
Criou um canal ou categoria no clássico, o prédio já ganha a sala nova.

Fixas em todo servidor: **Minigames** (fliperamas com 4 jogos), **Descanso**
e **Offline**.

Toda sala de call tem uma **TV**. Quando alguém da sua call compartilha a
tela, a TV mostra **AO VIVO — Fulano**; aperte **F** perto dela (ou clique
nela, ou no botão "● Ver na TV" lá em cima) e a tela compartilhada passa na
TV. De novo F / "Desligar TV" para de receber.

Os controles do clássico ficam no canto de baixo à direita (o mesmo painel
do app): microfone, fone, compartilhar tela, sair da call, status e
configurações. **Clique num boneco** que está em call pra abrir o cartão
dele com o **volume** (só pra você), mensagem e perfil — igual clicar na
pessoa na lista da sala.

**Clique em qualquer boneco** pra abrir o menu dele: **mensagem privada**
(a conversa abre ali mesmo, sem sair do 3D), volume e opções da call (se
estiver em call), ver perfil e acenar.

Na recepção (igual em todo servidor): **máquina de café** (F → o boneco
pega uma caneca e sai bebendo), **banheiros** (F → entra, a porta fica
"OCUPADO" uns segundos e ele sai; ninguém vê dentro) e o **telão** com o
ranking de tempo no app entre você e seus amigos (últimos 7 dias).

Salas de canal **privado** têm dois **seguranças** de terno na porta.
A sala **Minigames** tem o **Kart Mamaco 3D** (estilo kart de festa): pista
com morrinhos e curvas, 3 voltas contra 3 bots, drift com mini-turbo
(Shift), caixas de item (banana, coco, turbo), placas de turbo, minimapa,
sons, e no fim "Desafiar no chat" manda o seu tempo no chat aberto.

Descansando (status Ausente): deitado no sofá ou na rede, com cara de sono
e bocejando. Offline: dormindo na cama.

Controles: WASD/setas andam, Shift corre, Espaço pula, **E** senta/deita,
**F** usa TV / computador / fliperama / café / banheiro, Q acena, M abre o mapa. Dá pra clicar
no chão, numa cadeira, numa TV ou numa placa de sala.

## Custo (servidor Oracle e Supabase)

**Nenhum a mais.** O 3D é desenhado no aparelho de cada pessoa usando os
dados que o app já busca:

- **Oracle (voz/LiveKit):** entrar numa sala no 3D é a mesma call do
  clássico. O 3D não manda áudio, vídeo nem posição de boneco por lá.
- **Supabase:** usa a lista de canais, membros, status, quem está em cada
  sala e as mensagens — as mesmas consultas do clássico. Os extras são
  pequenos: o visual do mamaco numa coluna do perfil (`office_skin`, salvo
  1,5 s depois da última mudança) e os emotes/acenos por broadcast do
  Realtime no tópico `office:<servidor>` (no máximo 1 a cada 1,5 s por
  pessoa; nada é gravado no banco).
- **Ninguém transmite posição:** cada pessoa aparece onde o estado real
  dela manda (na sala da call, na mesa, no descanso, dormindo). Só o seu
  boneco anda livre, na sua tela.
- **TV com transmissão:** custa o mesmo que assistir no clássico — ou
  menos. "AO VIVO" não baixa nada (o app já sabe quem está compartilhando).
  O vídeo só chega depois que você aperta F, em qualidade **baixa** (a TV é
  pequena), e para ao desligar a TV, sair da sala ou fechar o 3D. Só a call
  em que você está: as TVs das outras salas não recebem nada.
- **Câmera em cima do boneco:** só de quem está na SUA call, com o vídeo
  que o app já recebe pra tela da call. Nada a mais.
- **Música ambiente e dia/noite:** gerados no aparelho (WebAudio e o
  relógio de Brasília). Nenhum arquivo, nenhum servidor.
- **Download:** o 3D só é baixado por quem clica no botão (~170 KB
  compactado). Quem nunca abre não baixa nada a mais.

## Atualização

Automática, como sempre: push na `main` → app de PC atualiza sozinho, site
(Vercel) e APK também.

**Uma vez só:** rode as **PARTES 30 a 33** do
`supabase/migrations/007_seguranca_e_recursos_2026.sql` no SQL Editor do
Supabase (ou o arquivo inteiro — ele é idempotente). A 30 liga o telão de
tempo de uso; a 31 sincroniza o visual do mamaco entre todo mundo e libera
os emotes. Sem a 31 o visual fica só no aparelho e os emotes só aparecem
pra você. A 32 liga o **ranking dos minigames entre amigos** (sem ela, o
ranking mostra "indisponível" e os jogos funcionam normal). Sem isso, todo o
resto funciona e o telão só mostra "Ranking indisponível". O telão é a
única coisa que usa o banco: 1 chamada pequena a cada 5 min com o app
aberto (Supabase, não o servidor de voz da Oracle).

## Limites desta versão

- **Só no computador.** No celular (app Android e site aberto no celular
  ou tablet) a opção "Escritório" não aparece.
- Conquistas ficam salvas no aparelho (não vão pro banco).
- Até 6 salas por categoria e até 60 bonecos na tela (os outros continuam
  contando nas placas e no mapa).
- Precisa de placa de vídeo razoável. Em PC muito fraco, use o clássico.

## O que dá pra fazer no Escritório

- **Chat completo do clássico** no painel do setor (respostas, reações,
  editar/apagar, anexos, GIF, figurinhas, menções, fixados, tópicos…).
  `Enter` abre o chat; ⤢ aumenta, – minimiza. Bolinha vermelha nas placas
  dos setores com mensagem nova; abrir o chat marca como lido.
- **Câmera** de quem está na sua call numa bolinha em cima do boneco.
- **Emotes:** teclas `1`–`9` ou o botão 😀 (`R`). Todo mundo do servidor vê.
- **Clique num boneco:** mensagem privada, acenar (a pessoa recebe o aviso
  "fulano acenou pra você"), volume/mover na call, ver perfil e moderar
  (quem tem permissão).
- **Pessoas:** a lista de membros do clássico, sem sair do escritório.
- **Canais:** "+ Criar canal" e "Editar" na sala onde você está (quem pode
  gerenciar canais).
- **Eventos:** botão "Eventos" e o telão da recepção alternando entre o
  ranking de tempo e os próximos eventos.
- **Jogo e soundboard:** "🎮 jogo" embaixo do nome de quem está jogando e
  "🎵 som" quando alguém toca um som do soundboard na sua call.
- **Música ambiente** (🎵, desligada por padrão) que muda com a sala, e
  **dia/noite** pelo horário de Brasília.
- **Kart com a sala:** apertou F no kart com gente na mesma call → todo
  mundo da sala (com o Escritório aberto) entra na corrida, até 6 pilotos,
  e bots completam os 6 karts. Pista de ~1,3 km com floresta, praia,
  deserto e cidade. Posições pelo Realtime (tópico `kart:`, PARTE 33),
  só entre os pilotos e só durante a corrida.
- **Minigames:** Kart 3D, Chuva de Banana 3D (seu mamaco com a cesta),
  Memória, Reflexo e Cobra, com **ranking entre amigos** (o seu melhor
  resultado sobe sozinho quando você bate o recorde). **Conquistas** na aba
  do "Meu mamaco".

## Personagem (Blender)

As peças do mamaco (cabeça com o rosto fundido, orelha, corpo com barriga,
mão com dedos, pé com dedos, capuz e peças das fantasias) são modeladas no
Blender pelo script `tools/blender/mamaco_parts.py`:

    pip install bpy
    python3 -c "import sys; sys.argv=['x','parts.json']; exec(open('tools/blender/mamaco_parts.py').read())"

O `parts.json` gerado vai embutido no `engine.js` (peças compactadas).

## Código

- `src/office3d/engine.js` — motor 3D (personagem, prédio, salas, mapa,
  minigames). Para criar skins novas, ver `registerOutfit` no topo do
  arquivo.
- `src/office3d/Office3DView.tsx` — liga o motor aos dados do app.

## Créditos dos modelos e animações

Os pacotes da Kenney, KayKit e Quaternius são CC0 (domínio público): o crédito é cortesia. Os acessórios do Poly Pizza marcados como CC-BY exigem o crédito — mantenha esta seção.

- **Kenney (www.kenney.nl):** Car Kit (karts), Racing Kit (arquibancada, cones, outdoors, postes, tendas, barreiras), Nature Kit (árvores, palmeiras, cactos, pedras, arbustos, flores), City Kit Commercial e Suburban (prédios e casas da pista), Mini Characters (torcida), Particle Pack (faísca, fumaça e chama do kart), Emotes Pack (balões em cima dos corredores), Game Icons (ícones dos botões dos minigames), Furniture Kit e Food Kit (torradeira, liquidificador, lixeira, caixa, notebook e lanches do escritório).
- **KayKit — Furniture Bits, de Kay Lousberg (www.kaylousberg.com):** sofás, poltronas, cadeiras de reunião, mesas de centro, luminárias de chão, aparadores, criados-mudos e cactos do escritório.
- **Acessórios do mamaco (Poly Pizza, poly.pizza):** estes têm licença **CC-BY 3.0**, que exige o crédito abaixo (o arquivo do modelo foi reduzido e recolorido para o app):
  - "Crown", "Wizard hat", "Pirate hat" e "Sheriff Hat" — Poly by Google
  - "Sunglasses" — J-Toastie
  - "gas mask" — Marisha
  - "Security Hat" — Casey Tumbers
  - "wings" — Michael Fuchs
  - "Bat wing" — Poly by Google
  - "Pixel Sunglasses" — TRASH - TANUKI
  - "Backpack" e "Wizard" (chapéu vivo) — Quaternius (CC0)
- **Mixamo (Adobe):** animações do mamaco, convertidas para o esqueleto do personagem.
