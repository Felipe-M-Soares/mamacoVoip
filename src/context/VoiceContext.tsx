import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAudioSettings } from '../hooks/useAudioSettings'
import { useScreenShareQuality } from '../hooks/useScreenShareQuality'
import { createNoiseSuppressor, type NoiseSuppressor } from '../lib/noiseSuppression'
import { takePendingGameShareHint } from '../lib/screenShareGameHint'
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
  toggleScreenShare: () => Promise<void>
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
    const clamped = Math.max(0, Math.min(100, volume))
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
  const foregroundWatchUnsubRef = useRef<(() => void) | null>(null)
  // Track "cortina" — um frame preto único (via canvas.captureStream),
  // criada sob demanda e reaproveitada enquanto durar o compartilhamento
  // atual. Só existe enquanto o vigia de foco estiver ativo.
  const placeholderTrackRef = useRef<MediaStreamTrack | null>(null)
  const realScreenVideoTrackRef = useRef<MediaStreamTrack | null>(null)

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

  function sendSignal(to: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    const from = userIdRef.current
    if (!realtimeRef.current || !from) return
    realtimeRef.current.send({ type: 'broadcast', event: 'rtc', payload: { from, to, ...data } })
  }

  // Avisa todo mundo no canal (broadcast, não é dirigido a um peer
  // específico) qual é o stream.id da MINHA tela compartilhada agora —
  // ou null quando paro. É esse aviso explícito que os outros usam pra
  // saber, com certeza, qual das minhas streams é a tela.
  function broadcastScreenMeta(screenStreamId: string | null) {
    const from = userIdRef.current
    if (!realtimeRef.current || !from) return
    realtimeRef.current.send({ type: 'broadcast', event: 'screen-meta', payload: { from, screenStreamId } })
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

  // Recalcula cameraStream/screenStream de um peer a partir de TODAS as
  // streams já recebidas dele + o mapeamento de qual stream.id é tela
  // (vindo do broadcast). Funciona não importa a ordem de chegada.
  function recomputeParticipant(peerId: string) {
    const streams = rawStreamsRef.current.get(peerId)
    if (!streams || streams.size === 0) return
    const screenId = screenStreamIdsRef.current.get(peerId)
    let cameraStream: MediaStream | null = null
    let screenStream: MediaStream | null = null
    streams.forEach((s, id) => {
      if (screenId && id === screenId) screenStream = s
      else if (!cameraStream) cameraStream = s
    })
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
      screenStreamRef.current.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, screenStreamRef.current!)
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        if (track.kind === 'audio') {
          // Áudio da transmissão (som do jogo/sistema) usa seu PRÓPRIO
          // teto de bitrate — o preset de vídeo (maxBitrate em Mbps,
          // pensado pra nitidez de imagem) não faz sentido aqui. Antes
          // esse valor era aplicado nos dois tracks (vídeo E áudio) sem
          // distinção, deixando o áudio sem nenhum ajuste de verdade.
          params.encodings[0].maxBitrate = SCREEN_SHARE_AUDIO_MAX_BITRATE
          sender.setParameters(params).catch(() => {})
          return
        }
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
    screenSendersRef.current.delete(peerId)
    setParticipants((prev) => {
      if (!(peerId in prev)) return prev
      const next = { ...prev }
      delete next[peerId]
      return next
    })
  }

  const join = useCallback(async (channelId: string, serverId: string | null, options?: { displayName?: string; userLimit?: number }) => {
    if (!user || connectedRef.current) return
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
        const { from, screenStreamId } = payload as { from: string; screenStreamId: string | null }
        if (screenStreamId) screenStreamIdsRef.current.set(from, screenStreamId)
        else screenStreamIdsRef.current.delete(from)
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
          broadcastScreenMeta(screenStreamRef.current.id)
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
      realtimeRef.current.untrack()
      supabase.removeChannel(realtimeRef.current)
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
    screenStreamRef.current = null
    screenAudioTrackIdRef.current = null
    setLocalScreenStream(null)
    setScreenSharing(false)
    broadcastScreenMeta(null)

    // Desliga o vigia de foco do jogo (se estava ativo) e limpa tudo que
    // ele usava — senão o processo do PowerShell continuaria rodando à
    // toa até a próxima call, e o Map de senders ficaria com entradas de
    // uma transmissão que já acabou.
    foregroundWatchUnsubRef.current?.()
    foregroundWatchUnsubRef.current = null
    window.electronAPI?.stopForegroundWatch?.().catch(() => {})
    screenSendersRef.current.clear()
    realScreenVideoTrackRef.current = null
    if (placeholderTrackRef.current) {
      placeholderTrackRef.current.stop()
      placeholderTrackRef.current = null
    }
  }

  async function toggleScreenShare() {
    if (screenSharing) {
      stopScreenShareState()
      return
    }
    try {
      // Recado deixado pelo ScreenSharePicker.tsx quando a pessoa clicou
      // no atalho "Compartilhar seu jogo" E caiu no caso de tela cheia
      // (sem janela própria pra detectar o fechamento sozinha) — ver
      // screenShareGameHint.ts. Lido (e já apagado) uma vez aqui; se
      // tiver algo, ativa o auto-stop mais abaixo, depois que a captura
      // realmente começar.
      const gameShareHint = takePendingGameShareHint()
      const preset = screenShareQualityRef.current
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // Usa o preset de qualidade escolhido pela pessoa (Desempenho
          // ou Qualidade máxima) — em vez de um valor fixo, ela decide
          // o equilíbrio entre nitidez e não travar o jogo.
          //
          // O "max" só entra quando o preset realmente quer um TETO
          // (Desempenho, de propósito, pra não pesar) — em "Qualidade
          // máxima" não passamos "max" nenhum, só um "ideal" bem alto,
          // pra a captura sair na resolução NATIVA da tela da pessoa em
          // vez de ser reduzida pra um valor fixo (era isso que fazia a
          // transmissão sair pior que a tela de verdade da pessoa).
          width: preset.capResolution ? { ideal: preset.width, max: preset.width } : { ideal: preset.width },
          height: preset.capResolution ? { ideal: preset.height, max: preset.height } : { ideal: preset.height },
          frameRate: { ideal: preset.frameRate, max: preset.frameRate },
        },
        // Inclui o áudio do sistema/jogo na transmissão, não só a
        // imagem — quem estiver assistindo ouve o som do jogo junto.
        audio: true,
      })
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      // Avisa a sala ANTES de adicionar a track — o broadcast chega quase
      // instantâneo, enquanto a renegociação WebRTC (oferta/resposta/ICE)
      // leva alguns round-trips, então o aviso quase sempre chega primeiro.
      broadcastScreenMeta(stream.id)
      const videoTrack = stream.getVideoTracks()[0]
      const audioTrack = stream.getAudioTracks()[0]
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
          const audioSender = pc.addTrack(audioTrack, stream)
          const audioParams = audioSender.getParameters()
          audioParams.encodings = audioParams.encodings?.length ? audioParams.encodings : [{}]
          audioParams.encodings[0].maxBitrate = SCREEN_SHARE_AUDIO_MAX_BITRATE
          audioSender.setParameters(audioParams).catch(() => {})
        }
      })
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
    } catch {
      setError('Não foi possível compartilhar a tela.')
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
