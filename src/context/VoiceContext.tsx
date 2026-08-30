import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAudioSettings } from '../hooks/useAudioSettings'
import { useScreenShareQuality, type QualityPreset } from '../hooks/useScreenShareQuality'
import { createNoiseSuppressor, type NoiseSuppressor, createScreenAudioDenoiser, type ScreenAudioDenoiser } from '../lib/noiseSuppression'
import { takePendingGameShareHint } from '../lib/screenShareGameHint'
import { takePendingAppAudioPid } from '../lib/pendingAppAudioCapture'
import { openScreenSharePicker } from '../lib/screenSharePickerBridge'
import { armScreenShareChoice } from '../lib/chooseScreenShareSource'
import { PcmStreamPlayer } from '../lib/pcmStreamPlayer'
import { preferStereoOpusForTrack } from '../lib/sdpStereo'
import {
  playConnectSound,
  playDisconnectSound,
  playMuteSound,
  playUnmuteSound,
  playUserJoinSound,
  playUserLeaveSound,
} from '../lib/sounds'

// Apenas STUN público está configurado neste ambiente. Um servidor TURN
// de verdade (coturn ou um serviço pago) precisa ser implantado à parte
// em produção — sem ele, peers atrás de NAT simétrico/restritivo podem
// não conseguir se conectar diretamente. Isso é uma limitação de
// infraestrutura, não do código de sinalização.
// TURN server opcional (retransmissão) — usado como reforço quando a
// conexão direta entre duas pessoas não é boa o suficiente. Configura
// via variáveis de ambiente (VITE_TURN_URL / VITE_TURN_USERNAME /
// VITE_TURN_CREDENTIAL) — se não estiverem definidas, o app funciona
// normal só com STUN, exatamente como já funcionava antes.
// DÉCIMA QUARTA RODADA: log em arquivo (ver window.electronAPI.logDebug
// em electron/preload.cjs e appendDebugLog em electron/main.cjs) além do
// console.error normal — existe especificamente pra diagnóstico à
// distância de bugs no compartilhamento de tela/áudio, quando quem está
// usando o app empacotado não tem (ou não sabe que tem) acesso ao
// DevTools. Usado nos pontos que podiam falhar completamente MUDOS
// antes desta rodada (a captura de áudio por processo E a reserva de
// áudio de sistema, ambas dentro de toggleScreenShare/
// switchScreenShareSource).
function logDebug(message: string) {
  console.error(`[VoiceContext] ${message}`)
  window.electronAPI?.logDebug?.(message)
}

const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined
const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined
const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...(turnUrl && turnUsername && turnCredential
    ? [{ urls: turnUrl, username: turnUsername, credential: turnCredential }]
    : []),
]

const MAX_PARTICIPANTS = 8

// Bitrate do MICROFONE (voz). O Opus pra voz mono já fica praticamente
// transparente (indistinguível do original) por volta de 96-128kbps —
// subir além disso não traz nada a mais pra ouvido nenhum, só gasta
// banda à toa. 128kbps é o teto real de "não dá pra melhorar mais só
// com bitrate" pra uma voz — o resto da qualidade (o quão limpo o SINAL
// que chega até aqui está) já é function do RNNoise + gate + AEC/AGC
// nativos (ver lib/noiseSuppression.ts e useAudioSettings.ts), não de
// bitrate.
const MIC_MAX_BITRATE = 128_000

// Bitrate do áudio da TRANSMISSÃO DE TELA (som do jogo/sistema) —
// diferente do preset de vídeo (que é sobre nitidez de imagem, em
// Mbps), e diferente do bitrate do microfone acima (voz mono precisa de
// bem menos que música/som de jogo estéreo). Antes esse áudio não
// recebia NENHUM ajuste, então ficava só no padrão baixo que o
// navegador usa pra Opus (~32kbps) — péssimo pra música ou som de jogo,
// que tem muito mais variação de frequência do que uma voz. 256kbps é
// próximo do que serviços de streaming de música chamam de "qualidade
// muito alta" (Opus estéreo satura a qualidade audível bem antes de
// 256kbps) — dá pra considerar isso o teto prático de "o máximo que
// vale a pena".
const SCREEN_SHARE_AUDIO_MAX_BITRATE = 256_000

// DÉCIMA RODADA — prazo pra confirmar que a captura de áudio por
// processo (native, ver startAppAudioCapture) está mesmo entregando
// áudio antes de aceitar a track dela como boa. Generoso o bastante pra
// nunca cortar uma ativação legítima (o próprio capture.cpp documenta
// "menos de 100ms" em condições normais), curto o bastante pra não
// atrasar perceptivelmente o início da transmissão quando a captura vai
// mesmo falhar.
const APP_AUDIO_CONFIRM_TIMEOUT_MS = 3000

// SEXTA RODADA de correção do compartilhamento de tela — a mudança mais
// importante até agora. "Invalid capture constraints (AbortError)"
// continuou aparecendo IDÊNTICO mesmo depois de: (1) tirar o "max" do
// frameRate, (2) unificar as duas chamadas de desktopCapturer.getSources(),
// (3) separar áudio e vídeo em chamadas totalmente independentes (áudio
// virou `audio: false` aqui — e o erro continuou do mesmo jeito). Esse
// último teste foi decisivo: já que o pedido de vídeo não tem NENHUM
// áudio junto e o erro é o mesmo, a causa só pode estar no próprio objeto
// de constraints de VÍDEO (width/height/frameRate como {ideal, max}),
// não no áudio — as rodadas anteriores estavam mexendo na parte errada.
//
// Em vez de continuar adivinhando QUAL propriedade exata desse objeto o
// Electron/Chromium está rejeitando (já tentei tirar o "max" sozinho e
// não resolveu), a mudança agora é estrutural: getDisplayMedia() passa a
// pedir só `video: true` — a forma mais simples e permissiva possível,
// sem nenhum objeto de constraints — pra garantir que a CAPTURA em si
// sempre funcione. A qualidade (resolução/taxa de quadros) deixa de ser
// pedida NA HORA de abrir a captura e passa a ser ajustada DEPOIS, com
// `track.applyConstraints(...)` na track de vídeo já ativa — uma chamada
// completamente separada, cuja falha (se acontecer) só significa "a
// captura continua na resolução/taxa nativa dela", nunca derruba a
// transmissão inteira. Isso finalmente separa por completo "conseguir
// compartilhar a tela" (agora à prova de qualquer constraint problemática)
// de "ajustar a qualidade fina" (best-effort, sem risco pro básico
// funcionar).
async function applyVideoQualityConstraints(track: MediaStreamTrack, preset: QualityPreset) {
  try {
    await track.applyConstraints({
      width: preset.capResolution ? { ideal: preset.width, max: preset.width } : { ideal: preset.width },
      height: preset.capResolution ? { ideal: preset.height, max: preset.height } : { ideal: preset.height },
      frameRate: { ideal: preset.frameRate },
    })
  } catch {
    // Sem problema — a transmissão já está rolando com a resolução/taxa
    // nativa da captura (quase sempre já é boa o bastante sozinha); só
    // não conseguiu o ajuste fino extra dessa vez.
  }
}

// OITAVA RODADA — mudança de arquitetura mais importante até agora: o
// erro "Invalid capture constraints (AbortError)" continuou IDÊNTICO
// depois de tirar o "max" do frameRate, unificar as chamadas de
// getSources, separar áudio e vídeo, e até reduzir o pedido de vídeo pro
// mínimo absoluto (`video: true`, sem NENHUM objeto de constraints) — ou
// seja, o problema nunca esteve em nenhum valor específico. Pesquisei a
// fundo (issues oficiais do electron/electron, documentação atual, como
// ferramentas de terceiros fazem isso) e a pista mais forte: o mecanismo
// por trás de getDisplayMedia() no Electron — session.setDisplayMediaRequestHandler,
// que intermediava esse pedido no processo principal — é uma API
// relativamente nova com histórico real de bugs em casos de borda. Como a
// mensagem nunca mudava não importa o que eu configurasse do lado de cá,
// a suspeita deixou de ser "algum valor errado" e passou a ser "o
// mecanismo em si".
//
// A partir de agora, esse mecanismo foi eliminado por completo. Em vez de
// getDisplayMedia() (que dispara o seletor sozinho, por trás), o fluxo
// passa a ser explícito, em três passos: (1) pede a lista de fontes
// ativamente via window.electronAPI.getScreenShareSources() — puro
// desktopCapturer.getSources() no processo principal, sem
// setDisplayMediaRequestHandler nenhum no meio; (2) abre o
// ScreenSharePicker.tsx "na mão" através de screenSharePickerBridge.ts e
// espera a pessoa escolher; (3) com o sourceId escolhido, chama
// getUserMedia() com a constraint CLÁSSICA "mandatory: {chromeMediaSource:
// 'desktop', chromeMediaSourceId}" — o jeito mais antigo do Electron pra
// isso, usado há anos por ferramentas de terceiros (ex.: ToDesktop) e por
// apps como o Rocket.Chat, que não passa nem perto do mecanismo suspeito.
// Cancelar o seletor (sourceId null) lança um DOMException NotAllowedError
// na mão, pra continuar caindo no mesmo tratamento de "cancelamento não é
// erro de verdade" que já existia mais abaixo.
// NONA RODADA: fiz um teste real (rodando o Electron de verdade num
// ambiente de teste, não só lendo documentação) e confirmei que TANTO o
// caminho antigo (getUserMedia + chromeMediaSourceId, usado abaixo como
// principal) QUANTO o caminho moderno (getDisplayMedia, que tinha sido
// abandonado na rodada anterior por suspeita de ser o culpado) funcionam
// perfeitamente sozinhos — nenhum dos dois está quebrado no Electron/
// Chromium em si. Ou seja: se ainda assim "Invalid capture constraints"
// aparecer no computador de alguém, é uma peculiaridade BEM específica
// daquela máquina (driver de vídeo, alguma configuração do Windows, ou
// mesmo um anti-cheat de jogo interferindo) que pode afastar um dos dois
// caminhos sem necessariamente afetar o outro.
//
// Por isso a captura agora tenta os DOIS caminhos automaticamente, um
// atrás do outro, sem pedir pra escolher a fonte de novo: primeiro o
// caminho principal (getUserMedia); se ele falhar por qualquer motivo que
// não seja a pessoa ter cancelado o seletor, tenta imediatamente o
// caminho alternativo (getDisplayMedia, usando a MESMA fonte já
// escolhida — ver pinFallbackShareSource/electron/main.cjs). Só desiste
// de vez (e mostra o erro pra pessoa) se os DOIS caminhos falharem.
// BUG REAL — provável causa de "imagem da transmissão sai ruim mesmo
// com Qualidade máxima selecionada": a captura inicial (getUserMedia
// com a sintaxe antiga `mandatory: { chromeMediaSource: 'desktop' }`,
// logo abaixo) não levava NENHUM limite de largura/altura/taxa de
// quadros — só o `chromeMediaSourceId`. Sem esses limites explícitos,
// o Chromium decide sozinho a resolução/taxa da captura, e o valor que
// ele escolhe por padrão nesse caminho legado costuma ficar bem abaixo
// da resolução nativa da tela (é um comportamento antigo e conhecido
// desse mecanismo específico do Electron, documentado em várias
// ferramentas de terceiros que passaram pelo mesmo problema). A
// tentativa de corrigir isso DEPOIS, via `track.applyConstraints()` em
// applyVideoQualityConstraints, não consegue "recuperar" detalhe que a
// captura já descartou na hora — um `constrainable` de vídeo pode
// PEDIR uma resolução maior, mas normalmente só reduz a partir do que
// já foi capturado, nunca aumenta de volta; a falha desse ajuste fica
// silenciosa (try/catch vazio ali), então nada avisa que a imagem
// ficou presa na resolução baixa da captura inicial. A correção passa
// o preset de qualidade JÁ na captura (mandatory.minWidth/maxWidth,
// minHeight/maxHeight, minFrameRate/maxFrameRate) — mesma ideia da
// Qualidade máxima (`capResolution: false`) já usar um teto bem
// folgado (7680×4320) em vez de forçar um valor menor: aqui o "min"
// baixo (1px) deixa o Chromium livre pra capturar na resolução NATIVA
// da tela até esse teto generoso, e o "max" no preset "Desempenho"
// realmente limita como pretendido.
async function captureScreenShareStream(preset: QualityPreset, opts?: { auto?: boolean }): Promise<MediaStream> {
  if (!window.electronAPI) {
    throw new DOMException('Compartilhamento de tela só funciona no app desktop.', 'NotAllowedError')
  }
  // DÉCIMA PRIMEIRA RODADA — bug real relatado com print de tela: no
  // Linux (bem provavelmente Wayland, a julgar pelo visual do sistema no
  // print), o seletor customizado abaixo (baseado em
  // window.electronAPI.getScreenShareSources(), que por baixo é
  // desktopCapturer.getSources()) só listava a JANELA DO PRÓPRIO Mamacos
  // Voip — nem o navegador, nem o jogo, apareciam, mesmo abertos e
  // visíveis. Não é um bug de matching (o tipo de coisa corrigida na
  // rodada anterior) — é estrutural: no Wayland, por segurança do
  // próprio protocolo, um app comum não pode enumerar sozinho as janelas
  // de outros processos; só o compositor sabe disso, através do "portal"
  // do sistema (xdg-desktop-portal / ScreenCast) — é ELE quem mostra um
  // seletor NATIVO com miniaturas de verdade de tudo que está aberto.
  // desktopCapturer.getSources() nesse ambiente não devolve essa lista
  // completa pra gente montar uma UI própria (daí sobrar só a própria
  // janela, que o Electron sempre enxerga por ser dono dela).
  //
  // É exatamente esse portal nativo que o Discord/OBS/Chrome usam no
  // Wayland — em vez de montar uma lista própria (que funciona bem no
  // Windows, onde desktopCapturer.getSources() devolve tudo de verdade),
  // eles chamam getDisplayMedia() puro e deixam o SISTEMA mostrar o
  // seletor dele, com miniaturas de qualquer janela (jogo, navegador,
  // etc.) e um toggle de "compartilhar também o áudio" quando o
  // compositor suporta. Pra isso funcionar, electron/main.cjs
  // deliberadamente NÃO registra session.setDisplayMediaRequestHandler
  // no Linux (ver o comentário grande lá) — sem esse handler no meio, o
  // Electron/Chromium entrega o pedido direto pro portal do sistema, que
  // devolve um MediaStream já com a escolha da pessoa (vídeo, e áudio
  // quando ela marcou a opção no próprio seletor nativo).
  if (window.electronAPI.platform === 'linux') {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  }
  const payload = await window.electronAPI.getScreenShareSources()
  // DÉCIMA QUARTA RODADA — atalho "Compartilhar tela" do aviso "Jogando
  // X!" (GameDetectedToast.tsx): antes disso, esse botão sempre abria o
  // seletor completo de novo, mesmo já sabendo qual jogo é (relatado:
  // "esse botão já devia compartilhar direto"). Quando `opts.auto` pede
  // isso, resolve a MESMA fonte que ganharia destaque no seletor (o card
  // "Jogo"/"Sugestão" — ver a mesma lógica em ScreenSharePicker.tsx) e
  // pula a etapa manual, reaproveitando armScreenShareChoice pra deixar
  // os mesmos recados (PID pro áudio isolado, aviso de fechamento
  // automático) que o clique manual deixaria. Se não tiver candidato
  // nenhum (ex.: o jogo saiu de primeiro plano entre o aviso aparecer e
  // a pessoa clicar), cai pro seletor manual normal em vez de travar ou
  // "não fazer nada".
  let sourceId: string | null
  if (opts?.auto) {
    const { sources, suggestion } = payload
    const gameCard = suggestion
      ? (sources.find((s) => s.isExactGameWindow) ?? sources.find((s) => s.isGameDisplay) ?? null)
      : null
    if (gameCard && suggestion) {
      armScreenShareChoice(
        gameCard.id,
        sources,
        gameCard,
        suggestion,
        suggestion.isKnownGame ? { processNames: suggestion.processNames, label: suggestion.label } : undefined
      )
      sourceId = gameCard.id
    } else {
      sourceId = await openScreenSharePicker(payload)
    }
  } else {
    sourceId = await openScreenSharePicker(payload)
  }
  if (!sourceId) {
    throw new DOMException('Compartilhamento cancelado.', 'NotAllowedError')
  }
  try {
    // Sintaxe antiga de propósito (não é MediaTrackConstraints moderno) —
    // ver o comentário grande acima. `as unknown as` porque o TypeScript
    // do DOM não conhece mais esse formato "mandatory" (foi removido da
    // documentação atual, mas o Electron/Chromium ainda aceita).
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1,
          maxWidth: preset.width,
          minHeight: 1,
          maxHeight: preset.height,
          minFrameRate: 1,
          maxFrameRate: preset.frameRate,
        },
      },
    } as unknown as MediaStreamConstraints
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch (primaryErr) {
    try {
      await window.electronAPI.pinFallbackShareSource(sourceId)
      // Corre contra um prazo — ver o comentário grande em
      // electron/main.cjs perto de setDisplayMediaRequestHandler: testando
      // de verdade, achei um jeito (raro, mas real) desse plano B nunca
      // resolver NEM rejeitar (a Promise do próprio getDisplayMedia fica
      // pendurada pra sempre) se a fonte não puder mais ser capturada por
      // algum motivo. Sem esse prazo, a pessoa ficaria esperando pra
      // sempre sem erro nenhum na tela — pior do que só mostrar o erro do
      // caminho principal.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new DOMException('Tempo esgotado no plano B de captura.', 'TimeoutError')), 6000)
      )
      return await Promise.race([navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }), timeout])
    } catch {
      // Os DOIS caminhos falharam — relança o erro do caminho PRINCIPAL
      // (getUserMedia), porque a mensagem/nome dele costuma ser mais
      // específica (ex.: "Invalid capture constraints (AbortError)") do
      // que a do plano B, que tende a rejeitar de forma mais genérica.
      throw primaryErr
    }
  }
}

