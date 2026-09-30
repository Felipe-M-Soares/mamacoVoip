# Ping (latência) — o que foi feito e o que você precisa conferir

Dono em São Paulo. A voz vai por **LiveKit** (servidor de mídia); o chat,
login e o token de voz vão pelo **Supabase**. São dois "pings" diferentes.

## O que foi feito no app

1. **Ping real da call na barra do usuário.** Durante uma chamada, a faixa
   acima do painel do usuário mostra o RTT **medido pelo próprio WebRTC**
   (`getStats()`, `currentRoundTripTime` do par de candidatos ICE em uso)
   entre você e o servidor de mídia do LiveKit — ex.: `18ms · Ótima`. Passe
   o mouse pra ver o caminho: `UDP direto`, `TCP direto` ou `via TURN (TLS)`.
   Fora da call continua o ping HTTP até a API do Supabase.
   (`src/hooks/useVoiceMediaRtt.ts`, `src/lib/webrtcRtt.ts`, `UserPanel.tsx`)
2. **Entrada mais rápida na sala.**
   - Ao abrir o app, o endereço do servidor de voz da última call é
     "pré-aquecido" (DNS + TLS) — `prewarmLiveKitConnection`.
   - Ao entrar numa sala, assim que o token chega (em paralelo com o
     microfone e a presença), a sala chama `room.prepareConnection(url, token)`:
     no LiveKit Cloud isso também escolhe o **data center mais próximo**
     antes do `connect()`. (`src/context/VoiceContext.tsx`, só no join)
3. **ICE/TURN:** nada força relay. O LiveKit tenta UDP direto primeiro e só
   cai pra TURN/TCP/TLS se a rede bloquear UDP. Se a dica mostrar `via TURN`
   ou `TCP` o tempo todo, o bloqueio é da rede (firewall/roteador/VPN).
4. **Áudio (Opus):** quadro de 20 ms (padrão do WebRTC — maior = mais
   latência), DTX ligado na voz (silêncio não gasta banda, sem latência a
   mais) e RED (redundância no mesmo pacote: resiste a perda sem esperar
   retransmissão). O jitter buffer do navegador é adaptativo — **não**
   forçamos `jitterBufferTarget`/`playoutDelayHint` baixos: com perda de
   pacote isso picota a voz, e o ganho é de poucos ms.
5. **Token de voz perto do banco (opcional):** defina `VITE_SUPABASE_REGION`
   (ex.: `sa-east-1`) no `.env`/Vercel/GitHub Actions. A Edge Function
   `livekit-token` faz várias consultas ao banco; rodando na mesma região
   dele, cada consulta deixa de atravessar continente.

## O que você precisa conferir

### Supabase (maior ganho possível)

1. **Painel → Project Settings → General → Region.** Se não for
   **South America (São Paulo) `sa-east-1`**, toda ação do app (login,
   carregar mensagens, enviar, token de voz) faz ida-e-volta até outro
   continente — de São Paulo, ~110–150 ms pra `us-east-1` e ~200 ms+ pra
   Europa, contra ~5–20 ms dentro de SP.
2. **Mudar de região não é um botão:** é preciso criar um **projeto novo**
   em `sa-east-1` e migrar ([guia](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z),
   [migração entre projetos](https://supabase.com/docs/guides/platform/migrating-within-supabase)):
   - no plano pago com backups físicos existe "Restore to another project";
     senão, `supabase db dump` (roles, schema e dados) e restaurar no novo
     com `psql`;
   - copiar os arquivos do Storage (script com a API do Storage), redeploy
     das Edge Functions e das secrets (`LIVEKIT_*`), refazer Auth
     (provedor Google: client id/secret, Redirect URLs, templates de e-mail)
     e as configurações de Realtime ("Allow public access" desligado);
   - trocar `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (Vercel, GitHub
     Actions, `.env`) e publicar o app. Usuários precisam logar de novo.
   Faça num horário calmo; teste antes com o `loadtest/` no projeto novo.

### LiveKit Cloud

1. O LiveKit Cloud **tem região no Brasil** (grupo `sa`, "South America —
   Brazil") e, por padrão, conecta cada pessoa ao ponto mais próximo — não
   precisa configurar nada ([regiões](https://docs.livekit.io/deploy/admin/regions/endpoints)).
2. **Region pinning** (travar numa região) só existe no plano **Scale** e é
   pedido ao suporte ([docs](https://docs.livekit.io/deploy/admin/regions/region-pinning)) —
   só vale a pena por exigência de residência de dados; pra ping, o
   roteamento automático já escolhe São Paulo pra quem está no Brasil.
3. Numa call, veja o número na barra: de São Paulo pra São Paulo, algo
   entre **5 e 30 ms** é o esperado. Se estiver 120 ms+ com "UDP direto",
   provavelmente você está caindo em outra região (VPN, DNS esquisito) —
   teste sem VPN e com o DNS padrão da operadora.
4. Auto-hospedar o LiveKit numa VPS em São Paulo é a alternativa se um dia
   a banda do Cloud ficar cara (ver `loadtest/CAPACIDADE.md`).
