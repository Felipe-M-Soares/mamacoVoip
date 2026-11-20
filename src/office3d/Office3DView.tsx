import { ViewModeToggle } from '../components/layout/ViewModeToggle'
import {
  AddChannelIcon,
  ArcadeIcon,
  CalendarIcon,
  EmoteIcon,
  GamepadIcon,
  LeaveCallIcon,
  MapIcon,
  MembersIcon,
  MessageIcon,
  MicIcon,
  MicOffIcon,
  MonkeyIcon,
  SoundboardIcon,
  TvIcon,
} from '../components/ui/hudIcons'
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
import { useFriendsUsage, type UsageRow } from '../hooks/useAppUsage'
import { useOfficeRealtime, OFFICE_EMOTES, type OfficeSignal } from './useOfficeRealtime'
import { loadMinigameRanking, submitMinigameResult } from './minigameRanking'
import { openKartNet, type KartRacer } from './kartRace'
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
  SHADES_LABELS,
  type MinigameResult,
  type KartNetOpts,
  type Office,
  type OfficeCategory,
  type OfficeMember,
  type OfficeSkin,
  type OfficeTvInfo,
  type OfficeZone,
} from './engine.js'

const CreateChannelModal = lazyModal(() => import('../components/modals/CreateChannelModal').then((m) => m.CreateChannelModal))
const EditChannelModal = lazyModal(() => import('../components/modals/EditChannelModal').then((m) => m.EditChannelModal))
const ManageMemberModal = lazyModal(() => import('../components/modals/ManageMemberModal').then((m) => m.ManageMemberModal))
const SoundboardPanel = lazyModal(() => import('../components/ui/SoundboardPanel').then((m) => m.SoundboardPanel))
const EventsModal = lazyModal(() => import('../components/modals/EventsModal').then((m) => m.EventsModal))

const PALETTE = ['#3b82f6', '#22c55e', '#ec4899', '#a78bfa', '#eab308', '#06b6d4', '#f97316', '#84cc16', '#e11d48']
const SKIN_KEY = 'mamacos-3d-skin-v2'
const FUR = ['#7a4529', '#a8683f', '#8a5a3c', '#5d5a63', '#2f2724', '#c99a45', '#e6ddd2']
const SKIN_FIELDS = ['fur', 'top', 'outfit', 'headset', 'glasses', 'hat', 'hatColor', 'back', 'shades'] as const

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
    shades: id(r.shades),
  }
}

const skinTime = (raw: unknown) => {
  const t = raw && typeof raw === 'object' ? Number((raw as { _at?: unknown })._at) : 0
  return Number.isFinite(t) ? t : 0
}
function loadSkin(userId: string, fromProfile: unknown): OfficeSkin {
  let local: OfficeSkin | null = null, localAt = 0
  try {
    const raw = localStorage.getItem(SKIN_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    local = cleanSkin(parsed)
    localAt = skinTime(parsed)
  } catch {
  }
  const p = cleanSkin(fromProfile)
  if (p && (!local || skinTime(fromProfile) > localAt)) return p
  return local ?? p ?? defaultSkin(userId)
}

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
  }
}

const isMinigamesName = (name: string) =>
  /mini ?games?|fliperama|arcade/.test(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())

