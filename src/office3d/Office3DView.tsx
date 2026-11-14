import { ViewModeToggle } from '../components/layout/ViewModeToggle'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Channel, Profile, Server } from '../types/database'
import { supabase } from '../lib/supabase'
import { useChannels } from '../hooks/useChannels'
import { useServerMembers } from '../hooks/useServerMembers'
import { useOnlineIds } from '../hooks/usePresence'
import { useVoiceCore, useVoiceSpeakingKey } from '../hooks/useVoice'
import { useVoiceRoster } from '../lib/voiceRoster'
import { useAuth } from '../hooks/useAuth'
import { useMessages } from '../hooks/useMessages'
import { useModeration } from '../hooks/useModeration'
import { useServerEvents } from '../hooks/useServerEvents'
import { describeMessageContent } from '../lib/stickers'
import { orderChannels } from '../lib/channelName'
import { getStreamQuality, hideStream, setStreamQuality, showStream, useStreamView, type StreamQuality } from '../lib/streamView'
import { UserPanel } from '../components/layout/UserPanel'
import { ChatArea } from '../components/layout/ChatArea'
import { MemberList } from '../components/layout/MemberList'
import { VoiceMemberCard, requestViewProfile, type VoiceMemberCardTarget } from '../components/layout/VoiceMemberCard'
import { DMChatArea } from '../components/layout/DMChatArea'
import { lazyModal } from '../components/modals/lazyModal'
import { useConversations } from '../hooks/useConversations'
import { useFriendsUsage } from '../hooks/useAppUsage'
import { useOfficeRealtime, OFFICE_EMOTES, type OfficeSignal } from './useOfficeRealtime'
import { loadMinigameRanking, submitMinigameResult } from './minigameRanking'
import { ACHIEVEMENTS, bumpStat, loadStats, statsFromResult, type Achievement } from './achievements'
import {
  createOffice,
  openMinigames,
  defaultSkin,
  FOFO_SKINS,
  BACK_LABELS,
  createSkinPreview,
  skinThumb,
  HAT_LABELS,
  type MinigameResult,
  type Office,
  type OfficeCategory,
  type OfficeMember,
  type OfficeSkin,
  type OfficeTvInfo,
  type OfficeZone,
  detectRoomTheme,
} from './engine.js'

const CreateChannelModal = lazyModal(() => import('../components/modals/CreateChannelModal').then((m) => m.CreateChannelModal))
const EditChannelModal = lazyModal(() => import('../components/modals/EditChannelModal').then((m) => m.EditChannelModal))
const ManageMemberModal = lazyModal(() => import('../components/modals/ManageMemberModal').then((m) => m.ManageMemberModal))
const EventsModal = lazyModal(() => import('../components/modals/EventsModal').then((m) => m.EventsModal))

// Modo Escritório. Abre por cima do app — o clássico continua montado por
// baixo (lista de canais, presença das salas, call), então fechar volta
// exatamente pro mesmo lugar.
//
// Custo: ZERO a mais no servidor de voz. Tudo aqui usa dados que o app já
// tem (canais, membros, status, quem está em cada sala, mensagens). Ninguém
// transmite posição de boneco: cada pessoa aparece onde o estado real dela
// manda. Os únicos extras são o visual do mamaco no perfil (1 coluna) e os
// emotes por broadcast do Realtime (PARTE 31 da 007).

const PALETTE = ['#3b82f6', '#22c55e', '#ec4899', '#a78bfa', '#eab308', '#06b6d4', '#f97316', '#84cc16', '#e11d48']
// v2: mamaco novo (skins da ficha). Visual antigo salvo é ignorado.
const SKIN_KEY = 'mamacos-3d-skin-v2'
const FUR = ['#7a4529', '#a8683f', '#8a5a3c', '#5d5a63', '#2f2724', '#c99a45', '#e6ddd2']
const SKIN_FIELDS = ['fur', 'top', 'outfit', 'headset', 'glasses', 'hat', 'hatColor', 'back'] as const

/** só os campos conhecidos, com o tipo certo (o que vem do perfil é de outra pessoa) */
function cleanSkin(raw: unknown): OfficeSkin | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined)
  const id = (v: unknown) => (typeof v === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(v) ? v : null)
  const fur = color(r.fur)
  if (!fur) return null
  return {
    fur,
    top: color(r.top) ?? fur,
    outfit: id(r.outfit) ?? 'base',
    headset: r.headset === true,
    glasses: r.glasses === true,
    hat: id(r.hat),
    hatColor: color(r.hatColor),
    back: id(r.back),
  }
}