// ANTES disso existia uma SCREEN_SHARE_AUDIO_CONSTRAINTS aqui
// (echoCancellation/noiseSuppression/autoGainControl desligados +
// channelCount: 2), aplicada tanto no áudio "normal" do getDisplayMedia()
// quanto — na QUINTA rodada de correção — na nova captura de áudio de
// sistema separada (ver captureSystemAudioTrack). Removida de propósito
// dessa segunda: ela usa a sintaxe ANTIGA "mandatory: {chromeMediaSource}",
// e misturar constraints antigas com essas propriedades MODERNAS no mesmo
// objeto é candidato relevante pra causa do "Invalid capture constraints"
// que motivou essa rodada — ver o comentário grande em
// captureSystemAudioTrack pro raciocínio completo. Perde-se esse ajuste
// fino de qualidade só nesse áudio de sistema (a captura por processo,
// quando funciona, não tem essa limitação — é PCM cru).

// No Windows, a PRIMEIRA chamada de getUserMedia às vezes esbarra numa
// corrida com a permissão de microfone do próprio sistema operacional
// (mais comum dentro do app desktop) — falha na primeira tentativa e
// funciona normalmente na segunda. Tentando de novo automaticamente
// aqui, a pessoa não precisa clicar duas vezes pra entrar na call.
async function getUserMediaWithRetry(constraints: MediaStreamConstraints, attempts = 2): Promise<MediaStream> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      lastError = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }
  throw lastError
}
const SPEAKING_THRESHOLD = 12
// Fala normal tem pausas curtas entre sílabas/palavras onde o nível de
// áudio cai abaixo do limiar por uma fração de segundo — sem isso, o
// indicador de "falando" (anel ao redor do avatar) piscava
// rapidamente ligando/desligando a cada uma dessas pausas, em vez de
// ficar aceso de forma contínua enquanto a pessoa fala. "Liga" na hora
// (assim que passa do limiar) mas só "desliga" depois de ficar
// SPEAKING_RELEASE_MS sem nenhuma amostra acima do limiar.
const SPEAKING_RELEASE_MS = 500

interface PeerState {
  pc: RTCPeerConnection
  makingOffer: boolean
  polite: boolean
}

export interface VoiceParticipant {
  userId: string
  cameraStream: MediaStream | null
  screenStream: MediaStream | null
  speaking: boolean
}