function SFX_PING() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const c = new AC(), t = c.currentTime
    for (const [f, d] of [[784, 0], [1175, 0.12]] as const) {
      const o = c.createOscillator(), g = c.createGain()
      o.type = 'triangle'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.08, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25)
      o.connect(g); g.connect(c.destination); o.start(t + d); o.stop(t + d + 0.3)
    }
    setTimeout(() => void c.close(), 800)
  } catch {
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
  const canManageChannelsEarly = server.owner_id === user?.id || !!permissions.manage_channels
  const onlineIds = useOnlineIds()
  const roster = useVoiceRoster()
  const voice = useVoiceCore()
  const speakingKey = useVoiceSpeakingKey()
  const hostRef = useRef<HTMLDivElement>(null)
  const officeRef = useRef<Office | null>(null)
  const [zone, setZone] = useState<OfficeZone | null>(null)
  const [tv, setTv] = useState<OfficeTvInfo | null>(null)
  const [boardOpen, setBoardOpen] = useState(false)
  const [mySeat, setMySeat] = useState<{ kind: string; roomId: string | null; theme: string | null } | null>(null)
  const [cinema, setCinema] = useState(false)
  const [drawer, setDrawer] = useState(false)
  useEffect(() => { officeRef.current?.setPaused(drawer) }, [drawer])
  const [skin, setSkin] = useState<OfficeSkin>(() => loadSkin(user?.id ?? 'eu', profile?.office_skin))
  const [chatChannelId, setChatChannelId] = useState<string | null>(null)
  const [pinnedChat, setPinnedChat] = useState(false)
  const [chatMode, setChatMode] = useState<'mini' | 'open' | 'big'>('mini')
  const chatBoxRef = useRef<HTMLDivElement>(null)
  const [memberCard, setMemberCard] = useState<VoiceMemberCardTarget | null>(null)
  const [avatarMenu, setAvatarMenu] = useState<{ userId: string; x: number; y: number } | null>(null)
  const [dm, setDm] = useState<{ conversationId: string; profile: Profile } | null>(null)
  const [dmError, setDmError] = useState<string | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [emoteOpen, setEmoteOpen] = useState(false)
  const [createChannel, setCreateChannel] = useState<{ categoryId: string | null } | null>(null)
  const [editChannel, setEditChannel] = useState<Channel | null>(null)
  const [moderate, setModerate] = useState<Profile | null>(null)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [soundsOpen, setSoundsOpen] = useState(false)
  const [gameOpen, setGameOpen] = useState(false)
  const gameOpenRef = useRef(false)
  const { openConversationWith } = useConversations()
  const usage = useFriendsUsage(true)
  const { events, rsvpsByEvent } = useServerEvents(server.id)
  const { hidden } = useStreamView()
  const myName = profile?.display_name || profile?.username || 'Você'
  const isOwner = server.owner_id === user?.id
  const canManageChannels = isOwner || !!permissions.manage_channels
  const canModerate = isOwner || !!(permissions.kick_members || permissions.ban_members || permissions.timeout_members || permissions.manage_roles)

  const minigamesChannel = useMemo(
    () => channels.find((c) => c.type === 'voice' && isMinigamesName(c.name)) ?? null,
    [channels]
  )
  const mgTriedRef = useRef(false)
  useEffect(() => {
    if (minigamesChannel || !canManageChannelsEarly || mgTriedRef.current || channels.length === 0) return
    const key = `mamacos-mg-auto-${server.id}`
    try { if (localStorage.getItem(key)) return } catch {  }
    mgTriedRef.current = true
    void createChannelNow('Minigames', 'voice', null).then((res) => {
      if (!(res as { error?: unknown } | undefined)?.error) try { localStorage.setItem(key, '1') } catch {  }
    })
  }, [minigamesChannel, canManageChannelsEarly, channels.length, server.id, createChannelNow])
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
        voiceChannelId: isMe ? myVoice : present ? (roster.get(m.user_id) ?? null) : null,
        avatarUrl: p.avatar_url,
        skin: isMe ? undefined : (cleanSkin(p.office_skin) ?? undefined),
      }
    })
  }, [members, onlineIds, roster, voice.connectedChannelId, voice.connectedServerId, server.id, user?.id])

  const myRoom = voice.connectedServerId === server.id ? voice.connectedChannelId : null
  const sharers = useMemo(() => {
    const list: { key: string; stream: MediaStream }[] = []
    for (const [id, p] of Object.entries(voice.participants)) if (p.screenStream) list.push({ key: id, stream: p.screenStream })
    if (voice.screenSharing && voice.localScreenStream) list.push({ key: 'local', stream: voice.localScreenStream })
    return list
  }, [voice.participants, voice.screenSharing, voice.localScreenStream])
  const remoteWatched = sharers.find((x) => x.key !== 'local' && !hidden.has(x.key)) ?? null
  const shown = remoteWatched ?? sharers.find((x) => x.key === 'local') ?? null
  const tvOpened = useRef(new Map<string, StreamQuality>())

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

  const canCinema = !!mySeat && mySeat.theme === 'cinema' && !!myRoom && mySeat.roomId === myRoom && sharers.length > 0
  function openCinema() {
    const first = remoteWatched ?? sharers.find((x) => x.key !== 'local')
    if (first && first.key !== 'local') {
      if (!remoteWatched) {
        tvOpened.current.set(first.key, getStreamQuality(first.key))
        showStream(first.key)
      }
      const orig = tvOpened.current.get(first.key)
      if (orig) setStreamQuality(first.key, orig)
    }
    setCinema(true)
    officeRef.current?.setPaused(true)
  }
  const closeCinema = useCallback(() => {
    setCinema(false)
    officeRef.current?.setPaused(false)
    for (const [key, q] of tvOpened.current) if (q === 'auto') setStreamQuality(key, 'baixa')
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }, [])
  useEffect(() => {
    if (cinema && !canCinema) closeCinema()
  }, [cinema, canCinema, closeCinema])

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

  const nameOfId = useCallback((id: string) => {
    const m = members.find((x) => x.user_id === id)
    return m ? m.nickname || m.profile.display_name || m.profile.username : 'Alguém'
  }, [members])
  const nameOfIdRef = useRef(nameOfId)
  nameOfIdRef.current = nameOfId
  const onSignal = useCallback((s: OfficeSignal) => {
    const office = officeRef.current
    if (!office) return
    if (s.kind === 'kart') { kartSignalRef.current(s.from, s.type, s.d); return }
    if (s.kind === 'emote') office.emote(s.from, s.emoji)
    else {
      office.emote(s.from, '👋')
      if (s.to === user?.id) office.toast(`${nameOfIdRef.current(s.from)} acenou pra você 👋`)
    }
  }, [user?.id])
  const kartSignalRef = useRef<(from: string, type: string, d: Record<string, unknown>) => void>(() => {})
  const { sendEmote, sendWave, sendKart } = useOfficeRealtime(server.id, user?.id, onSignal)
  const doEmote = useCallback((emoji: string) => {
    if (!user) return
    officeRef.current?.emote(user.id, emoji)
    sendEmote(emoji)
  }, [user, sendEmote])
  const doEmoteRef = useRef(doEmote)
  doEmoteRef.current = doEmote

  const shareRef = useRef<(text: string) => Promise<void>>(async () => {})
  const latest = useRef({ channels, voice, layout, onSelectChannel, myRoom, live: sharers.length > 0, toggleTv, roster, members, share: (text: string) => void shareRef.current(text), onStat, onGameResult })
  latest.current = { channels, voice, layout, onSelectChannel, myRoom, live: sharers.length > 0, toggleTv, roster, members, share: (text: string) => void shareRef.current(text), onStat, onGameResult }

  function openGames(game: string | null, kartNet?: KartNetOpts | null, onDone?: () => void) {
    if (game === 'kart' && kartNet === undefined && roomPeers.length > 0 && !kartLobbyRef.current) { hostKartRace(); return }
    officeRef.current?.setPaused(true)
    gameOpenRef.current = true; setGameOpen(true)
    openMinigames(hostRef.current!, game, {
      onClose: () => { gameOpenRef.current = false; setGameOpen(false); officeRef.current?.setPaused(false); onDone?.() },
      kartNet,
      onShare: (text) => latest.current.share(text),
      onResult: (r) => latest.current.onGameResult(r),
      ranking: { load: (g) => loadMinigameRanking(g, user?.id) },
      skin: officeRef.current?.getMySkin(),
      name: myName,
    })
  }
  const openGamesRef = useRef(openGames)
  openGamesRef.current = openGames

  type KartLobby = { race: string; host: string; hostName: string; room: string; racers: KartRacer[]; role: 'host' | 'guest' | 'invited'; until: number }
  const [kartChoice, setKartChoice] = useState(false)
  const [kartLobby, setKartLobby] = useState<KartLobby | null>(null)
  const [nowTick, setNowTick] = useState(0)
  const kartLobbyRef = useRef(kartLobby)
  kartLobbyRef.current = kartLobby
  const roomPeers = useMemo(
    () => (myRoom ? [...roster.entries()].filter(([id, ch]) => ch === myRoom && id !== user?.id && onlineIds.has(id)).map(([id]) => id) : []),
    [myRoom, roster, onlineIds, user?.id]
  )
  const myRoomRef = useRef(myRoom)
  myRoomRef.current = myRoom
  const meRacer = (): KartRacer => ({ id: user!.id, name: myName, skin: (officeRef.current?.getMySkin() as unknown as Record<string, unknown>) ?? null })
  function startKartRace(lobby: KartLobby) {
    if (!user) return
    setKartLobby(null)
    const net = openKartNet(server.id, lobby.race, user.id, lobby.racers)
    openGames('kart', { me: net.me, seed: lobby.race, racers: lobby.racers.map((r) => ({ ...r, skin: cleanSkin(r.skin) })), send: net.send, on: net.on }, () => net.close())
  }
  function hostKartRace() {
    if (!user || !myRoom) return
    setKartChoice(false)
    const race = crypto.randomUUID()
    const lobby: KartLobby = { race, host: user.id, hostName: myName, room: myRoom, racers: [meRacer()], role: 'host', until: Date.now() + 10000 }
    setKartLobby(lobby)
    sendKart('invite', { race, room: myRoom, name: myName })
  }
  kartSignalRef.current = (from, type, d) => {
    const L = kartLobbyRef.current
    const race = typeof d.race === 'string' ? d.race : ''
    if (type === 'invite') {
      if (L || d.room !== myRoomRef.current || !race) return
      setKartLobby({ race, host: from, hostName: String(d.name || nameOfIdRef.current(from)).slice(0, 40), room: String(d.room), racers: [], role: 'guest', until: Date.now() + 10000 })
      sendKart('join', { race, name: myName, skin: meRacer().skin })
      SFX_PING()
      return
    }
    if (!L || L.race !== race) return
    if (type === 'join' && L.role === 'host') {
      if (L.racers.length >= 6 || L.racers.some((r) => r.id === from)) return
      const racers = [...L.racers, { id: from, name: String(d.name || nameOfIdRef.current(from)).slice(0, 40), skin: (d.skin as Record<string, unknown>) ?? null }]
      setKartLobby({ ...L, racers })
      sendKart('lobby', { race, racers })
    } else if (type === 'leave' && L.role === 'host') {
      const racers = L.racers.filter((r) => r.id !== from)
      setKartLobby({ ...L, racers })
      sendKart('lobby', { race, racers })
    } else if (type === 'lobby' && from === L.host && Array.isArray(d.racers)) {
      setKartLobby({ ...L, racers: d.racers as KartRacer[] })
    } else if (type === 'start' && from === L.host && Array.isArray(d.racers)) {
      const racers = (d.racers as KartRacer[]).slice(0, 6)
      if (L.role === 'guest' && racers.some((r) => r.id === user?.id)) startKartRace({ ...L, racers })
      else setKartLobby(null)
    } else if (type === 'cancel' && from === L.host) {
      setKartLobby(null)
      officeRef.current?.toast('A corrida foi cancelada')
    }
  }
  function launchKart() {
    const L = kartLobbyRef.current
    if (!L || L.role !== 'host') return
    if (L.racers.length < 2) { sendKart('cancel', { race: L.race }); setKartLobby(null); openGames('kart', null); return }
    sendKart('start', { race: L.race, racers: L.racers })
    startKartRace(L)
  }
  useEffect(() => {
    if (!kartLobby) return
    const iv = setInterval(() => {
      setNowTick((n) => n + 1)
      const L = kartLobbyRef.current
      if (!L || Date.now() < L.until) return
      if (L.role === 'host') {
        if (L.racers.length >= 2) launchKart()
        else { sendKart('cancel', { race: L.race }); setKartLobby(null); openGames('kart', null) }
      } else if (Date.now() > L.until + 15000) setKartLobby(null)
    }, 500)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kartLobby?.race])
  useEffect(() => {
    const L = kartLobbyRef.current
    if (L && L.room !== myRoom) {
      if (L.role === 'host') sendKart('cancel', { race: L.race })
      else if (L.role === 'guest') sendKart('leave', { race: L.race })
      setKartLobby(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRoom])

  function focusChat() {
    setChatMode((m) => (m === 'mini' ? 'open' : m))
    setTimeout(() => chatBoxRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 30)
  }
  const focusChatRef = useRef(focusChat)
  focusChatRef.current = focusChat

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
        } else if (!roomId && !gameOpenRef.current && v.connectedChannelId && v.connectedServerId === server.id) v.leave()
      },
      onZoneChange: (z) => setZone(z),
      onUseTv: (info) => {
        const L = latest.current
        if (info.live && info.room && info.room.id === L.myRoom) { L.toggleTv(); return }
        office.setPaused(true)
        setTv(info)
      },
      onBoardClick: () => setBoardOpen(true),
      onSeatChange: (seat) => setMySeat(seat),
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
      try { saveLastPos(server.id, office.getPlayerState()) } catch {  }
      office.dispose()
      officeRef.current = null
    }
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
        v.muted = true
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

  const skinSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstSkinRef = useRef(true)
  useEffect(() => {
    officeRef.current?.setMySkin(skin)
    try {
      localStorage.setItem(SKIN_KEY, JSON.stringify({ ...skin, _at: Date.now() }))
    } catch {
    }
    if (firstSkinRef.current) {
      firstSkinRef.current = false
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

  useEffect(() => {
    const onVis = () => officeRef.current?.setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const overlayOpen = Boolean(tv || drawer || avatarMenu || dm || dmError || memberCard || createChannel || editChannel || moderate || eventsOpen || soundsOpen)
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

  const sectorGroup = layout.find((g) => g.id === zone?.sector) ?? null
  useEffect(() => {
    if (pinnedChat) return
    const first = sectorGroup?.text[0] ?? layout.find((g) => g.text.length)?.text[0]
    if (first && first.id !== chatChannelId) setChatChannelId(first.id)
  }, [sectorGroup, layout, pinnedChat, chatChannelId])
  const chatChannel = channels.find((c) => c.id === chatChannelId) ?? null
  const chatGroup = layout.find((g) => g.text.some((c) => c.id === chatChannelId)) ?? sectorGroup
  const { messages, sendMessage } = useMessages(chatChannelId, server.id)

  const lastMsgId = useRef<string | null>(null)
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return
    if (lastMsgId.current && last.id !== lastMsgId.current && !last.system_event) {
      officeRef.current?.bubble(last.author_id, describeMessageContent(last.content).slice(0, 120))
    }
    lastMsgId.current = last.id
  }, [messages])

  const chatUnread = chatChannelId ? Boolean(unreadChannelIds?.has(chatChannelId)) : false
  useEffect(() => {
    if (!chatChannelId || chatMode === 'mini') return
    window.dispatchEvent(new CustomEvent('mv:mark-channel-read', { detail: { channelId: chatChannelId } }))
  }, [chatChannelId, chatMode, chatUnread, messages.length])

  useEffect(() => {
    const map: Record<string, number> = {}
    if (unreadChannelIds) for (const g of layout) {
      const n = g.text.filter((c) => unreadChannelIds.has(c.id) && !(c.id === chatChannelId && chatMode !== 'mini')).length
      if (n) map[g.id] = n
    }
    officeRef.current?.setUnread(map)
  }, [unreadChannelIds, layout, chatChannelId, chatMode])

  shareRef.current = async (text: string) => {
    if (!chatChannelId) return
    await sendMessage(text, null)
  }

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

      <div className="absolute top-3 left-4 z-[30] flex items-center gap-2 flex-wrap max-w-[calc(100%-2rem-272px)] max-sm:max-w-[calc(100%-2rem-162px)]">
        <div className="rounded-xl bg-black/50 backdrop-blur">
          <ViewModeToggle mode="escritorio" onChange={onClose} />
        </div>
        <span className="mv-hud h-9 px-3 text-[13px] font-semibold flex items-center gap-2">
          <span className="font-display tracking-wide">{server.name}</span>
          <span className="mv-tag !text-[9.5px] !px-1.5 !py-px">beta</span>
        </span>
        {zone && (
          <span className="mv-hud h-9 pl-2.5 pr-1.5 text-[13px] font-semibold flex items-center gap-1.5">
            <MapIcon className="w-4 h-4 text-[color-mix(in_oklab,var(--color-neon)_60%,white)]" aria-hidden />
            <span className="max-w-[180px] truncate">{zone.name}</span>
            {zone.id === 'special:minigames' && !minigamesChannel && canManageChannels && (
              <button
                onClick={() => void createChannelNow("Minigames", "voice", null)}
                className="btn-secondary h-7 px-2 text-[12px] font-semibold text-mv-accent"
                title="Cria o canal de voz Minigames: quem entrar nesta sala entra na call"
              >
                Virar call
              </button>
            )}
            {zoneChannel && canManageChannels && (
              <button onClick={() => setEditChannel(zoneChannel)} className="btn-secondary h-7 px-2 text-[12px] text-mv-muted hover:text-white" title="Editar ou apagar esta sala">
                Editar
              </button>
            )}
          </span>
        )}
        {connectedHere && (
          <div className={`${gameOpen ? 'fixed left-1/2 -translate-x-1/2 z-[80] bottom-16 max-sm:bottom-28' : ''} glass mv-ctl-bar flex items-center gap-1.5 pl-3 pr-1.5 py-1 max-w-full`}>
            <div className="leading-tight min-w-0 mr-1.5">
              <p className="flex items-center gap-1.5 font-display text-[10.5px] font-bold uppercase tracking-[0.14em] text-mv-green">
                <span className="mv-live-dot" aria-hidden />
                Em call
              </p>
              <p className="text-[13.5px] font-semibold text-white truncate max-w-[160px]">{connectedName}</p>
            </div>
            <button
              onClick={voice.toggleMute}
              aria-pressed={!voice.muted}
              className={`mv-hud-btn !h-9 !px-2.5 ${voice.muted ? 'is-off' : ''}`}
              title={voice.muted ? 'Ativar microfone' : 'Silenciar microfone'}
            >
              {voice.muted ? <MicOffIcon /> : <MicIcon />}
              <span className="max-sm:hidden">{voice.muted ? 'Mudo' : 'Mic'}</span>
            </button>
            <button onClick={() => setSoundsOpen(true)} className="mv-hud-btn !h-9 !px-2.5" title="Soundboard">
              <SoundboardIcon />
              <span className="max-sm:hidden">Sons</span>
            </button>
            {sharers.some((x) => x.key !== 'local') && (
              <button
                onClick={toggleTv}
                aria-pressed={!!remoteWatched}
                className="mv-hud-btn !h-9 !px-2.5"
                title={remoteWatched ? 'Para de receber a transmissão' : 'Passa a tela compartilhada na TV da sala'}
              >
                <TvIcon />
                {remoteWatched ? 'Desligar TV' : 'Ver na TV'}
              </button>
            )}
            <button
              onClick={() => {
                voice.leave()
                officeRef.current?.leaveRoom()
              }}
              className="mv-hud-btn is-danger !h-9 !px-2.5"
              title="Sair da call"
            >
              <LeaveCallIcon />
              <span className="max-sm:hidden">Sair</span>
            </button>
          </div>
        )}
      </div>

      <nav className="absolute right-4 top-[222px] max-sm:top-[236px] z-[30] w-[256px] max-sm:w-[150px] flex flex-col gap-1.5" aria-label="Ações do escritório">
        <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-1.5">
          <button onClick={() => officeRef.current?.openMap()} className="mv-hud-btn w-full !px-2.5 !gap-2 !text-[12.5px]" title="Mapa (M)">
            <MapIcon />
            <span className="flex-1 text-left">Mapa</span>
            <kbd className="mv-kbd max-sm:hidden">M</kbd>
          </button>
          <button onClick={() => setDrawer((v) => !v)} aria-pressed={drawer} className="mv-hud-btn w-full !px-2.5 !gap-2 !text-[12.5px]">
            <MonkeyIcon />
            <span className="flex-1 text-left whitespace-nowrap">Meu mamaco</span>
          </button>
          <button onClick={() => setPeopleOpen((v) => !v)} aria-pressed={peopleOpen} className="mv-hud-btn w-full !px-2.5 !gap-2 !text-[12.5px]">
            <MembersIcon />
            <span className="flex-1 text-left">Pessoas</span>
          </button>
          <button onClick={() => setEventsOpen(true)} className="mv-hud-btn w-full !px-2.5 !gap-2 !text-[12.5px]">
            <CalendarIcon />
            <span className="flex-1 text-left">Eventos</span>
          </button>
        </div>
        {canManageChannels && (
          <button onClick={() => setCreateChannel({ categoryId: zone?.sector && categories.some((c) => c.id === zone.sector) ? zone.sector : null })} className="mv-hud-btn w-full justify-center">
            <AddChannelIcon />
            Criar canal
          </button>
        )}
        <button onClick={() => openGames(null)} className="mv-hud-cta w-full">
          <ArcadeIcon />
          Minigames
        </button>
      </nav>

      <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[31] flex flex-col items-center gap-2 max-sm:bottom-[calc(52%+1.5rem)]">
        {emoteOpen && (
          <div className="mv-hud grid grid-cols-7 gap-1 p-1.5 [--cut:10px]" role="menu" aria-label="Emotes">
            {OFFICE_EMOTES.map((e, i) => (
              <button key={e} role="menuitem" onClick={() => doEmote(e)} className="mv-pad relative w-10 h-10 text-[22px] [--cut:6px]" title={i < 9 ? `Tecla ${i + 1}` : undefined}>
                {e}
                {i < 9 && <span className="absolute right-1 bottom-0.5 font-display text-[9px] font-bold text-white/45">{i + 1}</span>}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setEmoteOpen((v) => !v)} aria-pressed={emoteOpen} className="mv-hud-btn" title="Emotes (R)">
          <EmoteIcon />
          Emotes
          <kbd className="mv-kbd">R</kbd>
        </button>
      </div>

      {chatMode === 'mini' ? (
        <button onClick={() => setChatMode('open')} className="mv-hud-btn absolute left-4 bottom-4 z-[30] !h-10">
          <MessageIcon />
          {chatChannel ? `#${chatChannel.name}` : 'Chat'}
          {layout.some((g) => g.text.some((c) => unreadChannelIds?.has(c.id))) && <span className="w-2 h-2 rounded-full bg-mv-accent shadow-[0_0_8px_var(--color-mv-accent)]" aria-label="mensagens novas" />}
          <kbd className="mv-kbd max-sm:hidden">Enter</kbd>
        </button>
      ) : (
        <section ref={chatBoxRef} className={`surface-elevated absolute z-[30] flex flex-col overflow-hidden ${chatBox}`} aria-label="Chat do setor">
          <header className="mv-hud-header flex items-center gap-1 px-2 py-1.5 border-b border-[var(--color-line)]">
            <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
              {(chatGroup?.text ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setChatChannelId(c.id); setPinnedChat(true) }}
                  className={`shrink-0 h-7 px-2.5 rounded text-[12.5px] font-semibold flex items-center gap-1 transition-colors ${c.id === chatChannelId ? 'mv-seg-active' : 'text-mv-muted hover:text-white hover:bg-white/[0.05]'}`}
                >
                  <span className="opacity-60">#</span>{c.name}
                  {c.id !== chatChannelId && unreadChannelIds?.has(c.id) && <span className="w-1.5 h-1.5 rounded-full bg-mv-accent shadow-[0_0_6px_var(--color-mv-accent)]" />}
                </button>
              ))}
              {pinnedChat && (
                <button onClick={() => setPinnedChat(false)} className="shrink-0 h-7 px-2 rounded text-[11px] font-semibold text-mv-muted hover:text-white hover:bg-white/[0.05]" title="Voltar a seguir o setor onde você está">
                  Seguir setor
                </button>
              )}
            </div>
            <button onClick={() => setChatMode(chatMode === 'big' ? 'open' : 'big')} className="mv-close !w-7 !h-7" aria-label={chatMode === 'big' ? 'Diminuir chat' : 'Aumentar chat'} title={chatMode === 'big' ? 'Diminuir' : 'Aumentar'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden>
                {chatMode === 'big' ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
              </svg>
            </button>
            <button onClick={() => setChatMode('mini')} className="mv-close !w-7 !h-7" aria-label="Minimizar chat" title="Minimizar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="w-3.5 h-3.5" aria-hidden><path d="M5 12h14" /></svg>
            </button>
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
        <div className="surface-elevated absolute right-4 top-16 bottom-4 z-[52] w-64 max-w-[calc(100%-2rem)] overflow-hidden flex">
          <button onClick={() => setPeopleOpen(false)} className="mv-close absolute top-2 right-2 z-10 !w-7 !h-7 max-lg:hidden" aria-label="Fechar pessoas">
            <CloseGlyph />
          </button>
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

      <div className="glass mv-ctl-bar absolute right-4 bottom-4 z-[30] w-[300px] max-sm:hidden overflow-hidden flex flex-col">
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
              className="surface-elevated absolute w-[220px] p-1.5 flex flex-col gap-0.5"
              style={{ left, top }}
              onClick={(e) => e.stopPropagation()}
              role="menu"
            >
              <div className="flex items-center gap-2 px-2 py-1.5 mb-0.5 border-b border-[var(--color-line)]">
                {m.profile.avatar_url ? <img src={m.profile.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" /> : <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[13px] font-bold">{name.slice(0, 1).toUpperCase()}</span>}
                <div className="min-w-0">
                  <b className="block text-[13.5px] truncate">{name}</b>
                  {playing && <span className="flex items-center gap-1 text-[11px] text-mv-green truncate"><GamepadIcon className="w-3 h-3 shrink-0" aria-hidden />{playing}</span>}
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

      {(dm || dmError) && (
        <div className="surface-elevated absolute right-4 top-16 z-[55] w-[420px] max-w-[calc(100%-2rem)] h-[min(560px,calc(100%-6rem))] overflow-hidden flex flex-col">
          <button onClick={() => { setDm(null); setDmError(null) }} className="mv-close absolute top-3 right-3 z-10" aria-label="Fechar conversa">
            <CloseGlyph />
          </button>
          {dm ? <DMChatArea key={dm.conversationId} conversationId={dm.conversationId} otherProfile={dm.profile} /> : <p className="p-4 text-[13px] text-rose-200">{dmError}</p>}
        </div>
      )}

      {tv && (
        <div className="absolute inset-0 z-[45] bg-black/70 flex items-center justify-center p-4" onClick={() => { setTv(null); officeRef.current?.setPaused(false) }}>
          <div className="surface-elevated w-[min(900px,100%)] p-3 flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
              <span className="mv-badge-ico !w-8 !h-8" aria-hidden><TvIcon className="w-4 h-4" /></span>
              <b className="font-display text-[16px] tracking-wide">{tv.room ? `TV · ${tv.room.name}` : 'TV'}</b>
              <button className="mv-close ml-auto" aria-label="Fechar TV" onClick={() => { setTv(null); officeRef.current?.setPaused(false) }}>
                <CloseGlyph />
              </button>
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

      {canCinema && !cinema && (
        <button
          onClick={openCinema}
          className="mv-hud-cta absolute left-1/2 -translate-x-1/2 bottom-32 z-[60] !h-11 !px-5"
        >
          <TvIcon /> Assistir em tela cheia
        </button>
      )}

      {cinema && (
        <CinemaView
          stream={shown?.stream ?? null}
          label={shown ? `${shownName} · ${connectedName ?? 'Cinema'}` : 'Carregando a transmissão…'}
          onClose={closeCinema}
        />
      )}

      {boardOpen && (
        <BoardModal
          usage={usage}
          meId={user?.id ?? null}
          events={events
            .filter((e) => new Date(e.starts_at).getTime() >= Date.now() - 2 * 3600e3)
            .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
            .slice(0, 8)
            .map((e) => ({ id: e.id, name: e.name, startsAt: e.starts_at, where: e.channel_id ? (channels.find((c) => c.id === e.channel_id)?.name ?? null) : null, going: rsvpsByEvent[e.id]?.length ?? 0 }))}
          onClose={() => setBoardOpen(false)}
        />
      )}

      {kartChoice && (
        <div className="absolute inset-0 z-[58] bg-black/55 flex items-center justify-center p-4" onClick={() => setKartChoice(false)}>
          <div className="surface-elevated w-[min(380px,100%)] p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <b className="font-display text-[19px] tracking-wide">🏁 Kart 3D</b>
            <p className="text-[13px] text-mv-muted">Tem {roomPeers.length} pessoa{roomPeers.length === 1 ? '' : 's'} na call com você. Chame a sala pra correr junto (até 6 pilotos, bots completam) ou corra contra os bots.</p>
            <button onClick={hostKartRace} className="btn-primary h-11">Chamar a sala pra correr</button>
            <button onClick={() => { setKartChoice(false); openGames('kart', null) }} className="btn-secondary h-11">Correr sozinho (com bots)</button>
          </div>
        </div>
      )}

      {kartLobby && (() => {
        const L = kartLobby
        const secs = Math.max(0, Math.ceil((L.until - Date.now()) / 1000))
        void nowTick
        return (
          <div className="surface-elevated absolute left-1/2 -translate-x-1/2 top-16 z-[57] w-[min(360px,calc(100%-2rem))] p-4 flex flex-col gap-2.5 max-sm:top-28" role="status">
            {L.role === 'invited' ? (
              <>
                <p className="text-[14px] font-semibold">🏁 {L.hostName} chamou a sala pra uma corrida de kart!</p>
                <p className="text-[12px] text-mv-muted">Fecha em {secs}s</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setKartLobby({ ...L, role: 'guest' }); sendKart('join', { race: L.race, name: myName, skin: meRacer().skin }) }}
                    className="btn-primary flex-1 h-10"
                  >
                    Entrar na corrida
                  </button>
                  <button onClick={() => setKartLobby(null)} className="btn-secondary h-10 px-3">Agora não</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[14px] font-semibold">🏁 {L.role === 'host' ? `Corrida com a sala · largada em ${secs}s` : `${L.hostName} chamou a sala: você está na corrida! Largada em ${secs}s`}</p>
                <ul className="flex flex-col gap-1">
                  {L.racers.map((r, i) => (
                    <li key={r.id} className="flex items-center gap-2 text-[13px]"><span className="w-5 text-mv-muted">{i + 1}.</span>{r.name}{r.id === user?.id ? ' (você)' : ''}{r.id === L.host ? ' 👑' : ''}</li>
                  ))}
                  <li className="text-[12px] text-mv-muted">{Math.max(0, 6 - L.racers.length)} bot{6 - L.racers.length === 1 ? '' : 's'} completa{6 - L.racers.length === 1 ? '' : 'm'} a largada (6 karts)</li>
                </ul>
                <div className="flex gap-2">
                  {L.role === 'host' && (
                    <button onClick={launchKart} className="btn-primary flex-1 h-10">Largar agora</button>
                  )}
                  <button
                    onClick={() => { sendKart(L.role === 'host' ? 'cancel' : 'leave', { race: L.race }); setKartLobby(null) }}
                    className="btn-secondary h-10 px-3"
                  >
                    {L.role === 'host' ? 'Cancelar' : 'Não quero'}
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {createChannel && (
        <CreateChannelModal categories={sortedCategories} defaultCategoryId={createChannel.categoryId} defaultType="voice" onClose={() => setCreateChannel(null)} />
      )}
      {editChannel && <EditChannelModal channel={editChannel} serverId={server.id} onClose={() => setEditChannel(null)} />}
      {moderate && <ManageMemberModal serverId={server.id} targetProfile={moderate} onClose={() => setModerate(null)} />}
      {soundsOpen && voice.connectedServerId && <SoundboardPanel serverId={voice.connectedServerId} onClose={() => setSoundsOpen(false)} />}
      {eventsOpen && <EventsModal serverId={server.id} channels={channels} canCreate={canManageChannels} membersById={membersById} onClose={() => setEventsOpen(false)} />}
    </div>
  )
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="w-4 h-4" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function MenuBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className="h-9 px-2.5 rounded text-left text-[13px] font-semibold text-mv-text hover:text-white hover:bg-[color-mix(in_oklab,var(--color-mv-accent)_14%,transparent)] hover:shadow-[inset_2px_0_0_var(--color-mv-accent)] transition-colors">
      {children}
    </button>
  )
}
function CinemaView({ stream, label, onClose }: { stream: MediaStream | null; label: string; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const vidRef = useRef<HTMLVideoElement>(null)
  const [bar, setBar] = useState(true)
  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    if (v.srcObject !== stream) v.srcObject = stream
    if (stream) void v.play().catch(() => {})
  }, [stream])
  useEffect(() => {
    const el = boxRef.current
    if (el && !document.fullscreenElement) void el.requestFullscreen?.().catch(() => {})
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (!bar) return
    const t = setTimeout(() => setBar(false), 2500)
    return () => clearTimeout(t)
  }, [bar])
  return (
    <div ref={boxRef} className="fixed inset-0 z-[95] bg-black flex items-center justify-center" onMouseMove={() => setBar(true)}>
      <video ref={vidRef} muted playsInline autoPlay className="w-full h-full object-contain" />
      {!stream && <p className="absolute text-white/70 text-[15px]">Carregando a transmissão…</p>}
      <div className={`absolute top-0 inset-x-0 p-3 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${bar ? 'opacity-100' : 'opacity-0'}`}>
        <span className="w-2.5 h-2.5 rounded-full bg-red-500" aria-hidden />
        <b className="text-white text-[14px] truncate">{label}</b>
        <button onClick={onClose} className="mv-hud-btn ml-auto">Sair da tela cheia <kbd className="mv-kbd">Esc</kbd></button>
      </div>
    </div>
  )
}

const fmtHours = (sec: number) => {
  const m = Math.round(sec / 60)
  const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}min` : `${m}min`
}

function BoardModal({ usage, meId, events, onClose }: {
  usage: UsageRow[] | null | 'erro'
  meId: string | null
  events: { id: string; name: string; startsAt: string; where: string | null; going: number }[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const rows = Array.isArray(usage) ? usage.filter((r) => r.seconds > 0 || r.userId === meId).sort((a, b) => b.seconds - a.seconds) : []
  const max = Math.max(1, ...rows.map((r) => r.seconds))
  const total = rows.reduce((n, r) => n + r.seconds, 0)
  const myPos = rows.findIndex((r) => r.userId === meId)
  const medal = ['#f5c518', '#cbd5e1', '#d97706']
  return (
    <div className="absolute inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface-elevated w-[min(760px,100%)] max-h-[90%] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="mv-badge-ico" aria-hidden>🏆</span>
            <div className="min-w-0">
              <b className="font-display text-[21px] font-bold tracking-wide block leading-tight">Tempo no Mamacos</b>
              <p className="text-[12.5px] text-mv-muted">Você e seus amigos · últimos 7 dias</p>
            </div>
            <button className="mv-close ml-auto" aria-label="Fechar" onClick={onClose}><CloseGlyph /></button>
          </div>

          {usage === null && <p className="text-[13px] text-mv-muted">Carregando…</p>}
          {usage === 'erro' && <p className="text-[13px] text-mv-muted">Ranking indisponível por enquanto.</p>}
          {Array.isArray(usage) && !rows.length && <p className="text-[13px] text-mv-muted">Ainda sem dados — o ranking enche conforme o pessoal usa o app.</p>}

          {rows.length > 0 && (
            <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
              <div className="mv-pad p-3"><p className="text-[10.5px] uppercase tracking-wider text-mv-muted">Total da turma</p><b className="font-display text-[19px]">{fmtHours(total)}</b></div>
              <div className="mv-pad p-3"><p className="text-[10.5px] uppercase tracking-wider text-mv-muted">Sua posição</p><b className="font-display text-[19px]">{myPos >= 0 ? `${myPos + 1}º de ${rows.length}` : '—'}</b></div>
              <div className="mv-pad p-3"><p className="text-[10.5px] uppercase tracking-wider text-mv-muted">Você por dia</p><b className="font-display text-[19px]">{myPos >= 0 ? fmtHours(rows[myPos].seconds / 7) : '—'}</b></div>
            </div>
          )}

          <ol className="flex flex-col gap-1.5">
            {rows.map((r, i) => {
              const me = r.userId === meId
              return (
                <li key={r.userId} className={`flex items-center gap-3 rounded px-3 py-2 ${me ? 'mv-row-active' : 'bg-white/[0.03]'}`}>
                  <span className="w-7 h-7 shrink-0 rounded grid place-items-center font-display text-[12.5px] font-extrabold" style={{ background: medal[i] ?? '#3a3542', color: i < 3 ? '#1b1620' : '#fff' }}>{i + 1}</span>
                  {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="w-8 h-8 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" /> : <span className="w-8 h-8 shrink-0 rounded-full bg-white/10 grid place-items-center text-[13px] font-bold">{r.name.slice(0, 1).toUpperCase()}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <b className={`truncate text-[14px] ${me ? 'text-white' : 'text-white/90'}`}>{r.name}{me ? ' (você)' : ''}</b>
                      <span className="ml-auto text-[13px] font-bold tabular-nums">{fmtHours(r.seconds)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden"><div className={`h-full rounded-full ${me ? 'bg-mv-accent shadow-[0_0_8px_var(--color-mv-accent)]' : 'bg-white/35'}`} style={{ width: `${Math.max(2, (100 * r.seconds) / max)}%` }} /></div>
                      <span className="text-[11px] text-mv-muted tabular-nums w-[92px] text-right">≈ {fmtHours(r.seconds / 7)}/dia</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>

          {events.length > 0 && (
            <div className="flex flex-col gap-2">
              <b className="field-label !mb-0">Próximos eventos</b>
              {events.map((e) => {
                const d = new Date(e.startsAt)
                return (
                  <div key={e.id} className="mv-pad flex items-center gap-3 px-3 py-2">
                    <div className="w-12 shrink-0 rounded bg-[color-mix(in_oklab,var(--color-mv-accent)_14%,transparent)] text-center py-1">
                      <p className="text-[10px] font-extrabold text-mv-accent uppercase">{d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</p>
                      <p className="font-display text-[17px] font-black leading-tight">{d.toLocaleDateString('pt-BR', { day: '2-digit' })}</p>
                    </div>
                    <div className="min-w-0">
                      <b className="text-[14px] truncate block">{e.name}</b>
                      <p className="text-[12px] text-mv-muted truncate">{d.toLocaleString('pt-BR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}{e.where ? ` · ${e.where}` : ''} · {e.going} vão</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
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
  return <canvas ref={ref} className="w-full aspect-[16/10] rounded-md border-[6px] border-[#09090c] bg-black shadow-[0_0_0_1px_var(--color-line-strong)]" />
}
type StudioTab = 'skins' | 'cabeca' | 'costas' | 'pelo' | 'conquistas'
const HEAD_ITEMS: { id: string; label: string; kind: 'hat' | 'glasses' | 'headset' | 'shades' }[] = [
  ...Object.entries(HAT_LABELS).map(([id, label]) => ({ id, label, kind: 'hat' as const })),
  { id: 'glasses', label: 'Óculos', kind: 'glasses' },
  ...Object.entries(SHADES_LABELS).map(([id, label]) => ({ id, label, kind: 'shades' as const })),
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
      className={`mv-pick group relative flex flex-col items-center p-1.5 pb-2 ${on ? 'is-recommended' : ''} disabled:opacity-35 disabled:cursor-not-allowed`}
    >
      <img src={skinThumb(thumb, 112)} alt="" className="w-full aspect-square rounded bg-gradient-to-b from-white/[0.07] to-transparent" draggable={false} />
      <span className="mt-1 text-[12px] font-semibold text-white truncate max-w-full">{label}</span>
      {on && <span className="mv-tag absolute top-2 right-2 !px-1.5 !py-0 !text-[10px]">✓</span>}
    </button>
  )

  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="surface-elevated w-[920px] max-w-full h-[600px] max-h-full overflow-hidden grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] max-md:grid-cols-1 max-md:grid-rows-[220px_minmax(0,1fr)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Meu mamaco"
      >
        <div className="relative bg-[radial-gradient(120%_90%_at_50%_30%,color-mix(in_oklab,var(--color-mv-accent)_16%,#1a1a22),#0a0a0e)] border-r border-[var(--color-line)]">
          <div ref={stageRef} className="absolute inset-0" />
          <div className="absolute left-4 top-4 pointer-events-none">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">Meu mamaco</p>
            <p className="font-display text-[22px] font-bold tracking-wide text-white leading-tight">{name}</p>
            <p className="text-[13px] text-mv-accent font-semibold">{current?.label ?? 'Sem roupa'}</p>
          </div>
          <p className="absolute bottom-3 left-0 right-0 text-center text-[11.5px] text-white/45 pointer-events-none max-md:hidden">Arraste pra girar</p>
        </div>
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-1 px-4 pt-4 overflow-x-auto">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id} className={`shrink-0 h-9 px-3.5 rounded text-[13px] font-semibold transition-colors ${tab === id ? 'mv-seg-active' : 'text-white/70 hover:text-white hover:bg-white/5'}`}>
                {label}
              </button>
            ))}
            <button onClick={onClose} className="mv-close ml-auto shrink-0" aria-label="Fechar"><CloseGlyph /></button>
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
                    const on = it.kind === 'hat' ? skin.hat === it.id || (it.id === 'cap' && skin.hat === 'capBack') : it.kind === 'shades' ? skin.shades === it.id : !!skin[it.kind]
                    const preview: OfficeSkin = it.kind === 'hat' ? { ...skin, hat: it.id } : it.kind === 'shades' ? { ...skin, shades: it.id, glasses: false } : { ...skin, [it.kind]: true, ...(it.kind === 'glasses' ? { shades: null } : {}) }
                    const toggle = () => onChange((s) => (it.kind === 'hat' ? { ...s, hat: on ? null : it.id } : it.kind === 'shades' ? { ...s, shades: on ? null : it.id, glasses: false } : { ...s, [it.kind]: !on, ...(it.kind === 'glasses' && !on ? { shades: null } : {}) }))
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
                    <div key={a.id} className={`mv-pad flex items-center gap-3 px-3 py-2.5 ${done ? '!bg-amber-400/10 !shadow-[inset_0_0_0_1px_rgba(251,191,36,.4)]' : ''}`}>
                      <span className={`w-10 h-10 rounded flex items-center justify-center text-[22px] ${done ? 'bg-amber-400/20' : 'bg-white/5 grayscale opacity-60'}`}>{a.icon}</span>
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
                {FUR.map((c) => card(c, FUR_NAMES[c] ?? c, skin.fur === c, { ...skin, fur: c, outfit: 'base', hat: null, back: null, glasses: false, headset: false, shades: null }, () => onChange((s) => ({ ...s, fur: c }))))}
              </div>
            )}
          </div>
          <div className="px-4 py-3 border-t border-[var(--color-line)] flex items-center gap-3">
            <div className="min-w-0">
              <p className="text-[11.5px] text-white/45 leading-snug">Salvo no seu perfil: todo mundo te vê assim no Escritório.</p>
              <details className="text-[10.5px] text-white/35 leading-snug mt-0.5">
                <summary className="cursor-pointer hover:text-white/55 w-fit">Créditos dos modelos</summary>
                <p className="mt-1">Acessórios via poly.pizza (CC-BY 3.0): Poly by Google (coroa, chapéus de mago, pirata e xerife, asas de morcego), J-Toastie (óculos escuros), Marisha (máscara de gás), Casey Tumbers (quepe), Michael Fuchs (asas), TRASH - TANUKI (óculos pixel). Mochila e chapéu vivo: Quaternius (CC0). Cenários e móveis: Kenney e KayKit (CC0). Animações: Mixamo.</p>
              </details>
            </div>
            <button onClick={onClose} className="btn-primary ml-auto h-10 px-5 text-[13.5px]">Pronto</button>
          </div>
        </div>
      </div>
    </div>
  )
}