const skinTime = (raw: unknown) => {
  const t = raw && typeof raw === 'object' ? Number((raw as { _at?: unknown })._at) : 0
  return Number.isFinite(t) ? t : 0
}
// O visual mais NOVO vence (o do aparelho ou o do perfil). Antes o do perfil
// sempre ganhava — e o perfil carregado no login não sabe da troca que você
// acabou de fazer: ao sair pro clássico e voltar, o mamaco "perdia" o fone,
// o chapéu etc.
function loadSkin(userId: string, fromProfile: unknown): OfficeSkin {
  let local: OfficeSkin | null = null, localAt = 0
  try {
    const raw = localStorage.getItem(SKIN_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    local = cleanSkin(parsed)
    localAt = skinTime(parsed)
  } catch {
    // sem armazenamento: fica com o do perfil
  }
  const p = cleanSkin(fromProfile)
  if (p && (!local || skinTime(fromProfile) > localAt)) return p
  return local ?? p ?? defaultSkin(userId)
}

// Onde você estava em cada servidor (pra voltar no mesmo lugar ao reabrir o
// Escritório). Fica salvo no aparelho.
const LAST_POS_KEY = 'mamacos-3d-pos-v1'
function loadLastPos(serverId: string): { x: number; z: number; yaw: number } | null {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_POS_KEY) || '{}') as Record<string, { x: number; z: number; yaw: number }>
    return all[serverId] ?? null
  } catch {
    return null
  }
}
function saveLastPos(serverId: string, pos: { x: number; z: number; yaw: number }) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_POS_KEY) || '{}') as Record<string, unknown>
    all[serverId] = pos
    localStorage.setItem(LAST_POS_KEY, JSON.stringify(all))
  } catch {
    // sem armazenamento: volta pra recepção
  }
}

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export function Office3DView({
  server,
  unreadChannelIds,
  onClose,
  onSelectChannel,
}: {
  server: Server
  unreadChannelIds?: Set<string>
  onClose: () => void
  onSelectChannel: (c: Channel) => void
}) {
  const { user, profile } = useAuth()
  const { categories, channels, createChannel: createChannelNow } = useChannels()
  const { members } = useServerMembers(server.id)
  const { permissions } = useModeration(server.id)
  const onlineIds = useOnlineIds()
  const roster = useVoiceRoster()
  const voice = useVoiceCore()
  const speakingKey = useVoiceSpeakingKey()
  const hostRef = useRef<HTMLDivElement>(null)
  const officeRef = useRef<Office | null>(null)
  const [zone, setZone] = useState<OfficeZone | null>(null)
  const [tv, setTv] = useState<OfficeTvInfo | null>(null)
  const [drawer, setDrawer] = useState(false)
  // estúdio aberto: pausa o escritório (economiza placa de vídeo)
  useEffect(() => { officeRef.current?.setPaused(drawer) }, [drawer])
  const [skin, setSkin] = useState<OfficeSkin>(() => loadSkin(user?.id ?? 'eu', profile?.office_skin))
  const [chatChannelId, setChatChannelId] = useState<string | null>(null)
  const [pinnedChat, setPinnedChat] = useState(false)
  // chat: 'mini' (barrinha), 'open' (painel), 'big' (grande)
  const [chatMode, setChatMode] = useState<'mini' | 'open' | 'big'>('open')
  const chatBoxRef = useRef<HTMLDivElement>(null)
  const [memberCard, setMemberCard] = useState<VoiceMemberCardTarget | null>(null)
  // clique num boneco: menu com mensagem privada, volume, perfil, acenar, moderar
  const [avatarMenu, setAvatarMenu] = useState<{ userId: string; x: number; y: number } | null>(null)
  const [dm, setDm] = useState<{ conversationId: string; profile: Profile } | null>(null)
  const [dmError, setDmError] = useState<string | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [emoteOpen, setEmoteOpen] = useState(false)
  const [createChannel, setCreateChannel] = useState<{ categoryId: string | null } | null>(null)
  const [editChannel, setEditChannel] = useState<Channel | null>(null)
  const [moderate, setModerate] = useState<Profile | null>(null)
  const [eventsOpen, setEventsOpen] = useState(false)
  const { openConversationWith } = useConversations()
  const usage = useFriendsUsage(true)
  const { events, rsvpsByEvent } = useServerEvents(server.id)
  const { hidden } = useStreamView()
  const myName = profile?.display_name || profile?.username || 'Você'
  const isOwner = server.owner_id === user?.id
  const canManageChannels = isOwner || !!permissions.manage_channels
  const canModerate = isOwner || !!(permissions.kick_members || permissions.ban_members || permissions.timeout_members || permissions.manage_roles)

  // Sala de Minigames = um canal de voz do servidor com nome de jogos
  // ("Minigames", "Fliperama", "Arcade"…). Ele vira a sala do fliperama/kart
  // (com call) em vez de uma sala comum no setor dele.
  const minigamesChannel = useMemo(
    () => channels.find((c) => c.type === 'voice' && detectRoomTheme(c.name).id === 'arcade') ?? null,
    [channels]
  )
  // canais organizados por categoria (igual a barra lateral)
  const layout = useMemo(() => {
    const cats = [...categories].sort((a, b) => a.position - b.position)
    const { text: orderedText, voice: orderedVoice } = orderChannels(channels)
    const ordered = [...orderedText, ...orderedVoice]
    const groups: { id: string; name: string; text: Channel[]; voice: Channel[] }[] = cats.map((c) => ({ id: c.id, name: c.name, text: [], voice: [] }))
    const loose = { id: '__sem-categoria', name: 'Geral', text: [] as Channel[], voice: [] as Channel[] }
    for (const ch of ordered) {
      if (ch.id === minigamesChannel?.id) continue
      const g = groups.find((x) => x.id === ch.category_id) ?? loose
      ;(ch.type === 'voice' ? g.voice : g.text).push(ch)
    }
    if (loose.text.length || loose.voice.length) groups.unshift(loose)
    // salas por setor: até 6 (o resto ainda funciona no clássico)
    return groups.filter((g) => g.text.length || g.voice.length).map((g) => ({ ...g, voice: g.voice.slice(0, 6) }))
  }, [categories, channels, minigamesChannel])

  const officeCats: OfficeCategory[] = useMemo(
    () =>
      layout.map((g, i) => ({
        id: g.id,
        name: g.name,
        color: PALETTE[i % PALETTE.length],
        text: g.text.map((c) => c.name),
        voice: g.voice.map((c) => ({ id: c.id, name: c.name, private: Boolean(c.is_restricted), theme: c.id === server.afk_channel_id ? 'descanso' : undefined })),
      })),
    [layout, server.afk_channel_id]
  )

  const officeMembers: OfficeMember[] = useMemo(() => {
    const myVoice = voice.connectedServerId === server.id ? voice.connectedChannelId : null
    return members.map((m) => {
      const p = m.profile
      const isMe = m.user_id === user?.id
      const present = isMe || onlineIds.has(m.user_id)
      const st = p.status === 'idle' || p.status === 'dnd' ? p.status : 'online'
      return {
        id: m.user_id,
        name: m.nickname || p.display_name || p.username,
        status: present && p.status !== 'offline' ? st : isMe ? 'online' : 'offline',
        // Só conta como "na sala" quem está conectado de verdade agora:
        // quem deslogou/fechou o app some da sala na hora (a lista da call
        // pode levar alguns segundos pra perceber a queda).
        voiceChannelId: isMe ? myVoice : present ? (roster.get(m.user_id) ?? null) : null,
        avatarUrl: p.avatar_url,
        // visual salvo no perfil (PARTE 31); sem ele, o motor sorteia um pelo id
        skin: isMe ? undefined : (cleanSkin(p.office_skin) ?? undefined),
      }
    })
  }, [members, onlineIds, roster, voice.connectedChannelId, voice.connectedServerId, server.id, user?.id])

  // ---------- TV da sala: transmissão de tela da SUA call ----------
  // Só a call em que você está (das outras salas o app nem recebe nada).
  // A TV mostra "AO VIVO" de graça; o vídeo só começa a chegar quando você
  // aperta F / clica na TV (igual "Assistir" no clássico), em qualidade
  // baixa — a TV é pequena. Desligou a TV ou saiu da sala: para de receber.
  const myRoom = voice.connectedServerId === server.id ? voice.connectedChannelId : null
  const sharers = useMemo(() => {
    const list: { key: string; stream: MediaStream }[] = []
    for (const [id, p] of Object.entries(voice.participants)) if (p.screenStream) list.push({ key: id, stream: p.screenStream })
    if (voice.screenSharing && voice.localScreenStream) list.push({ key: 'local', stream: voice.localScreenStream })
    return list
  }, [voice.participants, voice.screenSharing, voice.localScreenStream])
  const remoteWatched = sharers.find((x) => x.key !== 'local' && !hidden.has(x.key)) ?? null
  const shown = remoteWatched ?? sharers.find((x) => x.key === 'local') ?? null
  const tvOpened = useRef(new Map<string, StreamQuality>()) // o que a TV abriu → qualidade de antes

  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden
  const getHidden = () => hiddenRef.current
  function stopTv() {
    for (const [key, q] of tvOpened.current) {
      hideStream(key)
      setStreamQuality(key, q)
    }
    tvOpened.current.clear()
    for (const x of sharers) if (x.key !== 'local' && !getHidden().has(x.key)) hideStream(x.key)
  }
  function toggleTv() {
    if (remoteWatched) { stopTv(); return }
    const first = sharers.find((x) => x.key !== 'local')
    if (!first) return
    const prev = getStreamQuality(first.key)
    tvOpened.current.set(first.key, prev)
    if (prev === 'auto') setStreamQuality(first.key, 'baixa')
    showStream(first.key)
  }

  // ---------- conquistas (só no aparelho) ----------
  const [stats, setStats] = useState(() => loadStats())
  const celebrate = useCallback((list: Achievement[]) => {
    for (const a of list) officeRef.current?.toast(`🏆 Conquista: ${a.icon} ${a.name}`)
    setStats(loadStats())
  }, [])
  const onStat = useCallback((name: string, n: number) => celebrate(bumpStat(name, n)), [celebrate])
  const onGameResult = useCallback((r: MinigameResult) => {
    const got: Achievement[] = []
    for (const [name, n] of statsFromResult(r)) got.push(...bumpStat(name, n))
    celebrate(got)
    void submitMinigameResult(r)
  }, [celebrate])

  // ---------- emotes e aceno (broadcast do Realtime) ----------
  const nameOfId = useCallback((id: string) => {
    const m = members.find((x) => x.user_id === id)
    return m ? m.nickname || m.profile.display_name || m.profile.username : 'Alguém'
  }, [members])
  const nameOfIdRef = useRef(nameOfId)
  nameOfIdRef.current = nameOfId
  const onSignal = useCallback((s: OfficeSignal) => {
    const office = officeRef.current
    if (!office) return
    if (s.kind === 'emote') office.emote(s.from, s.emoji)
    else {
      office.emote(s.from, '👋')
      if (s.to === user?.id) office.toast(`${nameOfIdRef.current(s.from)} acenou pra você 👋`)
    }
  }, [user?.id])
  const { sendEmote, sendWave } = useOfficeRealtime(server.id, user?.id, onSignal)
  const doEmote = useCallback((emoji: string) => {
    if (!user) return
    officeRef.current?.emote(user.id, emoji)
    sendEmote(emoji)
  }, [user, sendEmote])
  const doEmoteRef = useRef(doEmote)
  doEmoteRef.current = doEmote

  // callbacks do motor sempre com os dados atuais
  const shareRef = useRef<(text: string) => Promise<void>>(async () => {})
  const latest = useRef({ channels, voice, layout, onSelectChannel, myRoom, live: sharers.length > 0, toggleTv, roster, members, share: (text: string) => void shareRef.current(text), onStat, onGameResult })
  latest.current = { channels, voice, layout, onSelectChannel, myRoom, live: sharers.length > 0, toggleTv, roster, members, share: (text: string) => void shareRef.current(text), onStat, onGameResult }

  function openGames(game: string | null) {
    officeRef.current?.setPaused(true)
    openMinigames(hostRef.current!, game, {
      onClose: () => officeRef.current?.setPaused(false),
      onShare: (text) => latest.current.share(text),
      onResult: (r) => latest.current.onGameResult(r),
      ranking: { load: (g) => loadMinigameRanking(g, user?.id) },
      skin: officeRef.current?.getMySkin(),
      name: myName,
    })
  }
  const openGamesRef = useRef(openGames)
  openGamesRef.current = openGames

  function focusChat() {
    setChatMode((m) => (m === 'mini' ? 'open' : m))
    setTimeout(() => chatBoxRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 30)
  }
  const focusChatRef = useRef(focusChat)
  focusChatRef.current = focusChat

  // cria o motor uma vez
  useEffect(() => {
    if (!hostRef.current || !user) return
    const office = createOffice({
      container: hostRef.current,
      me: { id: user.id, name: myName, avatarUrl: profile?.avatar_url ?? null },
      mySkin: skin,
      pixelRatio: 1.25,
      onRoomChange: (roomId) => {
        const { channels: chs, voice: v, onSelectChannel: select } = latest.current
        const ch = chs.find((c) => c.id === roomId)
        if (roomId && ch) {
          if (v.connectedChannelId !== roomId) void v.join(roomId, server.id)
          select(ch)
        } else if (!roomId && v.connectedChannelId && v.connectedServerId === server.id) v.leave()
      },
      onZoneChange: (z) => setZone(z),
      onUseTv: (info) => {
        const L = latest.current
        if (info.live && info.room && info.room.id === L.myRoom) { L.toggleTv(); return }
        office.setPaused(true)
        setTv(info)
      },
      onAvatarClick: (userId, at) => {
        setMemberCard(null)
        setAvatarMenu({ userId, x: at.x, y: at.y })
      },
      onUsePc: (info) => {
        const g = latest.current.layout.find((x) => x.id === info.sector)
        if (g?.text[0]) { setChatChannelId(g.text[0].id); setPinnedChat(true) }
        focusChatRef.current()
      },
      onArcade: (game) => openGamesRef.current(game),
      onStat: (name, n) => latest.current.onStat(name, n),
      startAt: loadLastPos(server.id),
    })
    officeRef.current = office
    return () => {
      try { saveLastPos(server.id, office.getPlayerState()) } catch { /* ok */ }
      office.dispose()
      officeRef.current = null
    }
    // o motor lê o resto pelos efeitos abaixo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    officeRef.current?.setData({
      serverName: server.name,
      categories: officeCats,
      members: officeMembers,
      minigamesRoom: minigamesChannel ? { id: minigamesChannel.id, name: minigamesChannel.name, private: Boolean(minigamesChannel.is_restricted) } : null,
    })
  }, [server.name, officeCats, officeMembers, minigamesChannel])

  // desenha a TV da sala da call (AO VIVO / a tela que você está assistindo)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const screenRoomRef = useRef<string | null>(null)
  const shownName = shown ? (shown.key === 'local' ? 'Você' : nameOfId(shown.key)) : ''
  const firstName = sharers[0] ? (sharers[0].key === 'local' ? 'Você' : nameOfId(sharers[0].key)) : ''
  useEffect(() => {
    const office = officeRef.current
    if (!office) return
    if (screenRoomRef.current && screenRoomRef.current !== myRoom) office.setRoomScreen(screenRoomRef.current, null)
    screenRoomRef.current = myRoom
    if (!myRoom) return
    if (!sharers.length) { office.setRoomScreen(myRoom, null); return }
    if (shown) {
      let v = videoRef.current
      if (!v) {
        v = document.createElement('video')
        v.muted = true // o som da transmissão já toca pelo app (VoiceCallAudio)
        v.playsInline = true
        v.autoplay = true
        videoRef.current = v
      }
      if (v.srcObject !== shown.stream) v.srcObject = shown.stream
      void v.play().catch(() => {})
      const more = sharers.length > 1 ? ` (+${sharers.length - 1})` : ''
      office.setRoomScreen(myRoom, { video: v, label: `${shownName} · tela${more}` })
    } else {
      const more = sharers.length > 1 ? ` e mais ${sharers.length - 1}` : ''
      office.setRoomScreen(myRoom, { label: `${firstName}${more} transmitindo` })
    }
  }, [myRoom, sharers, shown, shownName, firstName])

  // fechou o escritório: desliga o que a TV abriu e solta o vídeo
  useEffect(
    () => () => {
      for (const [key, q] of tvOpened.current) {
        hideStream(key)
        setStreamQuality(key, q)
      }
      tvOpened.current.clear()
      if (videoRef.current) videoRef.current.srcObject = null
    },
    []
  )

  // ---------- câmera da call em cima do boneco ----------
  // Só quem está NA SUA call (o app já recebe esse vídeo pra tela da call);
  // ninguém baixa vídeo a mais por causa do escritório.
  const camKeys = useRef(new Set<string>())
  useEffect(() => {
    const office = officeRef.current
    if (!office || !user) return
    const next = new Map<string, MediaStream>()
    if (myRoom) {
      for (const [id, p] of Object.entries(voice.participants)) if (p.cameraStream) next.set(id, p.cameraStream)
      if (voice.localCameraStream) next.set(user.id, voice.localCameraStream)
    }
    for (const id of camKeys.current) if (!next.has(id)) office.setAvatarVideo(id, null)
    for (const [id, stream] of next) office.setAvatarVideo(id, stream, id === user.id)
    camKeys.current = new Set(next.keys())
  }, [myRoom, voice.participants, voice.localCameraStream, user])

  // ---------- jogo / som do soundboard embaixo do nome ----------
  const soundRef = useRef(new Map<string, { name: string; until: number }>())
  const [soundTick, setSoundTick] = useState(0)
  useEffect(() => {
    const onPlay = (e: Event) => {
      const d = (e as CustomEvent<{ userId?: string; name?: string | null }>).detail
      if (!d?.userId) return
      soundRef.current.set(d.userId, { name: d.name || 'som', until: Date.now() + 3500 })
      officeRef.current?.emote(d.userId, '🎵')
      setSoundTick((n) => n + 1)
      setTimeout(() => setSoundTick((n) => n + 1), 3600)
    }
    window.addEventListener('mv:soundboard-play', onPlay)
    return () => window.removeEventListener('mv:soundboard-play', onPlay)
  }, [])
  useEffect(() => {
    const office = officeRef.current
    if (!office) return
    const now = Date.now()
    for (const m of members) {
      const s = soundRef.current.get(m.user_id)
      const playing = m.user_id === user?.id ? profile?.playing : m.profile.playing
      const online = m.user_id === user?.id || onlineIds.has(m.user_id)
      office.setStatusLine(m.user_id, s && s.until > now ? `🎵 ${s.name}` : online && playing ? `🎮 ${playing}` : null)
    }
  }, [members, profile?.playing, onlineIds, soundTick, user?.id])

  useEffect(() => {
    officeRef.current?.setSpeaking(new Set(speakingKey ? speakingKey.split(',') : []))
  }, [speakingKey])

  // ---------- visual: no aparelho na hora, no perfil com calma ----------
  const skinSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstSkinRef = useRef(true)
  useEffect(() => {
    officeRef.current?.setMySkin(skin)
    try {
      localStorage.setItem(SKIN_KEY, JSON.stringify({ ...skin, _at: Date.now() }))
    } catch {
      // sem armazenamento
    }
    if (firstSkinRef.current) {
      firstSkinRef.current = false
      // perfil ainda sem visual: sobe o que está no aparelho (1 vez)
      if (profile && !cleanSkin(profile.office_skin) && user) {
        void supabase.from('profiles').update({ office_skin: { ...skin, _at: Date.now() } }).eq('id', user.id)
      }
      return
    }
    if (!user) return
    if (skinSaveRef.current) clearTimeout(skinSaveRef.current)
    skinSaveRef.current = setTimeout(() => {
      const clean: Record<string, unknown> = {}
      for (const k of SKIN_FIELDS) if (skin[k] !== undefined && skin[k] !== null) clean[k] = skin[k]
      clean._at = Date.now()
      void supabase.from('profiles').update({ office_skin: clean }).eq('id', user.id)
    }, 1500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin])

  // pausa quando a janela some (economiza bateria)
  useEffect(() => {
    const onVis = () => officeRef.current?.setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const overlayOpen = Boolean(tv || drawer || avatarMenu || dm || dmError || memberCard || createChannel || editChannel || moderate || eventsOpen)
  // Esc fecha o escritório; Enter abre o chat; 1–9 mandam emotes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.o3d .bigmap:not([hidden]), .mg, .k3d, .b3d')) return
      if (e.key === 'Escape') {
        if (emoteOpen) { setEmoteOpen(false); return }
        if (peopleOpen) { setPeopleOpen(false); return }
        if (overlayOpen || isTyping()) return
        onClose()
        return
      }
      if (overlayOpen || isTyping() || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Enter') { e.preventDefault(); focusChatRef.current(); return }
      const n = Number(e.key)
      if (n >= 1 && n <= OFFICE_EMOTES.length && e.code.startsWith('Digit')) { doEmoteRef.current(OFFICE_EMOTES[n - 1]); return }
      if (e.key.toLowerCase() === 'r') setEmoteOpen((v) => !v)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [overlayOpen, emoteOpen, peopleOpen, onClose])

  // ---------- chat: canal de texto do setor onde você está ----------
  const sectorGroup = layout.find((g) => g.id === zone?.sector) ?? null
  useEffect(() => {
    if (pinnedChat) return
    const first = sectorGroup?.text[0] ?? layout.find((g) => g.text.length)?.text[0]
    if (first && first.id !== chatChannelId) setChatChannelId(first.id)
  }, [sectorGroup, layout, pinnedChat, chatChannelId])
  const chatChannel = channels.find((c) => c.id === chatChannelId) ?? null
  const chatGroup = layout.find((g) => g.text.some((c) => c.id === chatChannelId)) ?? sectorGroup
  // só pros balões e pro "Desafiar no chat" (o chat completo é o ChatArea)
  const { messages, sendMessage } = useMessages(chatChannelId, server.id)

  // mensagem nova vira balão em cima de quem mandou
  const lastMsgId = useRef<string | null>(null)
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return
    if (lastMsgId.current && last.id !== lastMsgId.current && !last.system_event) {
      officeRef.current?.bubble(last.author_id, describeMessageContent(last.content).slice(0, 120))
    }
    lastMsgId.current = last.id
  }, [messages])

  // chat aberto = canal lido (a bolinha some na placa e no clássico)
  const chatUnread = chatChannelId ? Boolean(unreadChannelIds?.has(chatChannelId)) : false
  useEffect(() => {
    if (!chatChannelId || chatMode === 'mini') return
    window.dispatchEvent(new CustomEvent('mv:mark-channel-read', { detail: { channelId: chatChannelId } }))
  }, [chatChannelId, chatMode, chatUnread, messages.length])

  // bolinhas vermelhas nas placas dos setores
  useEffect(() => {
    const map: Record<string, number> = {}
    if (unreadChannelIds) for (const g of layout) {
      const n = g.text.filter((c) => unreadChannelIds.has(c.id) && !(c.id === chatChannelId && chatMode !== 'mini')).length
      if (n) map[g.id] = n
    }
    officeRef.current?.setUnread(map)
  }, [unreadChannelIds, layout, chatChannelId, chatMode])

  // resultado dos minigames → chat aberto (desafio pra galera)
  shareRef.current = async (text: string) => {
    if (!chatChannelId) return
    await sendMessage(text, null)
  }

  // telão da recepção: você + amigos, últimos 7 dias
  useEffect(() => {
    const office = officeRef.current
    if (!office || usage === null) return
    office.setBoard({
      title: 'Tempo no Mamacos',
      subtitle: 'Você e seus amigos · últimos 7 dias',
      rows: usage === 'erro' ? [] : usage.filter((r) => r.seconds > 0 || r.userId === user?.id).map((r) => ({ name: r.name, seconds: r.seconds, me: r.userId === user?.id })),
      empty: usage === 'erro' ? 'Ranking indisponível por enquanto.' : undefined,
    })
  }, [usage, user?.id])

  // eventos do servidor no telão (alterna com o ranking)
  useEffect(() => {
    const now = Date.now()
    const list = events
      .filter((e) => new Date(e.starts_at).getTime() >= now - 2 * 3600e3)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
      .slice(0, 5)
      .map((e) => ({
        name: e.name,
        startsAt: e.starts_at,
        where: e.channel_id ? (channels.find((c) => c.id === e.channel_id)?.name ?? null) : null,
        going: rsvpsByEvent[e.id]?.length ?? 0,
      }))
    officeRef.current?.setEvents(list)
  }, [events, rsvpsByEvent, channels])

  async function openDm(userId: string) {
    const m = members.find((x) => x.user_id === userId)
    if (!m) return
    setDmError(null)
    const { conversation, error } = await openConversationWith(userId)
    if (error || !conversation) { setDmError(error ?? 'Não deu pra abrir a conversa.'); return }
    setDm({ conversationId: conversation.id, profile: m.profile })
  }

  const connectedHere = voice.connectedServerId === server.id && voice.connectedChannelId
  const connectedName = connectedHere ? channels.find((c) => c.id === voice.connectedChannelId)?.name : null
  const zoneChannel = zone?.kind === 'room' ? (channels.find((c) => c.id === zone.id) ?? null) : null
  const membersById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m.profile])) as Record<string, Profile>, [members])
  const sortedCategories = useMemo(() => [...categories].sort((a, b) => a.position - b.position), [categories])

  const chatBox =
    chatMode === 'big'
      ? 'left-4 top-16 bottom-4 w-[min(760px,calc(100%-2rem))] max-sm:top-28'
      : 'left-4 bottom-4 w-[400px] max-w-[calc(100%-2rem)] h-[min(460px,calc(100%-9rem))] max-sm:h-[52%]'

  return (
    <div className="fixed inset-0 z-[70] bg-[#0c0a10] text-mv-text" role="dialog" aria-label="Modo Escritório">
      <div ref={hostRef} className="absolute inset-0" />

      <div className="absolute top-3 left-4 z-[30] flex items-center gap-2 flex-wrap max-w-[calc(100%-2rem)]">
        <div className="rounded-xl bg-black/50 backdrop-blur">
          <ViewModeToggle mode="escritorio" onChange={onClose} />
        </div>
        <span className="h-9 px-3 rounded-xl bg-black/50 border border-white/10 text-[13px] font-semibold flex items-center gap-2 backdrop-blur">
          {server.name}
          <span className="text-[10px] font-bold uppercase tracking-wider text-mv-accent">beta</span>
        </span>
        {zone && (
          <span className="h-9 pl-3 pr-1.5 rounded-xl bg-black/50 border border-white/10 text-[13px] font-semibold flex items-center gap-1.5 backdrop-blur">
            {zone.name}
            {zone.id === 'special:minigames' && !minigamesChannel && canManageChannels && (
              <button
                onClick={() => void createChannelNow("Minigames", "voice", null)}
                className="h-7 px-2 rounded-lg text-[12px] font-semibold text-mv-accent hover:bg-white/10"
                title="Cria o canal de voz Minigames: quem entrar nesta sala entra na call"
              >
                Virar call
              </button>
            )}
            {zoneChannel && canManageChannels && (
              <button onClick={() => setEditChannel(zoneChannel)} className="h-7 px-2 rounded-lg text-[12px] text-mv-muted hover:text-white hover:bg-white/10" title="Editar ou apagar esta sala">
                Editar
              </button>
            )}
          </span>
        )}
      </div>

      {connectedHere && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[30] flex items-center gap-2 px-3 py-2 rounded-2xl bg-black/70 border border-emerald-400/40 backdrop-blur max-w-[calc(100%-2rem)] max-sm:top-14 max-sm:left-4 max-sm:translate-x-0">
          <div className="leading-tight min-w-0">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-emerald-400">Em call</p>
            <p className="text-[13.5px] font-semibold text-white truncate">{connectedName}</p>
          </div>
          <button onClick={voice.toggleMute} className={`h-8 px-3 rounded-lg text-[12.5px] font-semibold border ${voice.muted ? 'bg-rose-500/20 border-rose-400/50 text-rose-200' : 'bg-white/10 border-white/10 text-white'}`}>
            {voice.muted ? 'Mudo' : 'Mic'}
          </button>
          {sharers.some((x) => x.key !== 'local') && (
            <button
              onClick={toggleTv}
              className={`h-8 px-3 rounded-lg text-[12.5px] font-semibold border ${remoteWatched ? 'bg-white/10 border-white/10 text-white' : 'bg-rose-500/20 border-rose-400/50 text-rose-100'}`}
              title={remoteWatched ? 'Para de receber a transmissão' : 'Passa a tela compartilhada na TV da sala'}
            >
              {remoteWatched ? 'Desligar TV' : '● Ver na TV'}
            </button>
          )}
          <button
            onClick={() => {
              // sai da call na hora (não espera o boneco passar pela porta)
              voice.leave()
              officeRef.current?.leaveRoom()
            }}
            className="h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-rose-600 text-white"
          >
            Sair
          </button>
        </div>
      )}

      <div className="absolute right-4 top-[172px] max-sm:top-[160px] z-[30] w-[240px] max-sm:w-[150px] grid grid-cols-2 max-sm:grid-cols-1 gap-1.5">
        <button onClick={() => officeRef.current?.openMap()} className="h-9 rounded-xl bg-black/60 border border-white/10 text-[13px] font-semibold text-white backdrop-blur">Mapa (M)</button>
        <button onClick={() => setDrawer((v) => !v)} aria-pressed={drawer} className="h-9 rounded-xl bg-black/60 border border-white/10 text-[13px] font-semibold text-white backdrop-blur aria-pressed:border-mv-accent">Meu mamaco</button>
        <button onClick={() => setPeopleOpen((v) => !v)} aria-pressed={peopleOpen} className="h-9 rounded-xl bg-black/60 border border-white/10 text-[13px] font-semibold text-white backdrop-blur aria-pressed:border-mv-accent">Pessoas</button>
        <button onClick={() => setEventsOpen(true)} className="h-9 rounded-xl bg-black/60 border border-white/10 text-[13px] font-semibold text-white backdrop-blur">Eventos</button>
        {canManageChannels && (
          <button onClick={() => setCreateChannel({ categoryId: zone?.sector && categories.some((c) => c.id === zone.sector) ? zone.sector : null })} className="col-span-2 max-sm:col-span-1 h-9 rounded-xl bg-black/60 border border-white/10 text-[13px] font-semibold text-white backdrop-blur">
            + Criar canal
          </button>
        )}
        <button onClick={() => openGames(null)} className="col-span-2 max-sm:col-span-1 h-9 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-rose-500 to-mv-accent">
          Minigames
        </button>
      </div>

      {/* emotes: botão + teclas 1–9 (R abre a roda) */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[31] flex flex-col items-center gap-2 max-sm:bottom-[calc(52%+1.5rem)]">
        {emoteOpen && (
          <div className="flex gap-1 p-1.5 rounded-2xl bg-black/75 border border-white/10 backdrop-blur" role="menu" aria-label="Emotes">
            {OFFICE_EMOTES.map((e, i) => (
              <button key={e} role="menuitem" onClick={() => doEmote(e)} className="relative w-10 h-10 rounded-xl text-[22px] hover:bg-white/10" title={`Tecla ${i + 1}`}>
                {e}
                <span className="absolute right-0.5 bottom-0 text-[9px] font-bold text-white/40">{i + 1}</span>
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setEmoteOpen((v) => !v)} aria-pressed={emoteOpen} className="h-9 px-3 rounded-xl bg-black/60 border border-white/10 text-[13px] font-semibold text-white backdrop-blur aria-pressed:border-mv-accent" title="Emotes (R)">
          😀 Emotes
        </button>
      </div>

      {/* chat do setor: o mesmo chat do clássico (respostas, reações, anexos, GIF, figurinhas, menções…) */}
      {chatMode === 'mini' ? (
        <button
          onClick={() => setChatMode('open')}
          className="absolute left-4 bottom-4 z-[30] h-10 px-3.5 rounded-xl bg-black/70 border border-white/10 backdrop-blur text-[13px] font-semibold text-white flex items-center gap-2"
        >
          💬 {chatChannel ? `#${chatChannel.name}` : 'Chat'}
          {layout.some((g) => g.text.some((c) => unreadChannelIds?.has(c.id))) && <span className="w-2 h-2 rounded-full bg-rose-500" aria-label="mensagens novas" />}
        </button>
      ) : (
        <section ref={chatBoxRef} className={`absolute z-[30] flex flex-col rounded-2xl overflow-hidden bg-mv-main border border-white/10 shadow-2xl ${chatBox}`} aria-label="Chat do setor">
          <header className="flex items-center gap-1 px-2 py-1.5 bg-black/40 border-b border-white/10">
            <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
              {(chatGroup?.text ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setChatChannelId(c.id); setPinnedChat(true) }}
                  className={`shrink-0 px-2 py-0.5 rounded-md text-[12.5px] font-bold flex items-center gap-1 ${c.id === chatChannelId ? 'bg-white/10 text-white' : 'text-mv-muted hover:text-white'}`}
                >
                  # {c.name}
                  {c.id !== chatChannelId && unreadChannelIds?.has(c.id) && <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />}
                </button>
              ))}
              {pinnedChat && (
                <button onClick={() => setPinnedChat(false)} className="shrink-0 px-1.5 text-[11px] text-mv-muted hover:text-white" title="Voltar a seguir o setor onde você está">
                  seguir setor
                </button>
              )}
            </div>
            <button onClick={() => setChatMode(chatMode === 'big' ? 'open' : 'big')} className="w-7 h-7 rounded-lg text-mv-muted hover:text-white hover:bg-white/10 text-[13px]" aria-label={chatMode === 'big' ? 'Diminuir chat' : 'Aumentar chat'}>
              {chatMode === 'big' ? '⤡' : '⤢'}
            </button>
            <button onClick={() => setChatMode('mini')} className="w-7 h-7 rounded-lg text-mv-muted hover:text-white hover:bg-white/10 text-[15px] leading-none" aria-label="Minimizar chat">–</button>
          </header>
          <div className="flex-1 min-h-0 flex [&>section]:border-0">
            {chatChannel ? (
              <ChatArea channel={chatChannel} server={server} onViewProfile={requestViewProfile} onJumpToChannel={(c) => { if (c.type === 'text') { setChatChannelId(c.id); setPinnedChat(true) } else onSelectChannel(c) }} />
            ) : (
              <p className="p-4 text-[13px] text-mv-muted">Sem canal de texto neste setor.</p>
            )}
          </div>
        </section>
      )}

      {peopleOpen && (
        <div className="absolute right-4 top-16 bottom-4 z-[52] w-64 max-w-[calc(100%-2rem)] rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex bg-mv-side">
          <button onClick={() => setPeopleOpen(false)} className="absolute top-2 right-2 z-10 w-7 h-7 rounded-lg bg-black/40 text-white leading-none max-lg:hidden" aria-label="Fechar pessoas">×</button>
          <MemberList
            serverId={server.id}
            onViewProfile={requestViewProfile}
            onMessageUser={(id) => void openDm(id)}
            desktopOpen
            mobileOpen={typeof window !== 'undefined' && window.innerWidth < 1024}
            onCloseMobile={() => setPeopleOpen(false)}
          />
        </div>
      )}

      {drawer && (
        <SkinStudio
          skin={skin}
          name={myName}
          stats={stats}
          onChange={setSkin}
          onClose={() => setDrawer(false)}
        />
      )}

      {/* controles do clássico: microfone, fone, compartilhar tela, sair, configurações */}
      <div className="absolute right-4 bottom-4 z-[30] w-[300px] max-sm:hidden rounded-2xl bg-[#121016]/95 border border-white/10 backdrop-blur overflow-hidden flex flex-col">
        <UserPanel />
      </div>

      {memberCard && <VoiceMemberCard target={memberCard} onClose={() => setMemberCard(null)} />}

      {avatarMenu && (() => {
        const m = members.find((x) => x.user_id === avatarMenu.userId)
        if (!m) return null
        const name = m.nickname || m.profile.display_name || m.profile.username
        const inMyCall = Boolean(myRoom && voice.participants[avatarMenu.userId])
        const callId = roster.get(avatarMenu.userId) ?? (inMyCall ? myRoom : null)
        const isMe = avatarMenu.userId === user?.id
        const close = () => setAvatarMenu(null)
        const left = Math.min(avatarMenu.x, window.innerWidth - 236)
        const top = Math.min(avatarMenu.y, window.innerHeight - 300)
        const playing = isMe ? profile?.playing : m.profile.playing
        return (
          <div className="absolute inset-0 z-[60]" onClick={close}>
            <div
              className="absolute w-[220px] rounded-2xl bg-[#16131c] border border-white/10 shadow-2xl p-2 flex flex-col gap-1"
              style={{ left, top }}
              onClick={(e) => e.stopPropagation()}
              role="menu"
            >
              <div className="flex items-center gap-2 px-2 py-1.5">
                {m.profile.avatar_url ? <img src={m.profile.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" /> : <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[13px] font-bold">{name.slice(0, 1).toUpperCase()}</span>}
                <div className="min-w-0">
                  <b className="block text-[13.5px] truncate">{name}</b>
                  {playing && <span className="block text-[11px] text-violet-300 truncate">🎮 {playing}</span>}
                </div>
              </div>
              {!isMe && <MenuBtn onClick={() => { close(); void openDm(avatarMenu.userId) }}>Mensagem privada</MenuBtn>}
              {!isMe && (
                <MenuBtn onClick={() => { close(); officeRef.current?.wave(avatarMenu.userId); if (sendWave(avatarMenu.userId)) officeRef.current?.toast(`Você acenou pra ${name} 👋`) }}>
                  Acenar 👋
                </MenuBtn>
              )}
              {callId && <MenuBtn onClick={() => { close(); setMemberCard({ userId: avatarMenu.userId, serverId: server.id, channelId: callId, x: avatarMenu.x, y: avatarMenu.y }) }}>Volume, mover e opções da call</MenuBtn>}
              <MenuBtn onClick={() => { close(); requestViewProfile(m.profile) }}>Ver perfil</MenuBtn>
              {!isMe && canModerate && m.user_id !== server.owner_id && <MenuBtn onClick={() => { close(); setModerate(m.profile) }}>Moderar…</MenuBtn>}
            </div>
          </div>
        )
      })()}

      {/* conversa privada sem sair do escritório */}
      {(dm || dmError) && (
        <div className="absolute right-4 top-16 z-[55] w-[420px] max-w-[calc(100%-2rem)] h-[min(560px,calc(100%-6rem))] rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex flex-col bg-mv-main">
          <button onClick={() => { setDm(null); setDmError(null) }} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-lg bg-black/50 text-white text-lg leading-none" aria-label="Fechar conversa">×</button>
          {dm ? <DMChatArea key={dm.conversationId} conversationId={dm.conversationId} otherProfile={dm.profile} /> : <p className="p-4 text-[13px] text-rose-200">{dmError}</p>}
        </div>
      )}

      {tv && (
        <div className="absolute inset-0 z-[45] bg-black/70 flex items-center justify-center p-4" onClick={() => { setTv(null); officeRef.current?.setPaused(false) }}>
          <div className="w-[min(900px,100%)] rounded-2xl bg-[#0c0a10] border border-white/10 p-3 flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center">
              <b className="font-display">{tv.room ? `TV · ${tv.room.name}` : 'TV'}</b>
              <button className="ml-auto text-mv-muted text-2xl leading-none px-1" aria-label="Fechar TV" onClick={() => { setTv(null); officeRef.current?.setPaused(false) }}>×</button>
            </div>
            <TvScreen image={tv.image} />
            {tv.room?.voice && (
              <p className="text-[12.5px] text-mv-muted">
                {tv.room.id === myRoom
                  ? 'Ninguém está compartilhando a tela nessa call agora. Quando alguém compartilhar, aparece "AO VIVO" nesta TV — aperte F pra assistir aqui.'
                  : 'Entre nessa sala (na call) pra ver aqui a tela que alguém estiver compartilhando.'}
              </p>
            )}
          </div>
        </div>
      )}

      {createChannel && (
        <CreateChannelModal categories={sortedCategories} defaultCategoryId={createChannel.categoryId} defaultType="voice" onClose={() => setCreateChannel(null)} />
      )}
      {editChannel && <EditChannelModal channel={editChannel} serverId={server.id} onClose={() => setEditChannel(null)} />}
      {moderate && <ManageMemberModal serverId={server.id} targetProfile={moderate} onClose={() => setModerate(null)} />}
      {eventsOpen && <EventsModal serverId={server.id} channels={channels} canCreate={canManageChannels} membersById={membersById} onClose={() => setEventsOpen(false)} />}
    </div>
  )
}

function MenuBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className="h-9 px-2.5 rounded-lg text-left text-[13px] font-semibold text-mv-text hover:bg-white/10">
      {children}
    </button>
  )
}
function TvScreen({ image }: { image: HTMLCanvasElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !image) return
    c.width = image.width
    c.height = image.height
    c.getContext('2d')?.drawImage(image, 0, 0)
  }, [image])
  return <canvas ref={ref} className="w-full aspect-[16/10] rounded-lg border-[6px] border-[#141317] bg-black" />
}
// ---------- Estúdio "Meu mamaco" ----------
type StudioTab = 'skins' | 'cabeca' | 'costas' | 'pelo' | 'conquistas'
const HEAD_ITEMS: { id: string; label: string; kind: 'hat' | 'glasses' | 'headset' }[] = [
  ...Object.entries(HAT_LABELS).map(([id, label]) => ({ id, label, kind: 'hat' as const })),
  { id: 'glasses', label: 'Óculos', kind: 'glasses' },
  { id: 'headset', label: 'Fone', kind: 'headset' },
]
const FUR_NAMES: Record<string, string> = { '#7a4529': 'Marrom', '#a8683f': 'Caramelo', '#8a5a3c': 'Canela', '#5d5a63': 'Cinza', '#2f2724': 'Preto', '#c99a45': 'Dourado', '#e6ddd2': 'Neve' }