interface SignalPayload {
  from: string
  to: string
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

interface VoiceContextValue {
  connectedChannelId: string | null
  connectedChannelName: string | null
  joiningChannelId: string | null
  connectedAt: number | null
  // Latência REAL da chamada de voz (peer a peer) — diferente do ping
  // do banco de dados. userId -> milissegundos de ida-e-volta.
  connectionQuality: Record<string, number>
  connectedServerId: string | null
  connecting: boolean
  error: string | null
  // Fecha o aviso de erro manualmente (ver o banner em VoiceChannelView.tsx
  // que aparece durante uma call em andamento) — sem isso não tinha
  // nenhum jeito de tirar uma mensagem de erro da tela sem sair do canal.
  clearError: () => void
  participants: Record<string, VoiceParticipant>
  muted: boolean
  deafened: boolean
  toggleDeafen: () => void
  videoEnabled: boolean
  screenSharing: boolean
  localScreenStream: MediaStream | null
  speaking: boolean
  // serverId é null pra uma chamada de voz em DM/grupo (não existe
  // linha na tabela channels pra esse caso) — ver o branch dentro de
  // join() logo abaixo. displayName/userLimit substituem o que
  // normalmente viria da tabela channels quando não há uma.
  join: (channelId: string, serverId: string | null, options?: { displayName?: string; userLimit?: number }) => Promise<void>
  leave: () => void
  toggleMute: () => void
  pushToTalkEnabled: boolean
  setPushToTalkEnabled: (enabled: boolean) => void
  pushToTalkKey: string
  setPushToTalkKey: (code: string) => void
  pushToTalkActive: boolean
  globalPushToTalkAvailable: boolean
  pushToTalkGlobalKeyName: string | null
  captureGlobalPushToTalkKey: () => Promise<string | null>
  toggleVideo: () => Promise<void>
  // `opts.auto` — ver o comentário grande em captureScreenShareStream —
  // usado só pelo atalho "Compartilhar tela" do aviso "Jogando X!"
  // (GameDetectedToast.tsx) pra pular o seletor manual quando dá pra
  // resolver a fonte sozinho.
  toggleScreenShare: (opts?: { auto?: boolean }) => Promise<void>
  // Troca a janela/tela sendo compartilhada sem parar a transmissão
  // atual primeiro — ver o comentário grande na implementação.
  switchScreenShareSource: () => Promise<void>
  playSoundboardSound: (url: string) => void
  changeMicrophone: (deviceId: string) => Promise<void>
  refreshAudioConstraints: (
    overrides?: Partial<
      Pick<
        ReturnType<typeof useAudioSettings>,
        'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'micSensitivity' | 'micSensitivityMode'
      >
    >
  ) => Promise<void>
  audioSettings: ReturnType<typeof useAudioSettings>
  screenShareQuality: ReturnType<typeof useScreenShareQuality>
  maxParticipants: number
  masterVolume: number
  setMasterVolume: (volume: number) => void
  soundboardVolume: number
  setSoundboardVolume: (volume: number) => void
  getParticipantVolume: (userId: string) => number
  setParticipantVolume: (userId: string, volume: number) => void
  getScreenShareVolume: (userId: string) => number
  setScreenShareVolume: (userId: string, volume: number) => void
}

export const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

// Conexão de voz vive aqui, FORA da árvore de "qual canal estou vendo
// agora" — é por isso que trocar pra um canal de texto não te tira mais
// da chamada. Só a chamada explícita de leave() desconecta de verdade.
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const audioSettings = useAudioSettings()
  const screenShareQuality = useScreenShareQuality()
  const screenShareQualityRef = useRef(screenShareQuality.preset)
  screenShareQualityRef.current = screenShareQuality.preset
  const audioSettingsRef = useRef(audioSettings)
  audioSettingsRef.current = audioSettings

  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null)
  // Nome do canal conectado, guardado AQUI (em vez de a UI ter que buscar
  // na lista de canais do servidor atual) — é o que permite mostrar "Voz
  // conectada: nome-do-canal" em QUALQUER tela (Início/DMs, um servidor
  // diferente, etc.), não só quando a pessoa está olhando o servidor
  // onde a call está rolando. ChannelsContext só existe dentro de um
  // servidor específico, então depender dele quebraria fora desse caso.
  const [connectedChannelName, setConnectedChannelName] = useState<string | null>(null)
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null)
  const [connectedServerId, setConnectedServerId] = useState<string | null>(null)
  const [connectedAt, setConnectedAt] = useState<number | null>(null)
  const [connectionQuality, setConnectionQuality] = useState<Record<string, number>>({})
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)

  // Push-to-talk: quando ativado, o microfone fica DESLIGADO por
  // padrão e só liga enquanto a tecla escolhida está pressionada — bom
  // pra quem não quer vazar áudio de fundo (jogo, teclado mecânico,
  // etc.) sem precisar ficar mutando/desmutando manualmente toda hora.
  // Só funciona com o app em foco (ver aviso no README sobre a
  // limitação de não capturar tecla globalmente).
  const [pushToTalkEnabled, setPushToTalkEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-enabled') === 'true'
    } catch {
      return false
    }
  })
  const [pushToTalkKey, setPushToTalkKeyState] = useState<string>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-key') || 'ControlLeft'
    } catch {
      return 'ControlLeft'
    }
  })
  const [pushToTalkActive, setPushToTalkActive] = useState(false)
  const pushToTalkEnabledRef = useRef(pushToTalkEnabled)
  pushToTalkEnabledRef.current = pushToTalkEnabled
  const pushToTalkKeyRef = useRef(pushToTalkKey)
  pushToTalkKeyRef.current = pushToTalkKey

  // Push-to-talk GLOBAL — funciona mesmo com o app fora de foco (tipo
  // com um jogo em tela cheia por cima). Só existe dentro do app
  // desktop, e só se o módulo nativo (uiohook-napi) tiver carregado
  // com sucesso naquele sistema especificamente — se não, cai
  // automaticamente pro modo antigo (só com o app em foco), sem
  // quebrar nada.
  const [globalPushToTalkAvailable, setGlobalPushToTalkAvailable] = useState(false)
  const [pushToTalkGlobalKeyName, setPushToTalkGlobalKeyNameState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-global-keyname')
    } catch {
      return null
    }
  })
  const pushToTalkGlobalKeycodeRef = useRef<number | null>(null)
  try {
    const raw = localStorage.getItem('mamacos-ptt-global-keycode')
    pushToTalkGlobalKeycodeRef.current = raw ? Number(raw) : null
  } catch {
    pushToTalkGlobalKeycodeRef.current = null
  }
  const usingGlobalPTTRef = useRef(false)
  usingGlobalPTTRef.current = globalPushToTalkAvailable && pushToTalkGlobalKeycodeRef.current !== null

  // Combina mudo manual + push-to-talk numa única fonte de verdade pra
  // saber se a track de áudio deve estar transmitindo ou não.
  function applyMicEnabledState(pttHeld: boolean) {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    if (mutedRef.current) {
      track.enabled = false
      return
    }
    if (pushToTalkEnabledRef.current) {
      track.enabled = pttHeld
      return
    }
    track.enabled = true
  }

  function setPushToTalkEnabled(enabled: boolean) {
    setPushToTalkEnabledState(enabled)
    try {
      localStorage.setItem('mamacos-ptt-enabled', String(enabled))
    } catch {
      // best-effort
    }
    setPushToTalkActive(false)
    applyMicEnabledState(false)
  }

  function setPushToTalkKey(code: string) {
    setPushToTalkKeyState(code)
    try {
      localStorage.setItem('mamacos-ptt-key', code)
    } catch {
      // best-effort
    }
  }

  // Pede pro processo principal escutar a PRÓXIMA tecla pressionada em
  // qualquer lugar (mesmo com outro app em foco) e usa ela como a
  // tecla de push-to-talk global. Retorna null se a captura falhar,
  // expirar (10s sem apertar nada), ou se o modo global não estiver
  // disponível nesse sistema.
  async function captureGlobalPushToTalkKey(): Promise<string | null> {
    if (!window.electronAPI?.startPTTCapture) return null
    const result = await window.electronAPI.startPTTCapture()
    if (!result) return null
    pushToTalkGlobalKeycodeRef.current = result.keycode
    setPushToTalkGlobalKeyNameState(result.name)
    try {
      localStorage.setItem('mamacos-ptt-global-keycode', String(result.keycode))
      localStorage.setItem('mamacos-ptt-global-keyname', result.name)
    } catch {
      // best-effort
    }
    window.electronAPI.setGlobalPTTKey?.(result.keycode)
    return result.name
  }

  useEffect(() => {
    if (!window.electronAPI?.isGlobalPTTAvailable) return
    window.electronAPI.isGlobalPTTAvailable().then((available) => {
      setGlobalPushToTalkAvailable(available)
      // Se já tinha uma tecla global configurada de uma sessão
      // anterior, reativa ela agora — o processo principal não guarda
      // isso sozinho entre reinícios do app.
      if (available && pushToTalkGlobalKeycodeRef.current !== null) {
        window.electronAPI?.setGlobalPTTKey?.(pushToTalkGlobalKeycodeRef.current)
      }
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onPTTState) return
    return window.electronAPI.onPTTState((active) => {
      if (!usingGlobalPTTRef.current) return
      setPushToTalkActive(active)
      applyMicEnabledState(active)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Se o modo global já está cuidando disso, o listener local não
      // faz nada — evita os dois mecanismos brigando entre si.
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      e.preventDefault()
      setPushToTalkActive(true)
      applyMicEnabledState(true)
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      setPushToTalkActive(false)
      applyMicEnabledState(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [speaking, setSpeaking] = useState(false)

  const [masterVolume, setMasterVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('mamacos-master-volume')
      return raw ? Number(raw) : 100
    } catch {
      return 100
    }
  })
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('mamacos-participant-volumes')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
  // Volume do soundboard é INDEPENDENTE do volume geral (masterVolume) —
  // pedido explícito: "cada usuario controlar seu proprio volume para
  // nao exagerar no audio". Efeitos sonoros costumam ser gravados em
  // níveis bem diferentes uns dos outros (e de voz normal), então um
  // controle separado deixa a pessoa abaixar só os sons sem mexer no
  // volume de quem está falando. Padrão um pouco mais baixo (70%) que o
  // volume geral, já que "susto" é justamente a reclamação mais comum
  // desse tipo de recurso.
  const [soundboardVolume, setSoundboardVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('mamacos-soundboard-volume')
      return raw ? Number(raw) : 70
    } catch {
      return 70
    }
  })

  function setMasterVolume(volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setMasterVolumeState(clamped)
    try {
      localStorage.setItem('mamacos-master-volume', String(clamped))
    } catch {
      // best-effort
    }
  }

  // "Desativar áudio" (deafen) — igual o Discord: para de ouvir todo
  // mundo de uma vez (e muta o mic junto, se ele já não estivesse
  // mutado) sem precisar abaixar o volume geral manualmente toda vez.
  // Vive AQUI no contexto (não como estado local de um componente)
  // porque tanto o UserPanel (sempre visível) quanto a barra de controles
  // de dentro da chamada (VoiceChannelView) precisam ler/alternar o
  // MESMO estado — antes de mover pra cá, cada um tinha sua própria
  // cópia e ficavam dessincronizados.
  const [deafened, setDeafenedState] = useState(false)
  const deafenedRef = useRef(false)
  function setDeafened(value: boolean) {
    deafenedRef.current = value
    setDeafenedState(value)
  }
  const preDeafenVolumeRef = useRef(100)
  const preDeafenWasMutedRef = useRef(false)
  function toggleDeafen() {
    if (deafenedRef.current) {
      setMasterVolume(preDeafenVolumeRef.current)
      if (!preDeafenWasMutedRef.current && mutedRef.current) toggleMute()
      setDeafened(false)
    } else {
      preDeafenVolumeRef.current = masterVolume
      preDeafenWasMutedRef.current = mutedRef.current
      setMasterVolume(0)
      if (!mutedRef.current) toggleMute()
      setDeafened(true)
    }
  }

  function setSoundboardVolume(volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setSoundboardVolumeState(clamped)
    try {
      localStorage.setItem('mamacos-soundboard-volume', String(clamped))
    } catch {
      // best-effort
    }
  }

  function getParticipantVolume(userId: string): number {
    return participantVolumes[userId] ?? 100
  }

  function setParticipantVolume(userId: string, volume: number) {
    // DÉCIMA OITAVA RODADA: teto subiu de 100 pra 200 — "qualidade tá boa
    // mas o volume tá baixo" quando quem fala tem captação de mic fraca
    // não tinha solução nenhuma antes: 100% aqui só reproduzia o áudio
    // exatamente como chegou, sem reforço nenhum possível. Ver o GainNode
    // novo em RemoteAudio (CallMediaTiles.tsx), que agora sabe amplificar
    // de verdade acima de 100%, não só atenuar.
    const clamped = Math.max(0, Math.min(200, volume))
    setParticipantVolumes((prev) => {
      const next = { ...prev, [userId]: clamped }
      try {
        localStorage.setItem('mamacos-participant-volumes', JSON.stringify(next))
      } catch {
        // best-effort
      }
      return next
    })
  }

  // Volume separado pro ÁUDIO da transmissão de tela de cada pessoa
  // (som do jogo dela), independente do volume da voz/microfone dela —
  // dá pra abaixar o jogo de alguém sem mutar a voz da pessoa, e vice-versa.
  const [screenShareVolumes, setScreenShareVolumesState] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('mamacos-screenshare-volumes')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  function getScreenShareVolume(userId: string): number {
    return screenShareVolumes[userId] ?? 100
  }

  function setScreenShareVolume(userId: string, volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setScreenShareVolumesState((prev) => {
      const next = { ...prev, [userId]: clamped }
      try {
        localStorage.setItem('mamacos-screenshare-volumes', JSON.stringify(next))
      } catch {
        // best-effort
      }
      return next
    })
  }

  const userIdRef = useRef<string | null>(null)
  userIdRef.current = user?.id ?? null

  const connectedRef = useRef(false)
  const hasSyncedRef = useRef(false)
  const channelUserLimitRef = useRef(0)
  // Horário (relativo, só usado pra ORDENAR) em que essa pessoa mandou o
  // próprio `track()` de presença ao entrar no canal — ver o comentário
  // grande no handler de 'sync' logo abaixo pra entender por que isso
  // resolve a corrida de "duas pessoas entram ao mesmo tempo quando só
  // sobra 1 vaga".
  const joinedAtRef = useRef(0)
  const realtimeRef = useRef<RealtimeChannel | null>(null)
  // DÉCIMA NONA RODADA — bug relatado: "sair de uma sala e voltar buga,
  // mostra que você está sozinho mesmo tendo gente". Causa: leave()
  // sempre zerou connectedRef/realtimeRef NA HORA (bom pra UI reagir
  // sem esperar rede nenhuma), mas o desligamento de verdade do canal
  // Realtime anterior (untrack() + removeChannel(), os dois assíncronos,
  // um round-trip até o servidor) continuava rodando em segundo plano.
  // Se join() do MESMO canal disparasse antes desse desligamento
  // terminar, a nova inscrição no MESMO tópico ("voice:<channelId>")
  // podia colidir com a antiga ainda sendo encerrada do lado do
  // servidor — o presence 'sync' que chegava de volta então refletia um
  // estado incompleto (só você), já que o servidor ainda não tinha
  // processado a saída/entrada limpa o bastante pra devolver a foto
  // completa de quem está no canal. Guarda a Promise desse
  // desligamento aqui; join() espera ela terminar (se existir) ANTES de
  // criar o novo canal — sem atrasar o que a pessoa VÊ ao clicar
  // "sair" (isso continua instantâneo), só atrasa uma reentrada rápida
  // no MESMO canal até a saída anterior estar de fato confirmada.
  const leaveTeardownRef = useRef<Promise<void> | null>(null)
  const peersRef = useRef<Map<string, PeerState>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  // ID da track de ÁUDIO da transmissão de tela (som de jogo/sistema)
  // enquanto uma transmissão COM áudio estiver rolando — `null` fora
  // disso (sem transmissão, ou transmissão só de vídeo). Usado só pra
  // saber qual seção do SDP forçar estéreo (ver sdpStereo.ts e
  // setLocalDescriptionPreferringStereo abaixo) — o microfone continua
  // de fora de propósito, então precisa desse ID pra saber ONDE mexer
  // sem afetar a voz.
  const screenAudioTrackIdRef = useRef<string | null>(null)
  // DÉCIMA QUINTA RODADA — a MediaStream (não só a track) que carrega o
  // áudio da transmissão de tela ATUAL, seja qual for a origem (captura
  // por processo via appAudioPlayerRef.current.stream, ou áudio de
  // sistema via `new MediaStream([systemAudioTrack])` em
  // toggleScreenShare/switchScreenShareSource). Guardar essa referência
  // aqui — em vez de deixar createPeerConnection construir uma
  // MediaStream NOVA a cada peer que entra depois (como acontecia antes)
  // — garante que o .id enviado a todo mundo via broadcastScreenMeta seja
  // sempre O MESMO, não importa quantos peers já existiam ou entraram
  // depois: sem isso, cada `new MediaStream([track])` gerava um id
  // diferente, e o broadcast (que é um só, pra sala toda) só podia
  // acertar quem recebesse por último.
  const screenAudioSourceStreamRef = useRef<MediaStream | null>(null)
  // DÉCIMA SÉTIMA RODADA — igual applyNoiseSuppression faz pro
  // microfone (ver mais abaixo), mas pro áudio da TRANSMISSÃO (ver
  // createScreenAudioDenoiser em lib/noiseSuppression.ts, e o
  // comentário grande lá pro porquê). `screenAudioDenoiserRef` é a
  // instância WASM ativa; `screenAudioOutputTrackRef` é a track que
  // REALMENTE está sendo mandada pros peers agora (já filtrada, quando
  // o filtro funcionou — a bruta, se ele falhar) — existe pra
  // substituir `appAudioTrackRef.current ?? systemAudioTrackRef.current`
  // em todo lugar que precisa saber "qual track está no ar", já que
  // agora essas duas passaram a guardar só a captura BRUTA (usada pra
  // parar o processo nativo/o loopback quando a transmissão termina ou
  // troca de fonte), não mais a track de verdade enviada por WebRTC.
  const screenAudioDenoiserRef = useRef<ScreenAudioDenoiser | null>(null)
  const screenAudioOutputTrackRef = useRef<MediaStreamTrack | null>(null)
  // A track de áudio dentro de `localStreamRef` passa a ser a track JÁ
  // TRATADA pelo RNNoise (quando ativo), não mais a track crua do
  // dispositivo — então precisamos guardar a crua separadamente aqui só
  // pra saber qual track parar de verdade (`.stop()`) quando o
  // microfone muda ou a call termina. Parar só a tratada deixaria o
  // dispositivo físico "preso" (luzinha do mic acesa, app segurando o
  // recurso) mesmo depois de trocar de microfone.
  const rawMicTrackRef = useRef<MediaStreamTrack | null>(null)
  const noiseSuppressorRef = useRef<NoiseSuppressor | null>(null)
  // Estado do modo automático de sensibilidade do mic (ver useEffect
  // "Sensibilidade automática do microfone" mais abaixo). `noiseFloorDbRef`
  // é a estimativa (média móvel) do volume da sala em silêncio;
  // `lastAppliedThresholdDbRef` guarda o último limiar já mandado pro
  // worklet, só pra não ficar recriando o gate a cada leitura por causa
  // de variações de menos de 1.5dB (isso geraria um "crepitar" audível).
  const noiseFloorDbRef = useRef<number | null>(null)
  const lastAppliedThresholdDbRef = useRef<number | null>(null)
  function resetAutoSensitivity() {
    noiseFloorDbRef.current = null
    lastAppliedThresholdDbRef.current = null
  }
  const audioContextRef = useRef<AudioContext | null>(null)
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map())
  // Última vez (timestamp) que cada participante ficou acima do limiar
  // de fala — usado pra suavizar a detecção (ver o useEffect "Detecção
  // de fala" mais abaixo).
  const lastAboveThresholdRef = useRef<Map<string, number>>(new Map())
  // Cada peer pode mandar mais de uma MediaStream (mic/câmera + tela).
  // Em vez de adivinhar qual é qual pela ordem de chegada (frágil e foi
  // a causa do compartilhamento de tela não aparecer pros outros),
  // guardamos toda stream recebida aqui e usamos o mapeamento explícito
  // vindo do broadcast 'screen-meta' pra saber qual stream.id é a tela.
  const rawStreamsRef = useRef<Map<string, Map<string, MediaStream>>>(new Map())
  const screenStreamIdsRef = useRef<Map<string, string>>(new Map())
  // DÉCIMA QUINTA RODADA — o áudio da transmissão de tela (som do
  // jogo/sistema, capturado à parte — ver appAudioTrackRef/
  // systemAudioTrackRef) sempre viajou numa MediaStream SEPARADA da de
  // vídeo (audioSourceStream, com .id próprio, diferente do stream.id de
  // screenStreamRef.current). O broadcast 'screen-meta' avisava só o
  // stream.id do VÍDEO — o lado que recebe nunca tinha como saber que
  // aquela outra stream de áudio que chegou também era da tela
  // compartilhada, e ela caía direto no `else if (!cameraStream)` de
  // recomputeParticipant, sendo tratada (errado) como se fosse
  // webcam. Resultado: screenStream nunca tinha uma track de áudio pra
  // NINGUÉM que estivesse assistindo, não importa o quão bem a captura
  // local tivesse funcionado — a causa raiz de "transmissão muda pros
  // outros". Este par de Maps é o espelho, do lado de quem recebe, do
  // screenAudioSourceStreamRef abaixo: guarda qual stream.id (por peer)
  // é o ÁUDIO da tela, e o resultado combinado (vídeo+áudio) já pronto
  // pra não recriar a MediaStream toda vez que uma nova track chega (ver
  // combineScreenStream mais abaixo).
  const screenAudioStreamIdsRef = useRef<Map<string, string>>(new Map())
  const combinedScreenStreamsRef = useRef<
    Map<string, { stream: MediaStream; videoTrackId: string | null; audioTrackId: string | null }>
  >(new Map())
  // Cancela a inscrição em onWatchedProcessExited usada pra auto-parar o
  // compartilhamento de TELA CHEIA quando o jogo/app fecha (ver
  // screenShareGameHint.ts e toggleScreenShare abaixo). Só existe
  // enquanto uma captura desse tipo específico está ativa.
  const gameShareWatchRef = useRef<(() => void) | null>(null)
  // Vigia de foco do jogo (mitigação do vazamento em "compartilhar tela
  // cheia" — ver electron/main.cjs). Guarda, por peer, o RTCRtpSender da
  // track de VÍDEO da tela (não o áudio) — é nele que trocamos a track de
  // verdade por uma "cortina" preta quando a pessoa alterna pra fora do
  // jogo, e de volta quando ela volta. Sem guardar por peer, teríamos que
  // procurar o sender certo em cada pc de novo a cada troca de foco.
  const screenSendersRef = useRef<Map<string, RTCRtpSender>>(new Map())
  // DÉCIMA RODADA — bug real achado revendo com calma createPeerConnection:
  // o áudio da transmissão de tela (captura por processo OU áudio de
  // sistema — ver appAudioTrackRef/systemAudioTrackRef abaixo) vive FORA
  // de screenStreamRef.current desde a QUINTA RODADA (vídeo e áudio viraram
  // duas chamadas independentes). createPeerConnection só replicava
  // screenStreamRef.current (só vídeo) pra quem entra na call DEPOIS que a
  // transmissão já começou — a track de áudio nunca era adicionada a essa
  // conexão nova. Resultado: qualquer pessoa que entrasse no canal DEPOIS
  // de alguém já estar compartilhando tela recebia o vídeo perfeitamente,
  // mas NUNCA o áudio daquela transmissão — do ponto de vista de quem
  // entrou depois, era exatamente "compartilhamento de tela sem som",
  // mesmo com a captura de áudio funcionando perfeitamente do lado de
  // quem compartilha. Este Map (paralelo a screenSendersRef acima) guarda
  // o RTCRtpSender de ÁUDIO da transmissão por peer, pra createPeerConnection
  // saber que precisa adicionar essa track também pra gente nova, e pra
  // switchScreenShareSource/toggleScreenShare conseguirem reaproveitar o
  // mesmo sender ao trocar de fonte sem precisar reconstruir do zero.
  const audioSendersRef = useRef<Map<string, RTCRtpSender>>(new Map())
  const foregroundWatchUnsubRef = useRef<(() => void) | null>(null)
  // Track "cortina" — um frame preto único (via canvas.captureStream),
  // criada sob demanda e reaproveitada enquanto durar o compartilhamento
  // atual. Só existe enquanto o vigia de foco estiver ativo.
  const placeholderTrackRef = useRef<MediaStreamTrack | null>(null)
  const realScreenVideoTrackRef = useRef<MediaStreamTrack | null>(null)
  // Captura de áudio por processo (EXPERIMENTAL, só Windows) — ver
  // pendingAppAudioCapture.ts, pcmStreamPlayer.ts e o bloco grande em
  // electron/main.cjs ("Captura de áudio por processo"). `appAudioPlayerRef`
  // é o tocador que transforma os pedaços de PCM crus (vindos do .exe via
  // IPC) numa MediaStreamTrack de verdade; `appAudioTrackRef` guarda ESSA
  // track pra saber qual sender remover de cada peer quando a
  // transmissão para ou troca de fonte (ela não faz parte de
  // screenStreamRef.current, que é só o que getDisplayMedia devolveu —
  // por isso não seria pega pelo laço normal de limpeza em
  // stopScreenShareState).
  const appAudioPlayerRef = useRef<PcmStreamPlayer | null>(null)
  const appAudioTrackRef = useRef<MediaStreamTrack | null>(null)
  const appAudioUnsubsRef = useRef<Array<() => void>>([])
  // QUINTA RODADA — ver comentário grande em ipcMain.handle('screen-share:select', ...)
  // em electron/main.cjs: o áudio de sistema (loopback) não vem mais
  // junto com o stream de vídeo do getDisplayMedia — agora é pedido à
  // parte (ver captureSystemAudioTrack abaixo), então também precisa da
  // própria referência pra limpeza em stopScreenShareState, do mesmo
  // jeito que appAudioTrackRef já fazia pro áudio por processo.
  const systemAudioTrackRef = useRef<MediaStreamTrack | null>(null)

  function stopAppAudioCapture() {
    appAudioUnsubsRef.current.forEach((unsub) => unsub())
    appAudioUnsubsRef.current = []
    window.electronAPI?.stopProcessAudioCapture?.().catch(() => {})
    appAudioPlayerRef.current?.close()
    appAudioPlayerRef.current = null
  }

  // Pede pro processo principal iniciar a captura nativa (ver
  // process-audio-capture.exe) do PID escolhido e liga o resultado (via
  // IPC — format + pedaços de PCM) num PcmStreamPlayer, devolvendo a
  // track de áudio já pronta pra entrar num RTCPeerConnection igual
  // qualquer outra. `null` em qualquer falha (fora do Windows, .exe
  // ausente, PID não existe mais, etc.) — quem chama trata isso como
  // "sem áudio nessa transmissão", sem quebrar o vídeo.
  //
  // DÉCIMA RODADA — bug real achado revendo com calma: `startProcessAudioCapture`
  // (IPC) só confirma que o processo `process-audio-capture.exe` foi
  // CRIADO com sucesso (spawn síncrono) — não que ele conseguiu de fato
  // ativar a captura (ActivateAudioInterfaceAsync, ver capture.cpp). Esse
  // .exe faz seu trabalho de verdade de forma ASSÍNCRONA por dentro: se o
  // PID já não existir mais, se o Windows for anterior ao build 20348, ou
  // se a ativação falhar por qualquer outro motivo, ele só reporta isso
  // BEM depois (evento `process-audio:error`), tempo depois de já termos
  // devolvido `player.stream.getAudioTracks()[0]` pra quem chamou. E
  // `MediaStreamAudioDestinationNode.stream` (ver PcmStreamPlayer) SEMPRE
  // tem uma track de áudio válida e "ativa" desde a criação, mesmo sem
  // nenhum áudio de verdade tendo chegado ainda — então o código anterior
  // devolvia uma track que PARECIA boa, era adicionada normalmente na
  // RTCPeerConnection, e ficava tocando SILÊNCIO PURO pelo resto da
  // transmissão inteira, porque `toggleScreenShare`/`switchScreenShareSource`
  // só caem pro áudio de sistema (ver captureSystemAudioTrack) quando
  // `audioTrack` volta `null` — o que nunca acontecia aqui, mesmo com a
  // captura nativa tendo falhado de verdade. Do lado de quem assiste,
  // isso é EXATAMENTE "compartilhamento de janela sem som": um sender de
  // áudio conectado e "funcionando", só que mudo.
  //
  // A correção: espera de verdade por uma confirmação de que áudio está
  // fluindo (o evento `onProcessAudioFormat`, mandado pelo .exe só DEPOIS
  // que a ativação e o formato foram resolvidos com sucesso) ou por um
  // erro explícito (`onProcessAudioError`) — o que vier primeiro — com um
  // prazo (APP_AUDIO_CONFIRM_TIMEOUT_MS) pro caso raro de nenhum dos dois
  // chegar. Só devolve a track quando a confirmação de verdade chegou;
  // em qualquer outro caso, encerra a captura nativa (stopAppAudioCapture)
  // e devolve `null` — deixando quem chama cair pro áudio de sistema,
  // como já era a intenção original.
  async function startAppAudioCapture(pid: number): Promise<MediaStreamTrack | null> {
    logDebug(`startAppAudioCapture: iniciando pra pid=${pid}`)
    if (!window.electronAPI?.startProcessAudioCapture) {
      logDebug('startAppAudioCapture: window.electronAPI.startProcessAudioCapture não existe (fora do Electron?)')
      return null
    }
    try {
      const result = await window.electronAPI.startProcessAudioCapture(pid)
      if (!result?.ok) {
        logDebug(`startAppAudioCapture: IPC voltou ok=false — ${result?.error ?? '(sem mensagem)'}`)
        setError(
          result?.error
            ? `Captura de áudio só deste app falhou: ${result.error}`
            : 'Não foi possível capturar o áudio só deste app.'
        )
        return null
      }
      logDebug('startAppAudioCapture: IPC voltou ok=true, esperando confirmação (format/error)...')
    } catch (err) {
      logDebug(`startAppAudioCapture: IPC startProcessAudioCapture lançou exceção — ${String(err)}`)
      setError('Não foi possível capturar o áudio só deste app.')
      return null
    }
    const player = new PcmStreamPlayer()
    appAudioPlayerRef.current = player
    let confirmedOnce = false
    const confirmed = await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      const unsubFormat = window.electronAPI!.onProcessAudioFormat((format) => {
        logDebug(`startAppAudioCapture: process-audio:format recebido — ${JSON.stringify(format)}`)
        player.setFormat(format)
        // Chegou um formato de verdade — a captura nativa está mesmo
        // funcionando. Continua escutando pra tocar os pedaços de PCM
        // que vêm em seguida (ver unsubChunk), mas já não precisa mais
        // esperar pra decidir se a track é utilizável.
        confirmedOnce = true
        finish(true)
      })
      const unsubChunk = window.electronAPI!.onProcessAudioChunk((chunk) => player.push(chunk))
      const unsubError = window.electronAPI!.onProcessAudioError((message) => {
        // ANTES disso, isso só ia pro console.error — invisível pra
        // qualquer pessoa rodando o app empacotado (o DevTools não abre
        // sozinho fora do modo de desenvolvimento). Sem aparecer em lugar
        // nenhum da tela, uma falha real da API nativa (ver capture.cpp)
        // parecia simplesmente "sem áudio, sem explicação". setError +
        // logDebug aqui é o que torna isso diagnosticável a distância.
        logDebug(`startAppAudioCapture: process-audio:error recebido — ${message}`)
        setError(`Captura de áudio só deste app falhou: ${message}`)
        // Ainda esperando a primeira confirmação (ver `confirmed` acima)
        // — trata como qualquer outra falha de partida, cai pro áudio de
        // sistema como já fazia.
        if (!confirmedOnce) {
          finish(false)
          return
        }
        // DÉCIMA RODADA: já tínhamos confirmado a captura (áudio estava
        // fluindo de verdade) e ela quebrou NO MEIO da transmissão — caso
        // mais comum: o jogo/app compartilhado foi fechado, e o .exe
        // reporta ERRO em vez de simplesmente ficar em silêncio (ver
        // capture.cpp). Sem tratar isso aqui, a transmissão continuaria
        // "com áudio" pro resto da call (o sender já existe, já foi
        // negociado), só que mudo pra sempre a partir desse ponto — de
        // novo, indistinguível de "sem som" pra quem está assistindo.
        // Troca automaticamente pro áudio de sistema em vez de deixar
        // silencioso — melhor um áudio menos isolado do que nenhum.
        const deadTrack = player.stream.getAudioTracks()[0] ?? null
        if (deadTrack) void recoverScreenShareAudioToSystem(deadTrack)
      })
      appAudioUnsubsRef.current = [unsubFormat, unsubChunk, unsubError]
      // Em condições normais a ativação é quase instantânea (o próprio
      // capture.cpp documenta "menos de 100ms") — este prazo só cobre o
      // caso raro de nem o formato nem o erro chegarem (processo travado,
      // IPC perdido) pra nunca deixar a pessoa esperando pra sempre antes
      // de cair pro áudio de sistema.
      setTimeout(() => {
        if (!settled) {
          // DÉCIMA QUARTA RODADA: esse é o único caso da função inteira
          // que NÃO tinha setError nem console.error nenhum — nem o
          // formato nem o erro chegaram a tempo, o que antes virava só
          // silêncio total sem pista nenhuma.
          logDebug(
            `startAppAudioCapture: nem process-audio:format nem process-audio:error chegaram em ${APP_AUDIO_CONFIRM_TIMEOUT_MS}ms (pid ${pid}) — caindo pro áudio de sistema.`
          )
        }
        finish(false)
      }, APP_AUDIO_CONFIRM_TIMEOUT_MS)
    })
    if (!confirmed) {
      stopAppAudioCapture()
      return null
    }
    return player.stream.getAudioTracks()[0] ?? null
  }

  // QUINTA RODADA de correção do compartilhamento de tela (ver o comentário
  // grande em ipcMain.handle('screen-share:select', ...) em
  // electron/main.cjs pro histórico completo): captura o áudio de TODO o
  // sistema numa chamada SEPARADA de getUserMedia — em vez de pedir junto
  // com o vídeo dentro de getDisplayMedia(), como era antes. O motivo é
  // que getDisplayMedia() trata vídeo+áudio como um pacote só: se o áudio
  // falhar por qualquer razão (aconteceu repetidas vezes com
  // "Invalid capture constraints (AbortError)", possivelmente um jogo
  // competitivo com anti-cheat bloqueando a captura de áudio do sistema
  // enquanto está rodando — é só um suspeito, não confirmado, mas é o
  // tipo de coisa que só interfere com ÁUDIO, não com captura de tela),
  // a Promise INTEIRA rejeitava e a pessoa perdia o vídeo TAMBÉM, mesmo
  // ele nunca tendo sido o problema.
  //
  // "chromeMediaSource: 'desktop'" é o jeito mais antigo (de antes do
  // setDisplayMediaRequestHandler existir) de pedir áudio de sistema no
  // Electron — funciona sozinho, sem precisar escolher uma janela/tela
  // específica primeiro, exatamente por isso serve bem aqui: pega só o
  // ÁUDIO, à parte do vídeo já resolvido separadamente.
  //
  // De propósito, NÃO misturo isso com SCREEN_SHARE_AUDIO_CONSTRAINTS
  // (echoCancellation/noiseSuppression/autoGainControl/channelCount) —
  // "mandatory" é sintaxe ANTIGA e essas são propriedades MODERNAS de
  // MediaTrackConstraints; misturar os dois estilos no mesmo objeto de
  // constraint é candidato relevante pra causa original de "Invalid
  // capture constraints" (era exatamente esse tipo de mistura old+novo
  // que rolava antes, só que do lado do vídeo). Fica mais simples e mais
  // confiável assim, ao custo de perder esse ajuste fino de qualidade
  // (cancelamento de eco etc.) só nesse áudio de sistema — a captura por
  // processo, quando dá certo, não tem essa limitação (é PCM cru, sem
  // passar pelas constraints do navegador).
  //
  // `null` em qualquer falha — quem chama trata como "sem áudio de
  // sistema dessa vez", sem derrubar o vídeo.
  async function captureSystemAudioTrack(): Promise<MediaStreamTrack | null> {
    try {
      const constraints = {
        video: false,
        audio: {
          mandatory: { chromeMediaSource: 'desktop' },
        },
        // A API padrão de MediaTrackConstraints do TypeScript não conhece
        // a propriedade "mandatory" (é específica do Electron/Chromium,
        // de antes da era getDisplayMedia) — daí o "as unknown as ...".
      } as unknown as MediaStreamConstraints
      const audioStream = await navigator.mediaDevices.getUserMedia(constraints)
      const track = audioStream.getAudioTracks()[0] ?? null
      // NONA RODADA: agora que confirmei (testando de verdade, ver
      // captureScreenShareStream acima) que misturar sintaxe antiga com
      // propriedades modernas não é mais suspeito de causar "Invalid
      // capture constraints" (o erro persistiu idêntico mesmo depois de
      // eliminar completamente essa mistura, então essa não era a causa
      // real), dá pra recuperar o ajuste fino de qualidade nesse áudio de
      // sistema com segurança — desde que seja feito DEPOIS, com
      // applyConstraints numa track já ativa (mesmo padrão *seguro* de
      // applyVideoQualityConstraints acima: nunca arrisca a captura em
      // si, só ajusta o que já está funcionando). echoCancellation/
      // noiseSuppression/autoGainControl desligados porque são pensados
      // pra voz de microfone — em áudio de jogo/sistema eles só
      // distorcem a mixagem original à toa.
      if (track) {
        void track
          .applyConstraints({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 48000 },
          })
          .catch(() => {
            // Sem problema — segue com o áudio de sistema do jeito que
            // veio, sem esse ajuste fino extra.
          })
      }
      return track
    } catch (err) {
      // DÉCIMA QUARTA RODADA: só engolir o erro aqui (sem log nenhum)
      // deixava "áudio de sistema falhou" completamente invisível — pior
      // ainda quando é a ÚLTIMA linha de defesa (depois da captura por
      // processo já ter falhado antes) e o resultado final vira
      // silêncio total sem NENHUMA pista em lugar nenhum. Logar aqui
      // (arquivo + DevTools, ver logDebug acima) é o que torna esse tipo
      // de falha diagnosticável à distância.
      const name = err instanceof Error ? err.name : null
      const detail = err instanceof Error ? err.message : String(err)
      logDebug(`captureSystemAudioTrack falhou: ${detail}${name ? ` (${name})` : ''}`)
      return null
    }
  }

  // DÉCIMA RODADA: chamada de dentro de startAppAudioCapture (ver o
  // comentário grande lá) quando a captura de áudio por processo já
  // tinha sido confirmada funcionando, mas quebrou NO MEIO da
  // transmissão (caso mais comum: a pessoa fechou o jogo/app que estava
  // compartilhando, mas continuou compartilhando a janela/tela — ex:
  // olhando o desktop — sem parar o compartilhamento). Sem isso, o
  // sender de áudio já negociado com cada peer ficaria mudo pro resto da
  // call inteira, mesmo com a transmissão de vídeo continuando normal.
  // Troca automaticamente pro áudio de sistema (menos isolado, mas
  // continua sendo áudio de verdade) em vez de deixar em silêncio.
  async function recoverScreenShareAudioToSystem(deadTrack: MediaStreamTrack) {
    // Duas checagens de segurança: (1) a transmissão pode já ter sido
    // encerrada entre o erro chegar e este `await` seguinte rodar — não
    // faz sentido "recuperar" áudio de uma call que já acabou; (2)
    // `appAudioTrackRef.current` pode já ter mudado (ex: a pessoa trocou
    // de fonte via switchScreenShareSource logo antes deste erro chegar)
    // — só mexe se a track morta ainda for a mesma que está ativa agora,
    // senão estaríamos derrubando uma captura NOVA por engano.
    // Usa screenStreamRef.current (ref, sempre atual) em vez do estado
    // `screenSharing` de propósito: esta função é chamada de dentro de um
    // callback de IPC registrado bem antes (dentro de startAppAudioCapture,
    // chamado lá no início de toggleScreenShare/switchScreenShareSource) —
    // `screenSharing` capturado nesse fechamento reflete o valor de QUANDO
    // a função foi criada (quase sempre `false`, já que a transmissão só
    // vira `true` no fim daquela mesma chamada), não o valor atual.
    if (!screenStreamRef.current || appAudioTrackRef.current !== deadTrack) return
    stopAppAudioCapture()
    appAudioTrackRef.current = null
    const systemAudioTrack = await captureSystemAudioTrack()
    if (!screenStreamRef.current) {
      // A transmissão terminou enquanto capturávamos o áudio de sistema
      // acima — descarta e não mexe em mais nada.
      systemAudioTrack?.stop()
      return
    }
    if (!systemAudioTrack) {
      setError(
        'A captura de áudio só deste app parou (o jogo/app foi fechado?) e não consegui recuperar com áudio de sistema — a transmissão continua sem som (o vídeo continua normal).'
      )
      screenAudioTrackIdRef.current = null
      screenAudioOutputTrackRef.current = null
      screenAudioSourceStreamRef.current = null
      teardownScreenAudioDenoiser()
      audioSendersRef.current.forEach((sender) => {
        sender.replaceTrack(null).catch(() => {})
      })
      // DÉCIMA SÉTIMA RODADA: avisa a sala que a transmissão ficou sem
      // áudio agora — sem isso, quem já tinha recebido um screenAudioStreamId
      // anterior ficaria com o mapeamento antigo (apontando pra uma
      // stream que não existe mais), em vez de simplesmente não ter
      // áudio nenhum.
      if (screenStreamRef.current) broadcastScreenMeta(screenStreamRef.current.id, null)
      return
    }
    systemAudioTrackRef.current = systemAudioTrack
    // DÉCIMA SÉTIMA RODADA: idem toggleScreenShare/switchScreenShareSource
    // — passa a track de recuperação pelo mesmo redutor de ruído da
    // transmissão antes de mandar pros peers, e reanuncia o novo
    // screenAudioStreamId (mudou — é uma MediaStream nova) pra sala,
    // senão quem já estava assistindo ficaria com o mapeamento antigo
    // (da fonte de áudio que acabou de morrer) e o áudio recuperado
    // cairia de novo como se fosse webcam.
    const prepared = await prepareScreenAudioForSending(systemAudioTrack)
    screenAudioTrackIdRef.current = prepared.track.id
    screenAudioOutputTrackRef.current = prepared.track
    screenAudioSourceStreamRef.current = prepared.stream
    audioSendersRef.current.forEach((sender) => {
      sender.replaceTrack(prepared.track).catch(() => {})
    })
    if (screenStreamRef.current) broadcastScreenMeta(screenStreamRef.current.id, prepared.stream.id)
    setError(
      'A captura de áudio só deste app parou (o jogo/app foi fechado?) — a transmissão passou a usar o áudio de todo o sistema automaticamente.'
    )
  }

  // Desenha uma "cortina" simples (fundo escuro + aviso) e devolve uma
  // track de vídeo estática feita a partir disso — usada como substituta
  // temporária da tela real enquanto a pessoa está fora do jogo (alt-tab),
  // pra não vazar o resto da tela pra quem está assistindo.
  function createPlaceholderVideoTrack(): MediaStreamTrack {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#18181b'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#8b8b8f'
      ctx.font = 'bold 36px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Transmissão pausada', canvas.width / 2, canvas.height / 2 - 20)
      ctx.font = '22px sans-serif'
      ctx.fillText('(fora do jogo no momento)', canvas.width / 2, canvas.height / 2 + 24)
    }
    // fps 0 = só manda esse frame único, sem ficar redesenhando à toa
    const [track] = canvas.captureStream(0).getVideoTracks()
    return track
  }

  function ensureAudioContext() {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext()
    return audioContextRef.current
  }

  function setupAnalyser(key: string, stream: MediaStream) {
    if (stream.getAudioTracks().length === 0) return
    try {
      const ctx = ensureAudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analysersRef.current.set(key, analyser)
    } catch {
      // getUserMedia/AudioContext podem falhar em navegadores sem suporte — degrada graciosamente
    }
  }

  // Aplica o RNNoise (se a pessoa tiver a redução de ruído ligada nas
  // configurações) na track BRUTA recém-capturada, devolvendo a track
  // tratada pra usar no lugar dela daqui pra frente (nível do medidor,
  // envio pros outros da call). Guarda a bruta em `rawMicTrackRef` só
  // pra dar `.stop()` nela depois (ver comentário na declaração do ref).
  //
  // Se a pessoa tiver a redução desligada, ou se o navegador não
  // suportar AudioWorklet/o WASM falhar ao carregar por algum motivo,
  // devolve a própria track bruta sem processamento extra — a call
  // nunca deve quebrar por causa disso, só perde o reforço.
  // `overrides` existe pelo mesmo motivo do `overrides` em
  // getAudioConstraints (ver comentário em refreshAudioConstraints logo
  // abaixo): quando essa função é chamada bem na hora de ligar/desligar
  // o toggle (ou arrastar o slider de sensibilidade), os valores em
  // `audioSettingsRef.current` ainda podem estar com o valor de ANTES do
  // clique (o React ainda não terminou de atualizar o ref nesse mesmo
  // tick) — sem passar o valor novo explicitamente, a mudança no meio de
  // uma call não fazia efeito nenhum até a próxima troca de microfone.
  async function applyNoiseSuppression(
    rawTrack: MediaStreamTrack,
    overrides?: { noiseSuppression?: boolean; micSensitivity?: number; micSensitivityMode?: 'auto' | 'manual' }
  ): Promise<MediaStreamTrack> {
    const oldRaw = rawMicTrackRef.current
    if (oldRaw && oldRaw !== rawTrack) oldRaw.stop()
    rawMicTrackRef.current = rawTrack

    const noiseSuppressionEnabled = overrides?.noiseSuppression ?? audioSettingsRef.current.noiseSuppression
    if (!noiseSuppressionEnabled) {
      noiseSuppressorRef.current?.destroy()
      noiseSuppressorRef.current = null
      resetAutoSensitivity()
      return rawTrack
    }

    const mode = overrides?.micSensitivityMode ?? audioSettingsRef.current.micSensitivityMode
    // No modo automático começa com o gate totalmente aberto (null) —
    // o useEffect "Sensibilidade automática do microfone" mede o ruído
    // ambiente e calcula o limiar certo sozinho poucos instantes depois
    // (ver esse useEffect mais abaixo). Usar o valor manual como palpite
    // inicial não faria sentido, já que o objetivo do modo automático é
    // exatamente não depender desse número.
    const sensitivity = mode === 'auto' ? null : overrides?.micSensitivity ?? audioSettingsRef.current.micSensitivity

    try {
      const isNewSuppressor = !noiseSuppressorRef.current
      if (!noiseSuppressorRef.current) {
        noiseSuppressorRef.current = await createNoiseSuppressor()
      }
      // Só reseta a estimativa de piso de ruído quando o worklet é
      // recriado do zero (troca de mic, por exemplo) — trocar entre
      // auto/manual ou ajustar constraints não deveria jogar fora um
      // aprendizado que já estava bom.
      if (isNewSuppressor) resetAutoSensitivity()
      return noiseSuppressorRef.current.setInputTrack(rawTrack, sensitivity)
    } catch (err) {
      console.error('[VoiceContext] Redutor de ruído (RNNoise) indisponível, seguindo sem ele:', err)
      noiseSuppressorRef.current = null
      return rawTrack
    }
  }

  // DÉCIMA SÉTIMA RODADA — equivalente de applyNoiseSuppression acima,
  // só que pro áudio da TRANSMISSÃO DE TELA em vez do microfone (ver
  // createScreenAudioDenoiser em lib/noiseSuppression.ts). Recebe a
  // track BRUTA (já resolvida por startAppAudioCapture ou
  // captureSystemAudioTrack) e devolve a versão filtrada — junto com
  // uma MediaStream própria pra ela (msid estável, sempre um objeto
  // NOVO por chamada, já que isso só roda uma vez por início/troca de
  // transmissão, nunca por frame). Se o WASM falhar por qualquer
  // motivo, cai pra bruta sem filtro — a transmissão nunca deve quebrar
  // por causa disso, só perde o reforço.
  async function prepareScreenAudioForSending(rawTrack: MediaStreamTrack): Promise<{ track: MediaStreamTrack; stream: MediaStream }> {
    // DÉCIMA NONA RODADA: opt-in agora (ver screenAudioNoiseSuppression
    // em useAudioSettings.ts) — desligado por padrão, porque o RNNoise
    // isola VOZ e trata qualquer som não-vocal do jogo (tiro, explosão,
    // música) como "ruído" a cortar. Sem a pessoa pedir explicitamente,
    // manda a track crua sem passar pelo denoiser.
    if (!audioSettingsRef.current.screenAudioNoiseSuppression) {
      teardownScreenAudioDenoiser()
      return { track: rawTrack, stream: new MediaStream([rawTrack]) }
    }
    try {
      screenAudioDenoiserRef.current?.destroy()
      screenAudioDenoiserRef.current = await createScreenAudioDenoiser()
      const processed = screenAudioDenoiserRef.current.setInputTrack(rawTrack)
      return { track: processed, stream: new MediaStream([processed]) }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      logDebug(`prepareScreenAudioForSending: redutor de ruído da transmissão indisponível, seguindo sem ele — ${detail}`)
      screenAudioDenoiserRef.current = null
      return { track: rawTrack, stream: new MediaStream([rawTrack]) }
    }
  }

  function teardownScreenAudioDenoiser() {
    screenAudioDenoiserRef.current?.destroy()
    screenAudioDenoiserRef.current = null
  }

  function sendSignal(to: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    const from = userIdRef.current
    if (!realtimeRef.current || !from) return
    realtimeRef.current.send({ type: 'broadcast', event: 'rtc', payload: { from, to, ...data } })
  }

  // Avisa todo mundo no canal (broadcast, não é dirigido a um peer
  // específico) qual é o stream.id da MINHA tela compartilhada agora —
  // ou null quando paro. É esse aviso explícito que os outros usam pra
  // saber, com certeza, qual das minhas streams é a tela.
  //
  // DÉCIMA QUINTA RODADA: agora também carrega o stream.id do ÁUDIO da
  // transmissão (screenAudioStreamId), quando tiver — ver o comentário
  // grande em screenAudioStreamIdsRef acima pro porquê disso ser
  // necessário (sem isso, o áudio nunca chegava marcado como "da tela"
  // do lado de quem recebe). `null` cobre tanto "ainda não resolvi o
  // áudio" (chamada inicial, só com o vídeo) quanto "essa transmissão não
  // tem áudio mesmo".
  function broadcastScreenMeta(screenStreamId: string | null, screenAudioStreamId: string | null = null) {
    const from = userIdRef.current
    if (!realtimeRef.current || !from) return
    realtimeRef.current.send({
      type: 'broadcast',
      event: 'screen-meta',
      payload: { from, screenStreamId, screenAudioStreamId },
    })
  }

  // Toca um efeito do soundboard localmente — igual o Discord, o áudio
  // é reproduzido direto pelo alto-falante de cada um (não é misturado
  // no microfone/WebRTC). Usa o volume PRÓPRIO do soundboard
  // (soundboardVolume), não o volume geral da call — cada pessoa que
  // ESCUTA controla o quanto os efeitos tocam pra ela, sem depender de
  // quem enviou o som.
  function playLocalSoundboardAudio(url: string) {
    try {
      const audio = new Audio(url)
      audio.volume = soundboardVolume / 100
      audio.play().catch(() => {
        // navegador pode bloquear play() sem interação recente — sem
        // problema, quem clicou no botão do som É a interação
      })
    } catch {
      // fonte de áudio inválida/indisponível — não deveria travar a call
    }
  }

  // Toca o som pra MIM (na hora) e avisa todo mundo mais no canal de voz
  // pra tocarem a mesma URL aí também — cada um busca e reproduz
  // localmente, em vez de misturar no stream de voz (senão quem está
  // ouvindo o eco do RNNoise/gate ouviria o som distorcido/cortado).
  function playSoundboardSound(url: string) {
    playLocalSoundboardAudio(url)
    const from = userIdRef.current
    if (realtimeRef.current && from) {
      realtimeRef.current.send({ type: 'broadcast', event: 'soundboard-play', payload: { from, url } })
    }
  }

  // DÉCIMA QUINTA RODADA — combina a stream de VÍDEO da tela com a stream
  // de ÁUDIO da tela (duas MediaStreams distintas do lado de quem
  // compartilha — ver screenAudioSourceStreamRef) numa única MediaStream
  // pronta pra UI tocar (<video>/<audio> só entendem uma stream por vez
  // pra exibir os dois juntos com controle de volume). Memoiza por peer
  // (videoTrackId/audioTrackId) pra não recriar a MediaStream — e com
  // ela, reiniciar o elemento <video> que depende da identidade do
  // objeto — toda vez que `recomputeParticipant` roda de novo (ex.: cada
  // `ontrack`) sem a track de vídeo ou de áudio ter mudado de verdade.
  // Quando só uma das duas existir (o caso mais comum: uma track chega
  // antes da outra), usa a própria stream original em vez de criar uma
  // combinada só com uma track — assim que a outra chegar, essa função
  // roda de novo e monta a combinada de verdade.
  function combineScreenStream(peerId: string, videoStream: MediaStream | null, audioStream: MediaStream | null): MediaStream {
    const videoTrack = videoStream?.getVideoTracks()[0] ?? null
    const audioTrack = audioStream?.getAudioTracks()[0] ?? null
    const videoTrackId = videoTrack?.id ?? null
    const audioTrackId = audioTrack?.id ?? null
    const cached = combinedScreenStreamsRef.current.get(peerId)
    if (cached && cached.videoTrackId === videoTrackId && cached.audioTrackId === audioTrackId) {
      return cached.stream
    }
    const combined = videoTrack && audioTrack ? new MediaStream([videoTrack, audioTrack]) : (videoStream ?? audioStream)!
    combinedScreenStreamsRef.current.set(peerId, { stream: combined, videoTrackId, audioTrackId })
    return combined
  }

  // Recalcula cameraStream/screenStream de um peer a partir de TODAS as
  // streams já recebidas dele + o mapeamento de qual stream.id é tela
  // (vindo do broadcast). Funciona não importa a ordem de chegada.
  //
  // DÉCIMA QUINTA RODADA: agora também reconhece a stream de ÁUDIO da
  // tela (screenAudioId, vindo do mesmo broadcast — ver
  // screenAudioStreamIdsRef acima) e a combina com a de vídeo em vez de
  // deixá-la cair no `else if (!cameraStream)` de baixo, onde virava
  // (errado) uma suposta stream de webcam.
  function recomputeParticipant(peerId: string) {
    const streams = rawStreamsRef.current.get(peerId)
    if (!streams || streams.size === 0) return
    const screenId = screenStreamIdsRef.current.get(peerId)
    const screenAudioId = screenAudioStreamIdsRef.current.get(peerId)
    let cameraStream: MediaStream | null = null
    let screenVideoStream: MediaStream | null = null
    let screenAudioStream: MediaStream | null = null
    streams.forEach((s, id) => {
      if (screenId && id === screenId) screenVideoStream = s
      else if (screenAudioId && id === screenAudioId) screenAudioStream = s
      else if (!cameraStream) cameraStream = s
    })
    const screenStream = screenVideoStream || screenAudioStream ? combineScreenStream(peerId, screenVideoStream, screenAudioStream) : null
    setParticipants((prev) => ({
      ...prev,
      [peerId]: {
        userId: peerId,
        speaking: prev[peerId]?.speaking ?? false,
        cameraStream,
        screenStream,
      },
    }))
  }

  // Gera a oferta/resposta (offer/answer) igual o `pc.setLocalDescription()`
  // "implícito" (sem argumento) fazia antes — só que passando pelo meio
  // do caminho pra poder editar o SDP primeiro (forçar estéreo no áudio
  // da transmissão de tela, se houver uma rolando — ver sdpStereo.ts).
  // `kind` diz qual dos dois criar: 'offer' quando SOMOS quem está
  // iniciando a renegociação (onnegotiationneeded), 'answer' quando
  // estamos respondendo a uma oferta que acabamos de receber
  // (handleSignal). O `pc.setLocalDescription()` sem argumento decide
  // isso sozinho só olhando o estado atual — aqui precisamos decidir na
  // mão porque geramos a descrição explicitamente ANTES de aplicar.
  async function setLocalDescriptionPreferringStereo(pc: RTCPeerConnection, kind: 'offer' | 'answer') {
    const description = kind === 'offer' ? await pc.createOffer() : await pc.createAnswer()
    if (description.sdp && screenAudioTrackIdRef.current) {
      description.sdp = preferStereoOpusForTrack(description.sdp, screenAudioTrackIdRef.current)
    }
    await pc.setLocalDescription(description)
  }

  function createPeerConnection(peerId: string, polite: boolean): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      // Pré-coleta candidatos de conexão ANTES de precisar deles — sem
      // isso, a busca só começa quando a chamada realmente começa a
      // negociar, o que atrasa o tempo até a call conectar (não é a
      // mesma coisa que a latência durante a conversa, mas melhora o
      // "demora pra pegar" que você comentou antes).
      iceCandidatePoolSize: 4,
    })
    const peerState: PeerState = { pc, makingOffer: false, polite }
    peersRef.current.set(peerId, peerState)

    localStreamRef.current?.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, localStreamRef.current!)
      if (track.kind === 'audio') {
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        // O padrão do Opus fica bem baixo (~32kbps) — subindo pro teto
        // real de voz mono (ver MIC_MAX_BITRATE acima), a voz fica bem
        // mais nítida, por um custo de banda irrelevante (poucos KB/s a
        // mais).
        params.encodings[0].maxBitrate = MIC_MAX_BITRATE
        // Marca o áudio como prioridade alta — quando a rede está
        // congestionada (upload cheio, por exemplo), isso pede pro
        // navegador tratar os pacotes de voz como mais urgentes do
        // que outros tipos de tráfego (imagem/vídeo, por exemplo).
        if ('priority' in params.encodings[0]) {
          ;(params.encodings[0] as RTCRtpEncodingParameters & { priority?: string }).priority = 'high'
        }
        if ('networkPriority' in params.encodings[0]) {
          ;(params.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = 'high'
        }
        sender.setParameters(params).catch(() => {})
      }
    })
    if (screenStreamRef.current) {
      // DÉCIMA SÉTIMA RODADA: usa getVideoTracks() aqui, não getTracks()
      // — no Linux, o seletor NATIVO do sistema pode embutir uma track
      // de ÁUDIO dentro do próprio screenStreamRef.current (ver o
      // comentário grande em toggleScreenShare, "DÉCIMA PRIMEIRA
      // RODADA"). Essa track de áudio agora SEMPRE passa pelo redutor de
      // ruído da transmissão antes de ser enviada (ver
      // prepareScreenAudioForSending) e SEMPRE é adicionada pelo bloco
      // de screenAudioOutputTrackRef logo abaixo — se este laço aqui
      // também mandasse a track crua embutida na stream, quem entrasse
      // na call DEPOIS do compartilhamento já ter começado receberia
      // ÁUDIO DUPLICADO (a crua E a filtrada, ao mesmo tempo) nesse
      // caso específico do Linux.
      screenStreamRef.current.getVideoTracks().forEach((track) => {
        const sender = pc.addTrack(track, screenStreamRef.current!)
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        // Antes isso usava um valor fixo (4Mbps) sem olhar a preferência
        // de qualidade escolhida — então quem entrava na call DEPOIS que
        // a transmissão já tinha começado recebia uma versão bem pior
        // do que quem já estava lá antes, mesmo com "Qualidade máxima"
        // selecionada. Usando a mesma referência que o início da
        // transmissão usa, todo mundo recebe a qualidade certa.
        const preset = screenShareQualityRef.current
        params.encodings[0].maxBitrate = preset.maxBitrate
        ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
          preset.degradationPreference
        sender.setParameters(params).catch(() => {})
        screenSendersRef.current.set(peerId, sender)
        // Se a pessoa já entrou no meio de um período "fora do jogo"
        // (cortina ativa), essa nova conexão já começa recebendo a
        // cortina, não o vídeo de verdade — senão vazaria justo pra
        // quem acabou de entrar.
        if (placeholderTrackRef.current) sender.replaceTrack(placeholderTrackRef.current).catch(() => {})
      })
    }
    // DÉCIMA RODADA: ver o comentário grande em audioSendersRef acima —
    // esta é a correção de verdade do bug. A track de ÁUDIO da
    // transmissão ativa (se tiver alguma tocando agora) não faz parte de
    // screenStreamRef.current, então precisa ser adicionada aqui à parte
    // pra quem está entrando na call agora, do mesmo jeito que
    // toggleScreenShare/switchScreenShareSource já fazem pra quem já
    // estava na call no momento em que a transmissão começou/trocou.
    // DÉCIMA SÉTIMA RODADA: usa screenAudioOutputTrackRef — a track que
    // REALMENTE está sendo enviada agora (já passou pelo redutor de
    // ruído da transmissão, quando ele funcionou — ver
    // prepareScreenAudioForSending) — em vez de
    // `appAudioTrackRef.current ?? systemAudioTrackRef.current`, que
    // agora guardam só a captura BRUTA (antes do filtro). Usar a bruta
    // aqui mandaria áudio sem filtro só pra quem entra DEPOIS da
    // transmissão já ter começado — inconsistente com quem já estava na
    // call.
    const activeScreenAudioTrack = screenAudioOutputTrackRef.current
    if (activeScreenAudioTrack && activeScreenAudioTrack.readyState !== 'ended') {
      // DÉCIMA QUINTA RODADA: usa screenAudioSourceStreamRef (a MESMA
      // MediaStream, com o MESMO .id, que já foi anunciada via
      // broadcastScreenMeta pra sala toda) em vez de construir uma
      // `new MediaStream([...])` aqui — que antes gerava um .id
      // DIFERENTE a cada peer que entrasse depois da transmissão já
      // rolando, e o broadcast (um só, pra sala toda) só podia acertar
      // um deles. O fallback só existe pra nunca ficar sem enviar áudio
      // nenhum no caso (não deveria acontecer) dessa referência ainda
      // não estar setada.
      const audioSourceStream = screenAudioSourceStreamRef.current ?? new MediaStream([activeScreenAudioTrack])
      const audioSender = pc.addTrack(activeScreenAudioTrack, audioSourceStream)
      const audioParams = audioSender.getParameters()
      audioParams.encodings = audioParams.encodings?.length ? audioParams.encodings : [{}]
      audioParams.encodings[0].maxBitrate = SCREEN_SHARE_AUDIO_MAX_BITRATE
      audioSender.setParameters(audioParams).catch(() => {})
      audioSendersRef.current.set(peerId, audioSender)
    }

    pc.onnegotiationneeded = async () => {
      try {
        peerState.makingOffer = true
        await setLocalDescriptionPreferringStereo(pc, 'offer')
        if (pc.localDescription) sendSignal(peerId, { description: pc.localDescription })
      } catch (err) {
        console.error('Erro ao negociar conexão de voz:', err)
      } finally {
        peerState.makingOffer = false
      }
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal(peerId, { candidate: candidate.toJSON() })
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (!rawStreamsRef.current.has(peerId)) rawStreamsRef.current.set(peerId, new Map())
      rawStreamsRef.current.get(peerId)!.set(stream.id, stream)
      recomputeParticipant(peerId)
      if (!analysersRef.current.has(peerId)) setupAnalyser(peerId, stream)

      // Pede pro navegador priorizar latência baixa em vez de suavidade
      // contra oscilação de rede (jitter) — só pra áudio, já que voz é
      // mais sensível a atraso do que a pequenos engasgos ocasionais.
      // Isso não depende de nenhum servidor, é só uma configuração do
      // próprio navegador — funciona de graça, sem custo nenhum.
      if (event.track.kind === 'audio' && 'playoutDelayHint' in event.receiver) {
        try {
          ;(event.receiver as RTCRtpReceiver & { playoutDelayHint: number }).playoutDelayHint = 0
        } catch {
          // navegador sem suporte a esse ajuste — sem problema, só não aplica
        }
      }
    }

    return pc
  }

  function ensurePeer(peerId: string): boolean {
    if (peersRef.current.has(peerId) || !userIdRef.current) return false
    if (peersRef.current.size >= MAX_PARTICIPANTS - 1) return false
    createPeerConnection(peerId, userIdRef.current > peerId)
    return true
  }

  const handleSignal = useCallback(async (payload: SignalPayload) => {
    const myId = userIdRef.current
    if (!myId || payload.to !== myId) return

    const peerId = payload.from
    if (!peersRef.current.has(peerId)) createPeerConnection(peerId, myId > peerId)
    const peerState = peersRef.current.get(peerId)
    if (!peerState) return
    const { pc, polite } = peerState

    try {
      if (payload.description) {
        const offerCollision =
          payload.description.type === 'offer' && (peerState.makingOffer || pc.signalingState !== 'stable')
        if (!polite && offerCollision) return

        await pc.setRemoteDescription(payload.description)
        if (payload.description.type === 'offer') {
          await setLocalDescriptionPreferringStereo(pc, 'answer')
          if (pc.localDescription) sendSignal(peerId, { description: pc.localDescription })
        }
      } else if (payload.candidate) {
        try {
          await pc.addIceCandidate(payload.candidate)
        } catch (err) {
          if (!polite) throw err
        }
      }
    } catch (err) {
      console.error('Erro de sinalização WebRTC:', err)
    }
  }, [])

  function cleanupPeer(peerId: string) {
    peersRef.current.get(peerId)?.pc.close()
    peersRef.current.delete(peerId)
    analysersRef.current.delete(peerId)
    lastAboveThresholdRef.current.delete(peerId)
    rawStreamsRef.current.delete(peerId)
    screenStreamIdsRef.current.delete(peerId)
    screenAudioStreamIdsRef.current.delete(peerId)
    combinedScreenStreamsRef.current.delete(peerId)
    screenSendersRef.current.delete(peerId)
    audioSendersRef.current.delete(peerId)
    setParticipants((prev) => {
      if (!(peerId in prev)) return prev
      const next = { ...prev }
      delete next[peerId]
      return next
    })
  }

  const join = useCallback(async (channelId: string, serverId: string | null, options?: { displayName?: string; userLimit?: number }) => {
    if (!user || connectedRef.current) return
    // Ver o comentário grande em leaveTeardownRef — espera o
    // desligamento em segundo plano de uma saída recente terminar antes
    // de assinar o MESMO tópico Realtime de novo, senão o presence
    // 'sync' que volta pode vir incompleto.
    if (leaveTeardownRef.current) {
      await leaveTeardownRef.current
    }
    // Avisa a UI (a lista de canais) IMEDIATAMENTE que estamos prestes a
    // entrar nesse canal, antes de qualquer trabalho assíncrono (pedir
    // microfone, etc.) — isso dá tempo do observador de presença na
    // barra lateral (useVoicePresence) se desinscrever do mesmo canal
    // Realtime ANTES da gente tentar se inscrever de verdade nele.
    // Sem isso, a primeira tentativa de entrar sempre colidia com essa
    // inscrição de observação já existente.
    setJoiningChannelId(channelId)
    setConnecting(true)
    setError(null)
    hasSyncedRef.current = false
    channelUserLimitRef.current = 0
    joinedAtRef.current = Date.now()

    // Chamada em DM/grupo (serverId null) não tem linha na tabela
    // channels pra buscar — nome e limite vêm de `options` (o valor já
    // resolvido do lado de quem chamou join(), ex.: nome da outra
    // pessoa na DM ou nome do grupo).
    if (serverId) {
      const { data: channelRow } = await supabase.from('channels').select('user_limit, name').eq('id', channelId).single()
      channelUserLimitRef.current = channelRow?.user_limit ?? 0
      setConnectedChannelName(channelRow?.name ?? null)
    } else {
      channelUserLimitRef.current = options?.userLimit ?? 0
      setConnectedChannelName(options?.displayName ?? null)
    }

    try {
      const stream = await getUserMediaWithRetry({ audio: audioSettingsRef.current.getAudioConstraints() })
      const rawTrack = stream.getAudioTracks()[0]
      const processedTrack = await applyNoiseSuppression(rawTrack)
      if (processedTrack !== rawTrack) {
        stream.removeTrack(rawTrack)
        stream.addTrack(processedTrack)
      }
      localStreamRef.current = stream
      mutedRef.current = false
      applyMicEnabledState(false)
      setupAnalyser('local', stream)

      const rt = supabase.channel(`voice:${channelId}`, {
        config: { broadcast: { self: false }, presence: { key: user.id } },
      })
      realtimeRef.current = rt

      rt.on('broadcast', { event: 'rtc' }, ({ payload }) => handleSignal(payload as SignalPayload))

      rt.on('broadcast', { event: 'screen-meta' }, ({ payload }) => {
        const { from, screenStreamId, screenAudioStreamId } = payload as {
          from: string
          screenStreamId: string | null
          screenAudioStreamId?: string | null
        }
        if (screenStreamId) screenStreamIdsRef.current.set(from, screenStreamId)
        else screenStreamIdsRef.current.delete(from)
        if (screenAudioStreamId) screenAudioStreamIdsRef.current.set(from, screenAudioStreamId)
        else screenAudioStreamIdsRef.current.delete(from)
        recomputeParticipant(from)
      })

      // Alguém tocou um som do soundboard — toca a mesma URL aqui
      // também. `broadcast: { self: false }` (config do canal, logo
      // acima) já garante que quem tocou o som não recebe o próprio
      // broadcast de volta (evitaria tocar duas vezes pra quem clicou).
      rt.on('broadcast', { event: 'soundboard-play' }, ({ payload }) => {
        const { url } = payload as { from: string; url: string }
        playLocalSoundboardAudio(url)
      })

      rt.on('presence', { event: 'sync' }, () => {
        const state = rt.presenceState() as Record<string, Array<{ user_id?: string; joined_at?: number }>>
        const ids = Object.keys(state).filter((id) => id !== user.id)
        const isFirstSync = !hasSyncedRef.current

        // Limite de pessoas no canal — só checa na primeira sincronização
        // (a entrada em si), pra não expulsar quem já está dentro se o
        // limite for reduzido depois por um moderador.
        //
        // A contagem sozinha (`ids.length >= limite`) tinha uma corrida:
        // se só sobra 1 vaga e DUAS pessoas clicam "entrar" quase ao
        // mesmo tempo, as duas podem ver a mesma contagem (ainda sem o
        // presence uma da outra) e as duas entram, estourando o limite.
        // Em vez disso, cada cliente ordena TODO MUNDO (incluindo a si
        // mesmo) pelo horário que cada um mandou seu próprio `track()`
        // (`joined_at`) — como esse estado de presença é o mesmo pra
        // todo mundo na sala, todo cliente calcula a MESMA ordem e chega
        // na MESMA conclusão sobre quem ficou de fora, mesmo sem um
        // servidor "árbitro" pra decidir.
        if (isFirstSync && channelUserLimitRef.current > 0) {
          const everyone = [{ id: user.id, joinedAt: joinedAtRef.current }, ...ids.map((id) => {
            const entry = state[id]?.[0]
            return { id, joinedAt: entry?.joined_at ?? 0 }
          })]
          everyone.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
          const myPosition = everyone.findIndex((e) => e.id === user.id)
          if (myPosition >= channelUserLimitRef.current) {
            setError('Esse canal de voz já está cheio.')
            leave()
            return
          }
        }

        let hasNewPeer = false

        ids.forEach((id) => {
          const wasNew = ensurePeer(id)
          if (wasNew) {
            hasNewPeer = true
            if (!isFirstSync) playUserJoinSound()
          }
        })
        Array.from(peersRef.current.keys()).forEach((id) => {
          if (!ids.includes(id)) {
            cleanupPeer(id)
            if (!isFirstSync) playUserLeaveSound()
          }
        })
        hasSyncedRef.current = true

        // Quem chega depois de eu já estar compartilhando tela perdeu o
        // aviso original (broadcast não guarda histórico) — reenvia
        // sempre que alguém novo aparece na sala.
        if (hasNewPeer && screenStreamRef.current) {
          // DÉCIMA SEXTA RODADA — bug relatado: quem entra na call
          // enquanto alguém já está compartilhando tela não vê a
          // transmissão, a menos que a pessoa pare e comece de novo.
          // Esse broadcast aqui é a ÚNICA vez que a sala reenvia
          // screen-meta pra quem acabou de chegar (a mensagem original,
          // de quando a transmissão começou, não fica guardada em
          // lugar nenhum — broadcast não tem histórico). É
          // "fire-and-forget", sem confirmação de entrega: o Supabase
          // Realtime pode descartar uma mensagem de broadcast mandada
          // bem no instante em que alguém acabou de entrar no canal — o
          // socket do recém-chegado já aparece no presence (por isso
          // `hasNewPeer` fica true e a gente tenta mandar), mas o lado
          // de RECEBER broadcast desse mesmo socket pode ainda não
          // estar 100% pronto um instante depois da inscrição, e
          // nenhum erro chega até aqui pra avisar que isso aconteceu.
          // Reiniciar a transmissão sempre "conserta" porque manda um
          // broadcast novo bem mais tarde, quando a conexão já assentou
          // de sobra. Em vez de confiar numa mensagem só, reenvia mais
          // duas vezes nos segundos seguintes — não tem custo nenhum
          // reenviar (quem recebe só sobrescreve com o mesmo valor e
          // recalcula o participante de novo), e cobre a janela inteira
          // em que esse tipo de perda costuma acontecer.
          const resendScreenMeta = () => {
            if (!screenStreamRef.current) return
            broadcastScreenMeta(screenStreamRef.current.id, screenAudioSourceStreamRef.current?.id ?? null)
          }
          resendScreenMeta()
          window.setTimeout(resendScreenMeta, 1500)
          window.setTimeout(resendScreenMeta, 4000)
        }
      })

      await new Promise<void>((resolve, reject) => {
        rt.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await rt.track({ user_id: user.id, joined_at: joinedAtRef.current })
            resolve()
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reject(new Error('Falha ao conectar ao canal de voz'))
          }
        })
      })

      connectedRef.current = true
      setConnectedChannelId(channelId)
      setConnectedServerId(serverId)
      setConnectedAt(Date.now())
      playConnectSound()
    } catch (err) {
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permissão de microfone negada. Habilite o acesso ao microfone e tente de novo.'
          : 'Não foi possível entrar no canal de voz.'
      )
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      rawMicTrackRef.current?.stop()
      rawMicTrackRef.current = null
      noiseSuppressorRef.current?.destroy()
      noiseSuppressorRef.current = null
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    } finally {
      setConnecting(false)
      setJoiningChannelId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, handleSignal])

  const leave = useCallback(() => {
    const wasConnected = connectedRef.current
    peersRef.current.forEach((_, id) => cleanupPeer(id))
    peersRef.current.clear()
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    // A track dentro de localStreamRef pode ser a SAÍDA do RNNoise, não
    // o microfone físico em si — sem parar a track bruta separadamente
    // aqui, o dispositivo continuaria "preso" (luzinha do mic acesa)
    // mesmo depois de sair da call.
    rawMicTrackRef.current?.stop()
    rawMicTrackRef.current = null
    noiseSuppressorRef.current?.destroy()
    noiseSuppressorRef.current = null
    resetAutoSensitivity()
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    gameShareWatchRef.current?.()
    gameShareWatchRef.current = null
    setLocalScreenStream(null)
    analysersRef.current.clear()
    lastAboveThresholdRef.current.clear()
    if (realtimeRef.current) {
      const channelToLeave = realtimeRef.current
      // Ver o comentário grande em leaveTeardownRef acima — o
      // desligamento de verdade (dois round-trips até o servidor) roda
      // em segundo plano, sem atrasar nada do que a UI mostra aqui
      // embaixo (tudo isso continua síncrono); só uma reentrada rápida
      // no MESMO canal (join()) espera essa Promise terminar antes de
      // assinar o tópico de novo.
      const teardown = (async () => {
        try {
          await channelToLeave.untrack()
        } catch {
          // best-effort — segue pro removeChannel de qualquer jeito
        }
        try {
          await supabase.removeChannel(channelToLeave)
        } catch {
          // best-effort — pior caso, o canal fica orfão até o socket cair sozinho
        }
      })()
      leaveTeardownRef.current = teardown
      teardown.finally(() => {
        if (leaveTeardownRef.current === teardown) leaveTeardownRef.current = null
      })
      realtimeRef.current = null
    }
    setParticipants({})
    connectedRef.current = false
    setConnectedChannelId(null)
    setConnectedChannelName(null)
    setConnectedServerId(null)
    setConnectedAt(null)
    setConnecting(false)
    setMuted(false)
    // Se a pessoa saiu da call já "desativada" (deafened), o volume geral
    // ficou em 0 — sem isso aqui, a próxima call começaria sem áudio
    // nenhum sem nenhuma pista visual do porquê.
    if (deafenedRef.current) setMasterVolume(preDeafenVolumeRef.current)
    setDeafened(false)
    setVideoEnabled(false)
    setScreenSharing(false)
    setSpeaking(false)
    if (wasConnected) playDisconnectSound()
  }, [])

  // Só desconecta quando o Provider inteiro desmonta (ex: logout) —
  // NÃO reage a troca de canal/servidor visualizado, que é exatamente o
  // comportamento que corrige o bug de "sair da call ao trocar de tela".
  useEffect(() => {
    return () => {
      if (connectedRef.current) leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Latência real da chamada (não confundir com o ping do banco de
  // dados) — usa getStats() de cada conexão WebRTC ativa pra pegar o
  // tempo de ida-e-volta de verdade, peer a peer, a cada 5s.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!connectedRef.current || peersRef.current.size === 0) return
      const next: Record<string, number> = {}
      for (const [peerId, { pc }] of peersRef.current) {
        try {
          const stats = await pc.getStats()
          stats.forEach((report) => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
              next[peerId] = Math.round(report.currentRoundTripTime * 1000)
            }
          })
        } catch {
          // conexão pode ter caído nesse meio tempo — sem problema, só ignora
        }
      }
      setConnectionQuality(next)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // --- Sensibilidade automática do microfone --------------------------
  // Só faz alguma coisa quando o modo é 'auto' (ver useAudioSettings.ts
  // e o toggle em SettingsModal.tsx). A cada segundo, lê o nível de
  // áudio já tratado pelo RNNoise mas ainda ANTES do gate
  // (`sampleLevelDb()` — ver o comentário sobre esse ponto de leitura em
  // noiseSuppression.ts, escolhido de propósito pra não entrar num loop
  // onde um gate fechado faz o nível parecer silêncio total) e mantém
  // uma estimativa do "piso de ruído" da sala com uma média móvel
  // assimétrica: quando a leitura é MENOR que o piso atual, o piso desce
  // rápido (reconhece rápido um ambiente mais silencioso); quando é
  // MAIOR, o piso sobe bem devagar (fala normal — que é bem mais alta
  // que o ruído de fundo — não deveria "convencer" o piso de que o
  // ambiente ficou mais barulhento). O limiar do gate vira sempre
  // `piso + margem fixa de 12dB`, clampado num intervalo razoável.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!connectedRef.current) return
      if (audioSettingsRef.current.micSensitivityMode !== 'auto') return
      const suppressor = noiseSuppressorRef.current
      if (!suppressor) return
      const level = suppressor.sampleLevelDb()
      if (level === null) return

      const floor = noiseFloorDbRef.current
      if (floor === null) {
        noiseFloorDbRef.current = level
        return
      }
      noiseFloorDbRef.current = level < floor ? floor * 0.7 + level * 0.3 : floor * 0.98 + level * 0.02

      const AUTO_SENSITIVITY_MARGIN_DB = 12
      const threshold = Math.max(-80, Math.min(-20, noiseFloorDbRef.current + AUTO_SENSITIVITY_MARGIN_DB))

      // Só reaplica se mudou de verdade (>=1.5dB) — o gate é recriado a
      // cada chamada de setSensitivityDb, então reaplicar a cada segundo
      // por causa de flutuações mínimas geraria um "clique" audível toda
      // hora à toa.
      const last = lastAppliedThresholdDbRef.current
      if (last === null || Math.abs(threshold - last) >= 1.5) {
        lastAppliedThresholdDbRef.current = threshold
        suppressor.setSensitivityDb(threshold)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // --- Canal AFK: move automaticamente quem fica inativo -------------
  const afkConfigRef = useRef<{ channelId: string | null; timeoutMinutes: number } | null>(null)
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (!connectedServerId) {
      afkConfigRef.current = null
      return
    }
    supabase
      .from('servers')
      .select('afk_channel_id, afk_timeout_minutes')
      .eq('id', connectedServerId)
      .single()
      .then(({ data }) => {
        afkConfigRef.current = data
          ? { channelId: data.afk_channel_id, timeoutMinutes: data.afk_timeout_minutes }
          : null
      })
  }, [connectedServerId])

  useEffect(() => {
    function markActive() {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('mousemove', markActive)
    window.addEventListener('mousedown', markActive)
    window.addEventListener('keydown', markActive)
    return () => {
      window.removeEventListener('mousemove', markActive)
      window.removeEventListener('mousedown', markActive)
      window.removeEventListener('keydown', markActive)
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      const config = afkConfigRef.current
      if (!connectedRef.current || !config?.channelId || !connectedChannelId || !connectedServerId) return
      if (connectedChannelId === config.channelId) return // já está no canal AFK
      const idleMs = Date.now() - lastActivityRef.current
      if (idleMs >= config.timeoutMinutes * 60_000) {
        const afkChannelId = config.channelId
        const serverId = connectedServerId
        leave()
        setTimeout(() => join(afkChannelId, serverId), 300)
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [connectedChannelId, connectedServerId, leave, join])

  async function changeMicrophone(deviceId: string) {
    // "" representa "Padrão do sistema" no <select> — normaliza pra null
    // pra bater com o tipo que StoredSettings.micId realmente usa (ver
    // useAudioSettings.ts). getAudioConstraints já trata os dois como
    // "sem preferência de dispositivo" na prática, mas persistir null é
    // mais correto do que uma string vazia.
    audioSettingsRef.current.setMicId(deviceId || null)
    if (!connectedRef.current) return
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioSettingsRef.current.getAudioConstraints(deviceId),
      })
      const rawTrack = newStream.getAudioTracks()[0]
      const newTrack = await applyNoiseSuppression(rawTrack)
      newTrack.enabled = !muted

      const oldTrack = localStreamRef.current?.getAudioTracks()[0]
      if (oldTrack) {
        oldTrack.stop()
        localStreamRef.current?.removeTrack(oldTrack)
      }
      localStreamRef.current?.addTrack(newTrack)

      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
        sender?.replaceTrack(newTrack)
      })

      setupAnalyser('local', new MediaStream([newTrack]))
    } catch {
      setError('Não foi possível trocar de microfone.')
    }
  }

  // Reaplica as configurações de áudio atuais (cancelamento de eco,
  // redução de ruído, ganho automático) no microfone já conectado —
  // usado pelos botões de liga/desliga (ao lado do perfil e em
  // Configurações → Áudio), pra a mudança valer na call em andamento
  // sem precisar reconectar.
  //
  // `overrides` é opcional e existe só pra evitar uma corrida com o
  // React: quem chama essa função normalmente acabou de chamar
  // setNoiseSuppression/setEchoCancellation/setAutoGainControl um
  // instante antes, mas a atualização de estado é assíncrona — nesse
  // mesmo clique, `audioSettingsRef.current` ainda reflete o valor
  // ANTIGO (de antes do clique), porque o React só re-renderiza (e
  // atualiza o ref) depois. Sem passar o valor novo explicitamente
  // aqui, o toggle sempre aplicava a configuração de um clique atrás —
  // dava a impressão de que o redutor de ruído simplesmente não fazia
  // nada.
  async function refreshAudioConstraints(
    overrides?: Partial<
      Pick<
        ReturnType<typeof useAudioSettings>,
        'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'micSensitivity' | 'micSensitivityMode'
      >
    >
  ) {
    if (!connectedRef.current) return
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioSettingsRef.current.getAudioConstraints(undefined, overrides),
      })
      const rawTrack = newStream.getAudioTracks()[0]
      const newTrack = await applyNoiseSuppression(rawTrack, {
        noiseSuppression: overrides?.noiseSuppression,
        micSensitivity: overrides?.micSensitivity,
        micSensitivityMode: overrides?.micSensitivityMode,
      })
      newTrack.enabled = !muted

      const oldTrack = localStreamRef.current?.getAudioTracks()[0]
      if (oldTrack) {
        oldTrack.stop()
        localStreamRef.current?.removeTrack(oldTrack)
      }
      localStreamRef.current?.addTrack(newTrack)

      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
        sender?.replaceTrack(newTrack)
      })

      setupAnalyser('local', new MediaStream([newTrack]))
    } catch {
      // se falhar, o microfone atual continua funcionando com as configs antigas
    }
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    const newMuted = !muted
    mutedRef.current = newMuted
    setMuted(newMuted)
    applyMicEnabledState(pushToTalkActive)
    if (newMuted) playMuteSound()
    else playUnmuteSound()
  }

  async function toggleVideo() {
    if (videoEnabled) {
      const track = localStreamRef.current?.getVideoTracks()[0]
      if (track) {
        track.stop()
        localStreamRef.current?.removeTrack(track)
        peersRef.current.forEach(({ pc }) => {
          const sender = pc.getSenders().find((s) => s.track === track)
          if (sender) pc.removeTrack(sender)
        })
      }
      setVideoEnabled(false)
      return
    }
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
      const track = camStream.getVideoTracks()[0]
      localStreamRef.current?.addTrack(track)
      peersRef.current.forEach(({ pc }) => pc.addTrack(track, localStreamRef.current!))
      setVideoEnabled(true)
    } catch {
      setError('Não foi possível acessar a câmera.')
    }
  }

  // Some sozinho pros dois casos de fim de compartilhamento de tela: a
  // pessoa clicou pra parar, OU (novo, pro caso de tela cheia) o jogo que
  // estava sendo compartilhado foi fechado — ver o watch de
  // onGameStatusChanged logo abaixo em toggleScreenShare. Para as
  // tracks de verdade (vídeo E áudio) e tira elas dos peers antes de
  // limpar o estado — sem isso a captura continuaria rodando por baixo
  // (indicador do sistema aceso, peers ainda recebendo frames) mesmo com
  // a UI já mostrando "parou".
  function stopScreenShareState() {
    screenStreamRef.current?.getTracks().forEach((track) => {
      track.stop()
      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track === track)
        if (sender) pc.removeTrack(sender)
      })
    })
    gameShareWatchRef.current?.()
    gameShareWatchRef.current = null
    window.electronAPI?.stopWatchProcessExit?.().catch(() => {})
    // DÉCIMA SÉTIMA RODADA: a track REALMENTE enviada pros peers (senders
    // seguram essa, não mais a bruta — ver screenAudioOutputTrackRef, o
    // porquê está no comentário grande na declaração dele) é a que
    // precisa ser usada aqui pra achar e remover o sender certo — usar a
    // bruta (appAudioTrackRef/systemAudioTrackRef) não bateria com
    // `sender.track` desde que o redutor de ruído da transmissão passou
    // a existir, e o sender ficaria "esquecido" (nunca removido).
    if (screenAudioOutputTrackRef.current) {
      const outputTrack = screenAudioOutputTrackRef.current
      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track === outputTrack)
        if (sender) pc.removeTrack(sender)
      })
      screenAudioOutputTrackRef.current = null
    }
    teardownScreenAudioDenoiser()
    // A captura BRUTA (quando ativa) não faz parte de
    // screenStreamRef.current — vem de um MediaStream próprio dentro do
    // PcmStreamPlayer (ver startAppAudioCapture acima) — por isso
    // precisa ser encerrada aqui à parte (o sender que a carregava,
    // já filtrada, foi removido acima).
    appAudioTrackRef.current = null
    stopAppAudioCapture()
    // QUINTA RODADA: mesma lógica acima, agora pro áudio de SISTEMA
    // (ver captureSystemAudioTrack) — desde que vídeo e áudio viraram
    // duas chamadas separadas, esse áudio também vem de um MediaStream
    // próprio, fora de screenStreamRef.current, então precisa da própria
    // limpeza aqui, senão o indicador "compartilhando microfone/tela" do
    // Windows continuaria aceso e o processo WASAPI de loopback
    // continuaria aberto à toa.
    if (systemAudioTrackRef.current) {
      systemAudioTrackRef.current.stop()
      systemAudioTrackRef.current = null
    }
    screenStreamRef.current = null
    screenAudioTrackIdRef.current = null
    screenAudioSourceStreamRef.current = null
    setLocalScreenStream(null)
    setScreenSharing(false)
    broadcastScreenMeta(null, null)

    // Desliga o vigia de foco do jogo (se estava ativo) e limpa tudo que
    // ele usava — senão o processo do PowerShell continuaria rodando à
    // toa até a próxima call, e o Map de senders ficaria com entradas de
    // uma transmissão que já acabou.
    foregroundWatchUnsubRef.current?.()
    foregroundWatchUnsubRef.current = null
    window.electronAPI?.stopForegroundWatch?.().catch(() => {})
    screenSendersRef.current.clear()
    audioSendersRef.current.clear()
    realScreenVideoTrackRef.current = null
    if (placeholderTrackRef.current) {
      placeholderTrackRef.current.stop()
      placeholderTrackRef.current = null
    }
  }

  async function toggleScreenShare(opts?: { auto?: boolean }) {
    if (screenSharing) {
      stopScreenShareState()
      return
    }
    try {
      const preset = screenShareQualityRef.current
      // OITAVA RODADA: getDisplayMedia() foi abandonado — ver o
      // comentário grande em captureScreenShareStream acima pro
      // raciocínio completo. A qualidade (resolução/taxa de quadros)
      // continua sendo ajustada DEPOIS, na track já ativa.
      const stream = await captureScreenShareStream(preset, opts)
      // Recado deixado pelo ScreenSharePicker.tsx quando a pessoa clicou
      // no atalho "Compartilhar seu jogo/janela" E caiu no caso de tela
      // cheia (sem janela própria pra detectar o fechamento sozinha) — ver
      // screenShareGameHint.ts. Só dá pra ler DEPOIS do getDisplayMedia
      // acima resolver — é só nesse momento (a pessoa já escolheu algo no
      // seletor) que o picker teria tido a chance de deixar esse recado;
      // lendo antes (como era antes dessa correção) sempre pegava o
      // recado vazio/velho de uma vez anterior, porque o seletor nem
      // tinha aberto ainda.
      const gameShareHint = takePendingGameShareHint()
      // Ver pendingAppAudioCapture.ts — automático (sem checkbox) pra
      // "Jogo"/Janela com PID resolvido (ver ScreenSharePicker.tsx).
      // `isWindowChoice` é só diagnóstico: se era mesmo uma janela mas
      // não veio PID, avisa em vez de ficar silenciosamente sem áudio
      // sem pista nenhuma do motivo.
      const appAudioChoice = takePendingAppAudioPid()
      const appAudioPid = appAudioChoice?.pid ?? null
      logDebug(`toggleScreenShare: appAudioChoice=${JSON.stringify(appAudioChoice)}`)
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      // Avisa a sala ANTES de adicionar a track — o broadcast chega quase
      // instantâneo, enquanto a renegociação WebRTC (oferta/resposta/ICE)
      // leva alguns round-trips, então o aviso quase sempre chega primeiro.
      broadcastScreenMeta(stream.id)
      const videoTrack = stream.getVideoTracks()[0]
      // Ajuste de qualidade best-effort, à parte — ver
      // applyVideoQualityConstraints acima. Não bloqueia nem arrisca a
      // transmissão: se falhar, só continua na resolução/taxa nativa.
      void applyVideoQualityConstraints(videoTrack, preset)
      // QUINTA RODADA: vídeo e áudio agora são COMPLETAMENTE
      // independentes — `stream` (acima) só tem vídeo. Tenta primeiro a
      // captura por processo (isola só o som do jogo, quando o PID foi
      // resolvido); se não der, cai pro áudio de todo o sistema via
      // captureSystemAudioTrack (chamada separada, então uma falha aqui
      // NUNCA mais derruba o vídeo, que já está garantido acima). Só na
      // pior hipótese (as duas falharem) é que a transmissão fica sem
      // áudio nenhum — mas o vídeo já foi, de qualquer forma.
      //
      // DÉCIMA PRIMEIRA RODADA: no Linux, `stream` já pode vir com uma
      // track de áudio DENTRO dela — o seletor NATIVO do sistema (ver o
      // branch de Linux em captureScreenShareStream acima) tem seu
      // próprio toggle de "compartilhar também o áudio", e quando a
      // pessoa marca isso, getDisplayMedia() já devolve vídeo+áudio
      // juntos no mesmo MediaStream, exatamente como o Chrome/Discord
      // fazem. Usar essa track direto (em vez de tentar as duas
      // capturas Windows-only abaixo, que nem se aplicam aqui) significa
      // reaproveitar o áudio que o PRÓPRIO SISTEMA já isolou pra área
      // escolhida — evita duplicar captura à toa e evita cair no áudio
      // de sistema inteiro sem necessidade.
      let audioTrack: MediaStreamTrack | null = stream.getAudioTracks()[0] ?? null
      let audioSourceStream: MediaStream = stream
      if (!audioTrack && appAudioPid) {
        const appAudioTrack = await startAppAudioCapture(appAudioPid)
        if (appAudioTrack) {
          audioTrack = appAudioTrack
          audioSourceStream = appAudioPlayerRef.current?.stream ?? stream
          appAudioTrackRef.current = appAudioTrack
        }
      }
      if (!audioTrack) {
        const systemAudioTrack = await captureSystemAudioTrack()
        if (systemAudioTrack) {
          audioTrack = systemAudioTrack
          audioSourceStream = new MediaStream([systemAudioTrack])
          systemAudioTrackRef.current = systemAudioTrack
        }
      }
      logDebug(`toggleScreenShare: resultado final do áudio — ${audioTrack ? `track ok (${audioTrack.label || audioTrack.id})` : 'NENHUMA track de áudio (transmissão vai muda)'}`)
      // Só avisa sobre o áudio depois de saber o resultado FINAL das duas
      // tentativas acima — dizer isso antes seria um chute (poderia dar
      // certo no áudio de sistema mesmo sem o PID da janela).
      if (appAudioChoice?.isWindowChoice && !appAudioPid) {
        setError(
          audioTrack
            ? 'Não consegui identificar o processo do app/jogo — a transmissão vai com o áudio de todo o sistema em vez de só o dele (o vídeo continua normal).'
            : 'Não consegui identificar o processo do app/jogo, e também não consegui capturar o áudio de sistema — a transmissão vai sem áudio (o vídeo continua normal).'
        )
      }
      // DÉCIMA SÉTIMA RODADA: passa a track de áudio resolvida (seja
      // qual for a origem) pelo redutor de ruído da transmissão antes de
      // mandar pra qualquer peer — ver prepareScreenAudioForSending /
      // createScreenAudioDenoiser. `audioTrack`/`audioSourceStream`
      // passam a apontar pra versão FILTRADA daqui em diante (o resto da
      // função, incluindo o laço de peers logo abaixo, nem precisa saber
      // que isso aconteceu).
      if (audioTrack) {
        const prepared = await prepareScreenAudioForSending(audioTrack)
        audioTrack = prepared.track
        audioSourceStream = prepared.stream
      } else {
        teardownScreenAudioDenoiser()
      }
      screenAudioOutputTrackRef.current = audioTrack
      // Guarda o ID pra próxima renegociação (seja a de agora mesmo, logo
      // abaixo, seja uma futura — por exemplo quando outra pessoa entra
      // na call no meio da transmissão) saber que ESSA é a track que
      // precisa forçar estéreo no SDP (ver setLocalDescriptionPreferringStereo).
      screenAudioTrackIdRef.current = audioTrack?.id ?? null
      // "motion" prioriza fluidez de movimento em vez de nitidez de
      // texto estático — melhor pra compartilhar jogo/vídeo do que a
      // opção padrão, que otimiza pra tela parada (documento, planilha)
      videoTrack.contentHint = 'motion'
      videoTrack.onended = () => {
        stopScreenShareState()
      }

      // Caso especial: captura de TELA CHEIA usada como substituto de
      // "compartilhar o jogo/janela" (jogo em modo exclusivo, sem janela
      // própria pro sistema capturar separadamente). Diferente de uma
      // janela — que dispara `onended` sozinha quando é fechada — a
      // tela em si nunca "fecha", então sem isto aqui a transmissão
      // continuaria mostrando o desktop vazio mesmo depois do jogo ser
      // fechado. Pede pro processo principal vigiar os processos do
      // recado (funciona pra qualquer jogo/app, não só os cadastrados em
      // KNOWN_GAMES — ver electron/main.cjs) e encerra sozinho assim que
      // eles não estiverem mais rodando.
      if (gameShareHint && window.electronAPI) {
        window.electronAPI.watchProcessExit?.(gameShareHint.processNames).catch(() => {})
        gameShareWatchRef.current = window.electronAPI.onWatchedProcessExited(() => {
          stopScreenShareState()
        })
      }

      realScreenVideoTrackRef.current = videoTrack
      peersRef.current.forEach(({ pc }, peerId) => {
        const sender = pc.addTrack(videoTrack, stream)
        screenSendersRef.current.set(peerId, sender)
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        params.encodings[0].maxBitrate = preset.maxBitrate
        ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
          preset.degradationPreference
        sender.setParameters(params).catch(() => {
          // alguns navegadores/drivers não suportam todos os campos — sem problema, segue com o padrão
        })
        if (audioTrack) {
          // Mesmo ajuste do bloco de quem entra depois (createPeerConnection
          // acima) — o áudio da transmissão precisa do PRÓPRIO teto de
          // bitrate (128kbps, pensado pra som de jogo/música), não o
          // preset de vídeo nem o padrão baixo do navegador.
          const audioSender = pc.addTrack(audioTrack, audioSourceStream)
          const audioParams = audioSender.getParameters()
          audioParams.encodings = audioParams.encodings?.length ? audioParams.encodings : [{}]
          audioParams.encodings[0].maxBitrate = SCREEN_SHARE_AUDIO_MAX_BITRATE
          audioSender.setParameters(audioParams).catch(() => {})
          audioSendersRef.current.set(peerId, audioSender)
        }
      })
      // DÉCIMA QUINTA RODADA — guarda a MediaStream de áudio (pra
      // createPeerConnection reaproveitar o MESMO .id com quem entrar
      // depois — ver o comentário grande em screenAudioSourceStreamRef) e
      // reenvia o broadcast agora com o .id do áudio, já resolvido. O
      // broadcast lá em cima (logo depois de captureScreenShareStream)
      // saiu só com o vídeo — nesse momento a captura de áudio ainda nem
      // tinha começado — então esse segundo envio é o que finalmente
      // avisa a sala que a stream de áudio X é a mesma tela; sem ele,
      // recomputeParticipant nunca teria como saber disso e a track de
      // áudio caía como se fosse webcam (o bug original desta rodada).
      screenAudioSourceStreamRef.current = audioTrack ? audioSourceStream : null
      broadcastScreenMeta(stream.id, audioTrack ? audioSourceStream.id : null)
      setScreenSharing(true)

      // Mitigação de vazamento pro caso "compartilhar seu jogo" em tela
      // cheia (sem janela própria — ver comentário grande acima e em
      // ScreenSharePicker.tsx): enquanto isso estiver ativo, o processo
      // principal (só Windows, best-effort — ver electron/main.cjs)
      // avisa quando a pessoa alterna pra fora do jogo, e a gente troca
      // o vídeo enviado pelos peers por uma "cortina" preta até ela
      // voltar. Em Mac/Linux, ou se o vigia não conseguir iniciar (volta
      // `false`), simplesmente não faz nada — o compartilhamento
      // continua igual ao de antes (sempre visível), sem quebrar nada.
      if (gameShareHint && window.electronAPI?.startForegroundWatch) {
        window.electronAPI
          .startForegroundWatch(gameShareHint.processNames)
          .then((started) => {
            if (!started || !window.electronAPI) return
            foregroundWatchUnsubRef.current = window.electronAPI.onGameForegroundChanged((focused) => {
              const realTrack = realScreenVideoTrackRef.current
              if (!realTrack) return
              if (focused) {
                // Voltou pro jogo — restaura o vídeo de verdade em todo
                // mundo e descarta a cortina (não precisa mais dela até
                // a próxima vez que a pessoa alternar pra fora).
                screenSendersRef.current.forEach((sender) => {
                  sender.replaceTrack(realTrack).catch(() => {})
                })
                if (placeholderTrackRef.current) {
                  placeholderTrackRef.current.stop()
                  placeholderTrackRef.current = null
                }
              } else {
                // Saiu do jogo (alt-tab) — troca pela cortina em todo
                // mundo antes que qualquer frame do resto da tela chegue
                // a ser enviado.
                if (!placeholderTrackRef.current) placeholderTrackRef.current = createPlaceholderVideoTrack()
                const placeholder = placeholderTrackRef.current
                screenSendersRef.current.forEach((sender) => {
                  sender.replaceTrack(placeholder).catch(() => {})
                })
              }
            })
          })
          .catch(() => {
            // Sem sorte iniciando o vigia (PowerShell bloqueado por
            // política do sistema, por exemplo) — segue sem essa camada
            // extra de proteção, sem interromper o compartilhamento.
          })
      }
      // No app desktop, capturar uma janela específica faz o Windows
      // trazer ela pra frente sozinho (comportamento do sistema, não do
      // nosso código) — a pessoa clica em "compartilhar tela" e se vê
      // jogada pra fora do app. O processo principal já tenta devolver o
      // foco uma vez assim que a fonte é escolhida (ver
      // electron/main.cjs), mas chama de novo aqui, agora que o stream
      // já está de fato fluindo, cobre o caso do foco mudar de novo nesse
      // meio-tempo.
      window.electronAPI?.focusAppWindow?.()
    } catch (err) {
      // TERCEIRA RODADA de correção nesse fluxo: clicar em "Cancelar" no
      // seletor (ScreenSharePicker.tsx) ou clicar fora dele chama
      // choose(null), que no processo principal responde ao pedido do
      // Electron com um objeto vazio (ver ipcMain.handle('screen-share:select', ...)
      // em electron/main.cjs) — é assim que a API pede pra gente NEGAR o
      // pedido. Isso faz getDisplayMedia() REJEITAR a Promise com
      // DOMException "NotAllowedError", exatamente como quando o
      // microfone é negado (ver o catch de joinChannel acima, que já
      // trata esse mesmo nome de erro). Antes dessa correção, cancelar o
      // seletor SEMPRE caía aqui e mostrava "Não foi possível
      // compartilhar a tela." — só que isso ficava invisível até a
      // correção anterior (o banner de erro em VoiceChannelView.tsx), daí
      // parecer um bug NOVO quando na verdade sempre existiu, só que
      // mudo. Cancelamento não é uma falha real, então não deve gerar
      // aviso nenhum. Pra qualquer outro erro de verdade, agora inclui a
      // mensagem original na tela — antes esse catch não guardava o erro
      // (`catch {}`, sem variável nenhuma), então uma falha real nesse
      // trecho (ex.: pc.addTrack, sender.setParameters) virava sempre o
      // mesmo aviso genérico, sem pista nenhuma de qual foi o motivo de
      // verdade — impossível de diagnosticar à distância.
      if (err instanceof Error && err.name === 'NotAllowedError') return
      // QUARTA RODADA: "Invalid capture constraints" continuou aparecendo
      // mesmo depois de tirar o "max" do frameRate — ou seja, a causa era
      // outra (ver a correção em pendingDisplayMediaSources, no
      // electron/main.cjs: as duas chamadas separadas de
      // desktopCapturer.getSources() — uma pra montar a lista, outra pra
      // resolver o clique — foram unificadas numa só). Pra não ficar
      // adivinhando de novo se essa também não for a causa completa,
      // inclui aqui TODO detalhe que o navegador expuser: além da
      // mensagem, o nome do erro (err.name) e, se for OverconstrainedError
      // (erro específico de constraint de vídeo/áudio inválida), o nome
      // exato da propriedade que falhou (err.constraint — ex.: "frameRate",
      // "channelCount") — informação que a mensagem sozinha não mostra.
      const name = err instanceof Error ? err.name : null
      const constraint =
        err && typeof err === 'object' && 'constraint' in err ? String((err as { constraint: unknown }).constraint) : null
      const detail = err instanceof Error ? err.message : String(err)
      const parts = [detail, name && name !== 'Error' ? `(${name}${constraint ? `: ${constraint}` : ''})` : null].filter(
        Boolean
      )
      setError(parts.length ? `Não foi possível compartilhar a tela: ${parts.join(' ')}` : 'Não foi possível compartilhar a tela.')
    }
  }

  // Troca a fonte (janela/tela) de uma transmissão que já está rolando,
  // sem precisar parar e começar outra do zero. Abre o mesmo seletor de
  // sempre (getDisplayMedia — no app desktop isso mostra de novo o
  // ScreenSharePicker.tsx, com o mesmo atalho "compartilhar seu
  // jogo/janela" se fizer sentido) e, assim que a pessoa escolhe algo
  // novo, troca só o CONTEÚDO sendo enviado pra cada peer via
  // replaceTrack — como isso não mexe no "canal" (m-line) já negociado,
  // não dispara uma renegociação nem um piscar de "parou/começou de novo"
  // pra quem está assistindo, diferente de um stop+start completo.
  async function switchScreenShareSource() {
    if (!screenSharing || !screenStreamRef.current) return
    try {
      const preset = screenShareQualityRef.current
      // OITAVA RODADA: idem toggleScreenShare acima — ver
      // captureScreenShareStream.
      const newStream = await captureScreenShareStream(preset)
      // Mesma lógica de toggleScreenShare acima — só dá pra ler o recado
      // do picker DEPOIS do getDisplayMedia resolver.
      const gameShareHint = takePendingGameShareHint()
      const appAudioChoice = takePendingAppAudioPid()
      const appAudioPid = appAudioChoice?.pid ?? null

      const newVideoTrack = newStream.getVideoTracks()[0]
      if (!newVideoTrack) {
        newStream.getTracks().forEach((t) => t.stop())
        return
      }
      // Ajuste de qualidade best-effort, à parte — ver
      // applyVideoQualityConstraints acima.
      void applyVideoQualityConstraints(newVideoTrack, preset)
      // DÉCIMA PRIMEIRA RODADA: idem toggleScreenShare acima — no Linux
      // `newStream` já pode vir com a track de áudio embutida (seletor
      // nativo do sistema, ver captureScreenShareStream).
      let newAudioTrack: MediaStreamTrack | null = newStream.getAudioTracks()[0] ?? null
      let audioSourceStream: MediaStream = newStream
      newVideoTrack.contentHint = 'motion'

      const oldVideoTrack = realScreenVideoTrackRef.current
      const oldAudioTrackId = screenAudioTrackIdRef.current
      const hadAudioBefore = Boolean(oldAudioTrackId)

      // Cancela o vigia de foco/fechamento da fonte ANTERIOR antes de
      // trocar — senão, se a fonte antiga fosse o caso especial "tela
      // cheia substituindo o jogo" e aquele jogo fechasse depois da
      // troca, o vigia antigo ainda ativo ia encerrar a transmissão NOVA
      // por engano, achando que ainda era sobre o jogo velho.
      gameShareWatchRef.current?.()
      gameShareWatchRef.current = null
      window.electronAPI?.stopWatchProcessExit?.().catch(() => {})
      foregroundWatchUnsubRef.current?.()
      foregroundWatchUnsubRef.current = null
      window.electronAPI?.stopForegroundWatch?.().catch(() => {})
      if (placeholderTrackRef.current) {
        placeholderTrackRef.current.stop()
        placeholderTrackRef.current = null
      }
      // Idem pra captura de áudio por processo (EXPERIMENTAL) da fonte
      // ANTERIOR — precisa encerrar o processo nativo velho antes de
      // (talvez) iniciar um novo pro PID recém-escolhido. `oldAudioTrackId`
      // acima já guardou o que precisa (o ID, não o objeto) pra achar o
      // sender certo daqui pra baixo, então pode parar com segurança.
      stopAppAudioCapture()
      appAudioTrackRef.current = null
      // QUINTA RODADA: idem — encerra o áudio de SISTEMA da fonte
      // ANTERIOR (se tinha) antes de (talvez) capturar um novo pra fonte
      // nova. Ver captureSystemAudioTrack acima e o comentário grande em
      // stopScreenShareState pro porquê dessa referência à parte existir.
      systemAudioTrackRef.current?.stop()
      systemAudioTrackRef.current = null
      if (!newAudioTrack && appAudioPid) {
        const appAudioTrack = await startAppAudioCapture(appAudioPid)
        if (appAudioTrack) {
          newAudioTrack = appAudioTrack
          audioSourceStream = appAudioPlayerRef.current?.stream ?? newStream
          appAudioTrackRef.current = appAudioTrack
        }
      }
      if (!newAudioTrack) {
        const systemAudioTrack = await captureSystemAudioTrack()
        if (systemAudioTrack) {
          newAudioTrack = systemAudioTrack
          audioSourceStream = new MediaStream([systemAudioTrack])
          systemAudioTrackRef.current = systemAudioTrack
        }
      }
      if (appAudioChoice?.isWindowChoice && !appAudioPid) {
        setError(
          newAudioTrack
            ? 'Não consegui identificar o processo do app/jogo — a transmissão vai com o áudio de todo o sistema em vez de só o dele (o vídeo continua normal).'
            : 'Não consegui identificar o processo do app/jogo, e também não consegui capturar o áudio de sistema — a transmissão vai sem áudio (o vídeo continua normal).'
        )
      }

      // DÉCIMA SÉTIMA RODADA: idem toggleScreenShare acima — filtra a
      // track de áudio da fonte NOVA antes de trocar nos peers.
      if (newAudioTrack) {
        const prepared = await prepareScreenAudioForSending(newAudioTrack)
        newAudioTrack = prepared.track
        audioSourceStream = prepared.stream
      } else {
        teardownScreenAudioDenoiser()
      }

      peersRef.current.forEach(({ pc }, peerId) => {
        let audioHandled = false
        pc.getSenders().forEach((sender) => {
          if (sender.track === oldVideoTrack) {
            sender.replaceTrack(newVideoTrack).catch(() => {})
            const params = sender.getParameters()
            params.encodings = params.encodings?.length ? params.encodings : [{}]
            params.encodings[0].maxBitrate = preset.maxBitrate
            ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
              preset.degradationPreference
            sender.setParameters(params).catch(() => {})
          } else if (hadAudioBefore && sender.track?.id === oldAudioTrackId) {
            // Troca o áudio também quando já existia um sender de áudio
            // antes — inclusive pra REMOVER (replaceTrack(null)) se a
            // nova escolha não tiver áudio (ex: trocou de "tela inteira
            // com áudio do sistema" pra "só uma janela específica",
            // que nunca tem essa opção).
            sender.replaceTrack(newAudioTrack).catch(() => {})
            audioHandled = true
          }
        })
        // Ganhou áudio que não existia antes (ex: trocou de "só uma
        // janela" pra "tela inteira" com o áudio do sistema marcado) —
        // isso sim precisa de um addTrack de verdade, o que dispara uma
        // pequena renegociação só pra esse caso específico.
        if (newAudioTrack && !hadAudioBefore && !audioHandled) {
          const audioSender = pc.addTrack(newAudioTrack, audioSourceStream)
          const audioParams = audioSender.getParameters()
          audioParams.encodings = audioParams.encodings?.length ? audioParams.encodings : [{}]
          audioParams.encodings[0].maxBitrate = SCREEN_SHARE_AUDIO_MAX_BITRATE
          audioSender.setParameters(audioParams).catch(() => {})
          audioSendersRef.current.set(peerId, audioSender)
        }
      })

      // Só agora encerra a captura ANTIGA de verdade (indicador do
      // sistema apaga, recursos liberados) — e limpa o onended dela
      // ANTES de parar, senão ele ainda dispararia stopScreenShareState()
      // e derrubaria a transmissão NOVA que acabou de assumir o lugar.
      if (oldVideoTrack) oldVideoTrack.onended = null
      screenStreamRef.current.getTracks().forEach((t) => t.stop())

      screenStreamRef.current = newStream
      setLocalScreenStream(newStream)
      realScreenVideoTrackRef.current = newVideoTrack
      screenAudioTrackIdRef.current = newAudioTrack?.id ?? null
      screenAudioOutputTrackRef.current = newAudioTrack
      // DÉCIMA QUINTA RODADA — idem toggleScreenShare acima: guarda a
      // stream de áudio da fonte NOVA (pra quem entrar depois reaproveitar
      // o mesmo .id) e avisa a sala com os dois ids já resolvidos, não só
      // o de vídeo.
      screenAudioSourceStreamRef.current = newAudioTrack ? audioSourceStream : null
      newVideoTrack.onended = () => {
        stopScreenShareState()
      }
      broadcastScreenMeta(newStream.id, newAudioTrack ? audioSourceStream.id : null)

      // Mesmo par de mitigações de "compartilhar seu jogo" em tela cheia
      // do toggleScreenShare acima, agora pra a fonte NOVA — ver os
      // comentários grandes lá pra entender o esquema completo.
      if (gameShareHint && window.electronAPI) {
        window.electronAPI.watchProcessExit?.(gameShareHint.processNames).catch(() => {})
        gameShareWatchRef.current = window.electronAPI.onWatchedProcessExited(() => {
          stopScreenShareState()
        })
      }
      if (gameShareHint && window.electronAPI?.startForegroundWatch) {
        window.electronAPI
          .startForegroundWatch(gameShareHint.processNames)
          .then((started) => {
            if (!started || !window.electronAPI) return
            foregroundWatchUnsubRef.current = window.electronAPI.onGameForegroundChanged((focused) => {
              const realTrack = realScreenVideoTrackRef.current
              if (!realTrack) return
              if (focused) {
                screenSendersRef.current.forEach((sender) => {
                  sender.replaceTrack(realTrack).catch(() => {})
                })
                if (placeholderTrackRef.current) {
                  placeholderTrackRef.current.stop()
                  placeholderTrackRef.current = null
                }
              } else {
                if (!placeholderTrackRef.current) placeholderTrackRef.current = createPlaceholderVideoTrack()
                const placeholder = placeholderTrackRef.current
                screenSendersRef.current.forEach((sender) => {
                  sender.replaceTrack(placeholder).catch(() => {})
                })
              }
            })
          })
          .catch(() => {})
      }
      window.electronAPI?.focusAppWindow?.()
    } catch {
      // Cancelou o seletor, ou algo deu errado — mantém a transmissão
      // ATUAL rodando normalmente, sem interromper nada por causa de uma
      // troca que não deu certo.
    }
  }

  // Detecção de fala: amostra o nível de áudio de cada analyser a cada 200ms
  useEffect(() => {
    if (!connectedChannelId) return
    const buffer = new Uint8Array(256)
    const interval = setInterval(() => {
      const now = Date.now()
      analysersRef.current.forEach((analyser, key) => {
        analyser.getByteFrequencyData(buffer)
        const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length
        if (avg > SPEAKING_THRESHOLD) lastAboveThresholdRef.current.set(key, now)
        const lastAbove = lastAboveThresholdRef.current.get(key) ?? 0
        const isSpeaking = now - lastAbove < SPEAKING_RELEASE_MS
        if (key === 'local') {
          setSpeaking((prev) => (prev !== isSpeaking ? isSpeaking : prev))
        } else {
          setParticipants((prev) => {
            if (!prev[key] || prev[key].speaking === isSpeaking) return prev
            return { ...prev, [key]: { ...prev[key], speaking: isSpeaking } }
          })
        }
      })
    }, 200)
    return () => clearInterval(interval)
  }, [connectedChannelId])

  return (
    <VoiceContext.Provider
      value={{
        connectedChannelId,
        connectedChannelName,
        joiningChannelId,
        connectedAt,
        connectionQuality,
        connectedServerId,
        connecting,
        error,
        clearError: () => setError(null),
        participants,
        muted,
        deafened,
        toggleDeafen,
        videoEnabled,
        screenSharing,
        localScreenStream,
        speaking,
        join,
        leave,
        toggleMute,
        pushToTalkEnabled,
        setPushToTalkEnabled,
        pushToTalkKey,
        setPushToTalkKey,
        pushToTalkActive,
        globalPushToTalkAvailable,
        pushToTalkGlobalKeyName,
        captureGlobalPushToTalkKey,
        toggleVideo,
        toggleScreenShare,
        switchScreenShareSource,
        playSoundboardSound,
        changeMicrophone,
        refreshAudioConstraints,
        audioSettings,
        screenShareQuality,
        maxParticipants: MAX_PARTICIPANTS,
        masterVolume,
        setMasterVolume,
        soundboardVolume,
        setSoundboardVolume,
        getParticipantVolume,
        setParticipantVolume,
        getScreenShareVolume,
        setScreenShareVolume,
      }}
    >
      {children}
    </VoiceContext.Provider>
  )
}