export function SkinStudio({ skin, name, stats = {}, onChange, onClose }: { skin: OfficeSkin; name: string; stats?: Record<string, number>; onChange: (fn: (s: OfficeSkin) => OfficeSkin) => void; onClose: () => void }) {
  const [tab, setTab] = useState<StudioTab>('skins')
  const stageRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<ReturnType<typeof createSkinPreview> | null>(null)
  useEffect(() => {
    if (!stageRef.current) return
    const p = createSkinPreview(stageRef.current, skin)
    previewRef.current = p
    return () => { p.dispose(); previewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { previewRef.current?.set(skin) }, [skin])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const skins = Object.entries(FOFO_SKINS).filter(([, o]) => !o.hidden)
  const current = FOFO_SKINS[skin.outfit || 'base']
  const tabs: [StudioTab, string][] = [['skins', 'Skins'], ['cabeca', 'Cabeça'], ['costas', 'Costas'], ['pelo', 'Pelo'], ['conquistas', 'Conquistas']]
  const unlocked = ACHIEVEMENTS.filter((a) => (stats[a.stat] ?? 0) >= a.goal).length

  const card = (key: string, label: string, on: boolean, thumb: OfficeSkin, onClick: () => void, disabled = false) => (
    <button
      key={key}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`group relative flex flex-col items-center rounded-2xl border p-1.5 pb-2 transition ${on ? 'border-mv-accent bg-mv-accent/15 shadow-[0_0_0_3px_rgba(244,81,30,.18)]' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'} disabled:opacity-35 disabled:cursor-not-allowed`}
    >
      <img src={skinThumb(thumb, 112)} alt="" className="w-full aspect-square rounded-xl bg-gradient-to-b from-white/[0.07] to-transparent" draggable={false} />
      <span className="mt-1 text-[12px] font-semibold text-white truncate max-w-full">{label}</span>
      {on && <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-mv-accent text-white text-[11px] font-bold flex items-center justify-center">✓</span>}
    </button>
  )

  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-[920px] max-w-full h-[600px] max-h-full rounded-3xl bg-[#16131c] border border-white/10 shadow-2xl overflow-hidden grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] max-md:grid-cols-1 max-md:grid-rows-[220px_minmax(0,1fr)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Meu mamaco"
      >
        <div className="relative bg-[radial-gradient(120%_90%_at_50%_30%,#2f2a3d,#15121b)]">
          <div ref={stageRef} className="absolute inset-0" />
          <div className="absolute left-4 top-4 pointer-events-none">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">Meu mamaco</p>
            <p className="font-display text-[22px] font-extrabold text-white leading-tight">{name}</p>
            <p className="text-[13px] text-mv-accent font-semibold">{current?.label ?? 'Sem roupa'}</p>
          </div>
          <p className="absolute bottom-3 left-0 right-0 text-center text-[11.5px] text-white/45 pointer-events-none max-md:hidden">Arraste pra girar</p>
        </div>
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-1 px-4 pt-4 overflow-x-auto">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id} className={`shrink-0 h-9 px-3.5 rounded-xl text-[13px] font-semibold transition ${tab === id ? 'bg-white text-[#1b1622]' : 'text-white/70 hover:text-white hover:bg-white/5'}`}>
                {label}
              </button>
            ))}
            <button onClick={onClose} className="ml-auto w-9 h-9 rounded-xl text-white/60 hover:text-white hover:bg-white/5 text-xl leading-none" aria-label="Fechar">×</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {tab === 'skins' && (
              <div className="grid grid-cols-4 max-sm:grid-cols-3 gap-2">
                {skins.map(([id, o]) => card(id, o.label, (skin.outfit || 'base') === id, { ...skin, outfit: id, hat: o.coversHead ? null : skin.hat }, () => onChange((s) => ({ ...s, outfit: id, hat: o.coversHead ? null : s.hat }))))}
              </div>
            )}
            {tab === 'cabeca' && (
              <>
                {current?.coversHead && <p className="mb-3 text-[12.5px] text-white/60">A skin {current.label} já cobre a cabeça; chapéus ficam desligados com ela.</p>}
                <div className="grid grid-cols-4 max-sm:grid-cols-3 gap-2">
                  {HEAD_ITEMS.map((it) => {
                    const on = it.kind === 'hat' ? skin.hat === it.id || (it.id === 'cap' && skin.hat === 'capBack') : !!skin[it.kind]
                    const preview: OfficeSkin = it.kind === 'hat' ? { ...skin, hat: it.id } : { ...skin, [it.kind]: true }
                    const toggle = () => onChange((s) => (it.kind === 'hat' ? { ...s, hat: on ? null : it.id } : { ...s, [it.kind]: !on }))
                    return card(it.id, it.label, on, preview, toggle, it.kind === 'hat' && !!current?.coversHead)
                  })}
                </div>
              </>
            )}
            {tab === 'costas' && (
              <div className="grid grid-cols-4 max-sm:grid-cols-3 gap-2">
                {card('none', 'Nada', !skin.back, { ...skin, back: null }, () => onChange((s) => ({ ...s, back: null })))}
                {Object.entries(BACK_LABELS).map(([id, label]) => card(id, label, skin.back === id, { ...skin, back: id }, () => onChange((s) => ({ ...s, back: s.back === id ? null : id }))))}
              </div>
            )}
            {tab === 'conquistas' && (
              <div className="flex flex-col gap-2">
                <p className="text-[12.5px] text-white/60">{unlocked} de {ACHIEVEMENTS.length} desbloqueadas · ficam salvas neste aparelho.</p>
                {ACHIEVEMENTS.map((a) => {
                  const v = Math.min(a.goal, stats[a.stat] ?? 0)
                  const done = v >= a.goal
                  return (
                    <div key={a.id} className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${done ? 'border-amber-400/40 bg-amber-400/10' : 'border-white/10 bg-white/[0.03]'}`}>
                      <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-[22px] ${done ? 'bg-amber-400/20' : 'bg-white/5 grayscale opacity-60'}`}>{a.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-bold text-white">{a.name}</p>
                        <p className="text-[12px] text-white/55">{a.desc}</p>
                        {!done && a.goal > 1 && (
                          <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full bg-mv-accent" style={{ width: `${(v / a.goal) * 100}%` }} />
                          </div>
                        )}
                      </div>
                      <span className="text-[11.5px] font-semibold text-white/50 tabular-nums">{done ? '✓' : a.stat.endsWith('_best') ? `${v}/${a.goal}` : a.stat === 'walk' ? `${Math.floor(v)}/${a.goal} m` : `${v}/${a.goal}`}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {tab === 'pelo' && (
              <div className="grid grid-cols-4 max-sm:grid-cols-3 gap-2">
                {FUR.map((c) => card(c, FUR_NAMES[c] ?? c, skin.fur === c, { ...skin, fur: c, outfit: 'base', hat: null, back: null, glasses: false, headset: false }, () => onChange((s) => ({ ...s, fur: c }))))}
              </div>
            )}
          </div>
          <div className="px-4 py-3 border-t border-white/10 flex items-center gap-3">
            <p className="text-[11.5px] text-white/45 leading-snug">Salvo no seu perfil: todo mundo te vê assim no Escritório.</p>
            <button onClick={onClose} className="ml-auto h-10 px-5 rounded-xl text-[13.5px] font-bold text-white bg-gradient-to-r from-rose-500 to-mv-accent hover:brightness-110">Pronto</button>
          </div>
        </div>
      </div>
    </div>
  )
}

