import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import { useAuth } from '../../hooks/useAuth'
import { useChannels } from '../../hooks/useChannels'
import { useModeration } from '../../hooks/useModeration'
import { useVoiceCore, useVoiceSpeaking } from '../../hooks/useVoice'
import { requestWatchStream } from '../../lib/streamView'
import { useVoicePresence } from '../../hooks/useVoicePresence'
import { useChannelMutes } from '../../hooks/useChannelMutes'
import { useServerEvents } from '../../hooks/useServerEvents'
import { useServerWelcomeScreen, ServerWelcomeModal } from '../modals/ServerWelcomeModal'
import { ChannelSidebarSkeleton } from './ChannelSidebarSkeleton'
import { usePinnedItems } from '../../hooks/usePinnedItems'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useCollapsedCategories } from '../../hooks/useLocalOrganization'
import { Avatar } from '../ui/Avatar'
import type { Channel, Profile, Server } from '../../types/database'
import { lazyModal } from '../modals/lazyModal'
import { supabase } from '../../lib/supabase'
import {
  VOICE_MEMBER_DRAG_TYPE,
  canDropVoiceMemberOn,
  decodeVoiceMemberDrag,
  describeVoiceMoveError,
  encodeVoiceMemberDrag,
  isVoiceMemberDrag,
  type VoiceMemberDragPayload,
} from '../../lib/voiceMove'
import { AnnouncementIcon, BellOffIcon, CalendarIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, LockIcon, PinIcon, PlusIcon, ScreenShareIcon, SettingsIcon, TextChannelIcon, VoiceChannelIcon, WarningIcon } from '../ui/icons'
import { copyText } from '../../lib/copyText'
import { prefetchLiveKitToken } from '../../lib/livekit'
import { clearVoiceRoster, setVoiceRoster } from '../../lib/voiceRoster'
import { VoiceMemberCard, type VoiceMemberCardTarget } from './VoiceMemberCard'

// Modais/painéis carregados só quando abertos (fora do pacote inicial).
const InviteModal = lazyModal(() => import('../modals/InviteModal').then((m) => m.InviteModal))
const InviteFriendsModal = lazyModal(() => import('../modals/InviteFriendsModal').then((m) => m.InviteFriendsModal))
const ServerSettingsModal = lazyModal(() => import('../modals/ServerSettingsModal').then((m) => m.ServerSettingsModal))
const LeaveServerModal = lazyModal(() => import('../modals/LeaveServerModal').then((m) => m.LeaveServerModal))
const CreateChannelModal = lazyModal(() => import('../modals/CreateChannelModal').then((m) => m.CreateChannelModal))
const CreateCategoryModal = lazyModal(() => import('../modals/CreateCategoryModal').then((m) => m.CreateCategoryModal))
const EditChannelModal = lazyModal(() => import('../modals/EditChannelModal').then((m) => m.EditChannelModal))
const EventsModal = lazyModal(() => import('../modals/EventsModal').then((m) => m.EventsModal))
const RolesManagerModal = lazyModal(() => import('../modals/RolesManagerModal').then((m) => m.RolesManagerModal))
const ModerationLogModal = lazyModal(() => import('../modals/ModerationLogModal').then((m) => m.ModerationLogModal))

function CallDurationTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const label = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`

  return <span className="text-[11px] text-mv-green font-mono tabular-nums shrink-0">{label}</span>
}

function VoiceChannelPresence({
  channelId,
  profileById,
  userLimit,
  serverId,
  ownerId,
  canMoveMembers = false,
  isOwner = false,
  onMemberDragStart,
  onMemberDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  channelId: string
  profileById: Record<string, Profile>
  userLimit?: number
  // Mover membros entre salas (migration 014) — só pra quem pode.
  serverId?: string
  ownerId?: string
  canMoveMembers?: boolean
  isOwner?: boolean
  onMemberDragStart?: (payload: VoiceMemberDragPayload) => void
  onMemberDragEnd?: () => void
  // A lista de participantes também aceita o "soltar" (igual à linha do canal).
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (e: React.DragEvent) => void
}) {
  const { user, profile: ownProfile } = useAuth()
  const voice = useVoiceCore()
  const isConnectedHere = voice.connectedChannelId === channelId || voice.joiningChannelId === channelId

  // Pro canal que você já está conectado de verdade, usa a lista de
  // participantes que já vem da própria conexão — evita se inscrever
  // de novo no mesmo canal Realtime (o que quebrava ao voltar pra uma
  // sala em que você já estava).
  const observedIds = useVoicePresence(channelId, isConnectedHere)
  const [memberCard, setMemberCard] = useState<VoiceMemberCardTarget | null>(null)
  const userIds = isConnectedHere
    ? [user?.id, ...Object.keys(voice.participants)].filter((id): id is string => Boolean(id))
    : observedIds

  const rosterKey = userIds.join(',')
  useEffect(() => {
    setVoiceRoster(channelId, rosterKey ? rosterKey.split(',') : [])
    return () => clearVoiceRoster(channelId)
  }, [channelId, rosterKey])

  if (userIds.length === 0) return null
  return (
    <>
    {memberCard && <VoiceMemberCard target={memberCard} onClose={() => setMemberCard(null)} />}
    <div
      className="relative flex flex-col gap-px ml-[18px] pl-3 pb-1.5 pt-0.5 border-l border-[var(--color-line-strong)]"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {Boolean(userLimit) && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mv-muted px-1.5 pb-0.5 tabular-nums">
          {userIds.length}/{userLimit} pessoas
        </p>
      )}
      {userIds.map((id) => {
        // Você mesmo: usa o SEU perfil (sempre atualizado) — antes ficava
        // sem foto (só a inicial "V" de "Você").
        const p = id === user?.id ? (ownProfile ?? profileById[id]) : profileById[id]
        const name = id === user?.id ? 'Você' : p?.display_name || p?.username || '...'
        const isSharingScreen = id === user?.id ? voice.screenSharing : Boolean(voice.participants[id]?.screenStream)
        // Arrastar pra outra sala: não vale pra si mesmo (é só clicar no
        // outro canal) nem pro dono do servidor, se quem arrasta não é o dono.
        const movable = Boolean(canMoveMembers && serverId && id !== user?.id && (isOwner || id !== ownerId))
        return (
          <div
            key={id}
            draggable={movable}
            onDragStart={
              movable && serverId
                ? (e) => {
                    e.stopPropagation()
                    const payload = { userId: id, fromChannelId: channelId, serverId }
                    e.dataTransfer.setData(VOICE_MEMBER_DRAG_TYPE, encodeVoiceMemberDrag(payload))
                    e.dataTransfer.effectAllowed = 'move'
                    onMemberDragStart?.(payload)
                  }
                : undefined
            }
            onDragEnd={movable ? () => onMemberDragEnd?.() : undefined}
            onClick={
              serverId
                ? (e) => {
                    e.stopPropagation()
                    setMemberCard({ userId: id, serverId, channelId, x: e.clientX, y: e.clientY })
                  }
                : undefined
            }
            onContextMenu={
              serverId
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMemberCard({ userId: id, serverId, channelId, x: e.clientX, y: e.clientY })
                  }
                : undefined
            }
            title={movable ? `Clique para opções · arraste ${name} para outra sala` : `Opções de ${name}`}
            className={`flex items-center gap-2 rounded-md px-1.5 py-[3px] hover:bg-white/[0.06] transition-colors cursor-pointer ${
              movable ? 'active:cursor-grabbing' : ''
            }`}
          >
            {/* Só a FOTO pisca ao detectar áudio, não a linha inteira — a
                pessoa reclamou que antes o nome também "acendia" junto,
                o que distraía mais do que ajudava numa lista com vários
                nomes lado a lado. */}
            <SpeakingAvatarRing userId={id}>
              <Avatar name={p?.username ?? name} avatarUrl={p?.avatar_url} size={20} />
            </SpeakingAvatarRing>
            <span className="text-[13px] text-mv-muted truncate">{name}</span>
            {isSharingScreen && (
              // Clique no "Ao vivo" = abre a sala já assistindo essa
              // transmissão em destaque (não abre o cartão da pessoa).
              <button
                type="button"
                title={id === user?.id ? 'Ver sua transmissão' : `Assistir a transmissão de ${name}`}
                aria-label={id === user?.id ? 'Ver sua transmissão' : `Assistir a transmissão de ${name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (serverId) requestWatchStream(serverId, channelId, id === user?.id ? 'local' : id)
                }}
                className="shrink-0 ml-auto text-[9px] font-bold tracking-wide uppercase px-1.5 py-px rounded bg-rose-500 hover:bg-rose-400 text-white flex items-center gap-1 transition-colors"
              >
                <ScreenShareIcon className="w-2.5 h-2.5" aria-hidden />
                Ao vivo
              </button>
            )}
          </div>
        )
      })}
    </div>
    </>
  )
}

// Só este anel re-renderiza quando a pessoa começa/para de falar — antes a
// barra lateral inteira (todos os canais) era redesenhada a cada mudança.
function SpeakingAvatarRing({ userId, children }: { userId: string; children: ReactNode }) {
  const isSpeaking = useVoiceSpeaking(userId)
  return (
    <div
      className={`relative rounded-full shrink-0 transition-shadow ${
        isSpeaking ? 'ring-2 ring-mv-speaking ring-offset-1 ring-offset-mv-side' : ''
      }`}
    >
      {children}
    </div>
  )
}

function ChannelIcon({ type, isStage }: { type: 'text' | 'voice'; isStage?: boolean }) {
  if (type === 'voice' && isStage) {
    return (
      <AnnouncementIcon className="w-5 h-5 shrink-0 text-yellow-400" aria-hidden />
    )
  }
  if (type === 'voice') {
    return (
      <VoiceChannelIcon className="w-5 h-5 shrink-0" aria-hidden />
    )
  }
  return (
    <TextChannelIcon className="w-5 h-5 shrink-0 opacity-70" aria-hidden />
  )
}

function InlineEditableLabel({
  value,
  onSave,
  editable,
  className,
}: {
  value: string
  onSave: (value: string) => void
  editable: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function startEdit(e: React.MouseEvent) {
    if (!editable) return
    e.stopPropagation()
    setDraft(value)
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const cleaned = draft.trim()
    if (cleaned && cleaned !== value) onSave(cleaned)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className={`bg-mv-canvas text-mv-text rounded px-1 outline-none ring-1 ring-mv-accent ${className ?? ''}`}
      />
    )
  }

  return (
    <span onDoubleClick={startEdit} title={editable ? 'Clique duas vezes para renomear' : undefined} className={className}>
      {value}
    </span>
  )
}

function ChannelRow({
  channel,
  active,
  unread,
  muted,
  pinned,
  isOwner,
  isDragOver,
  onSelect,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onRename,
  onContextMenu,
}: {
  channel: Channel
  active: boolean
  unread: boolean
  muted: boolean
  pinned: boolean
  isOwner: boolean
  isDragOver: boolean
  onSelect: () => void
  onEdit: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onRename: (name: string) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const voice = useVoiceCore()
  // Canal de voz: pede o token de entrada ao parar o mouse em cima (ou
  // focar pelo teclado) — o clique encontra ele pronto.
  const hoverTimer = useRef<number | null>(null)
  const isVoice = channel.type === 'voice'
  const schedulePrefetch = () => {
    if (!isVoice || voice.connectedChannelId === channel.id || hoverTimer.current !== null) return
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      prefetchLiveKitToken(channel.id)
    }, 120)
  }
  const cancelPrefetch = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  return (
    <div
      data-tour={isVoice ? 'voice-channel' : undefined}
      onPointerEnter={isVoice ? schedulePrefetch : undefined}
      onPointerLeave={isVoice ? cancelPrefetch : undefined}
      onPointerDown={isVoice ? () => prefetchLiveKitToken(channel.id) : undefined}
      onFocus={isVoice ? schedulePrefetch : undefined}
      draggable={isOwner}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      className={`group relative flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[14px] font-medium transition-colors ${isOwner ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
        ${active ? 'bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]' : unread ? 'text-white hover:bg-white/[0.04]' : 'text-mv-muted hover:bg-white/[0.04] hover:text-mv-text'}
        ${isDragOver ? 'ring-2 ring-mv-accent' : ''}
      `}
      onClick={onSelect}
    >
      <ChannelIcon type={channel.type} isStage={channel.is_stage} />
      {pinned && (
        <span title="Canal fixado" className="shrink-0 text-yellow-400">
          <PinIcon className="w-3 h-3" aria-hidden />
        </span>
      )}
      {channel.is_spoiler && (
        <span title="Canal spoiler" className="shrink-0">
          <LockIcon className="w-3 h-3 text-yellow-400" aria-hidden />
        </span>
      )}
      {channel.is_restricted && (
        <span title="Canal restrito — só cargos específicos veem" className="shrink-0">
          <LockIcon className="w-3 h-3 text-mv-muted" aria-hidden />
        </span>
      )}
      <InlineEditableLabel
        value={channel.name}
        editable={isOwner}
        onSave={onRename}
        className="truncate flex-1 text-sm"
      />
      {channel.is_nsfw && (
        <span
          title="Canal com restrição de idade (+18)"
          aria-label="Canal +18"
          className="shrink-0 text-[9.5px] font-bold leading-none px-1 py-[3px] rounded-[5px] bg-rose-500/15 text-rose-300 tabular-nums"
        >
          +18
        </span>
      )}
      {unread && !active && !muted && <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-mv-text" />}
      {channel.type === 'voice' && voice.connectedChannelId === channel.id && voice.connectedAt && (
        <CallDurationTimer startedAt={voice.roomStartedAt ?? voice.connectedAt} />
      )}
      {muted && (
        <BellOffIcon className="w-3.5 h-3.5 text-mv-muted shrink-0" aria-hidden />
      )}

      {isOwner && (
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            title="Mover para cima"
            aria-label="Mover canal para cima"
            onClick={(e) => {
              e.stopPropagation()
              onMoveUp()
            }}
            className="w-5 h-5 flex items-center justify-center hover:text-white"
          >
            <ChevronUpIcon className="w-3.5 h-3.5" aria-hidden />
          </button>
          <button
            title="Mover para baixo"
            aria-label="Mover canal para baixo"
            onClick={(e) => {
              e.stopPropagation()
              onMoveDown()
            }}
            className="w-5 h-5 flex items-center justify-center hover:text-white"
          >
            <ChevronDownIcon className="w-3.5 h-3.5" aria-hidden />
          </button>
          <button
            title="Editar canal"
            aria-label="Editar canal"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="w-5 h-5 flex items-center justify-center hover:text-white"
          >
            <SettingsIcon className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}

export function ChannelSidebar({
  server,
  activeChannelId,
  unreadChannelIds,
  onSelectChannel,
  onServerDeleted,
  onServerLeft,
}: {
  server: Server
  activeChannelId: string | null
  unreadChannelIds: Set<string>
  onSelectChannel: (channel: Channel) => void
  onServerDeleted: () => void
  onServerLeft: () => void
}) {
  const { user } = useAuth()
  const isOwner = server.owner_id === user?.id
  const {
    categories,
    channels,
    loading: loadingChannels,
    loadError: channelsLoadError,
    refresh,
    moveChannel,
    moveChannelToCategory,
    moveCategory,
    updateCategory,
    updateChannel,
    deleteChannel,
  } = useChannels()
  const { permissions } = useModeration(server.id)
  const { members } = useServerMembers(server.id)
  const { mutedChannelIds, getLevel, setNotificationLevel } = useChannelMutes()
  const { events } = useServerEvents(server.id)
  const [showEvents, setShowEvents] = useState(false)
  const { show: showWelcome, dismiss: dismissWelcome } = useServerWelcomeScreen(server, user?.id)
  const { pinnedIds, toggle: togglePinChannel } = usePinnedItems()
  const upcomingEventsCount = events.filter((e) => new Date(e.starts_at).getTime() >= Date.now()).length
  const profileById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))
  const { collapsed: collapsedCategories, toggle: toggleCategoryCollapse } = useCollapsedCategories()

  const [menuOpen, setMenuOpen] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showInviteFriends, setShowInviteFriends] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState<{ categoryId: string | null } | null>(null)
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null)
  const [contextChannel, setContextChannel] = useState<Channel | null>(null)
  const { menuState, openMenu, closeMenu } = useContextMenuState()

  function handleChannelContextMenu(e: React.MouseEvent, channel: Channel) {
    setContextChannel(channel)
    openMenu(e)
  }
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)

  // --- Mover participante de voz pra outra sala (migration 014) ---------
  // Usa um tipo próprio no dataTransfer (VOICE_MEMBER_DRAG_TYPE), então o
  // arraste de canais/categorias (que usa 'text/plain') segue igual.
  const canMoveMembers = isOwner || Boolean(permissions.move_members) || Boolean(permissions.administrator)
  const [memberDrag, setMemberDrag] = useState<VoiceMemberDragPayload | null>(null)
  const [memberDropTarget, setMemberDropTarget] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)

  useEffect(() => {
    if (!moveError) return
    const t = setTimeout(() => setMoveError(null), 6000)
    return () => clearTimeout(t)
  }, [moveError])

  async function moveVoiceMember(userId: string, toChannel: Channel) {
    setMoveError(null)
    const { error } = await supabase.rpc('move_voice_member', {
      p_server_id: server.id,
      p_user_id: userId,
      p_to_channel_id: toChannel.id,
    })
    if (error) setMoveError(describeVoiceMoveError(error.message))
  }

  // Devolve true se o evento era de um participante sendo arrastado (e já
  // foi tratado) — aí os handlers de reordenar canal não fazem nada.
  function handleMemberDragOver(e: React.DragEvent, channel: Channel): boolean {
    if (!isVoiceMemberDrag(e.dataTransfer.types)) return false
    e.stopPropagation() // não deixa a categoria "acender" nem aceitar o drop
    if (canMoveMembers && canDropVoiceMemberOn(channel, memberDrag)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (memberDropTarget !== channel.id) setMemberDropTarget(channel.id)
    } else if (memberDropTarget !== null) {
      setMemberDropTarget(null)
    }
    return true
  }

  function handleMemberDrop(e: React.DragEvent, channel: Channel): boolean {
    if (!isVoiceMemberDrag(e.dataTransfer.types)) return false
    e.preventDefault()
    e.stopPropagation()
    const payload = decodeVoiceMemberDrag(e.dataTransfer.getData(VOICE_MEMBER_DRAG_TYPE)) ?? memberDrag
    setMemberDropTarget(null)
    setMemberDrag(null)
    if (canMoveMembers && payload && canDropVoiceMemberOn(channel, payload)) {
      void moveVoiceMember(payload.userId, channel)
    }
    return true
  }

  function handleDragStart(e: React.DragEvent, channelId: string) {
    e.dataTransfer.setData('text/plain', channelId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedChannelId(channelId)
  }

  function handleDragOverChannel(e: React.DragEvent, target: Channel) {
    if (handleMemberDragOver(e, target)) return
    e.preventDefault()
    setDragOverTarget(target.id)
  }

  function handleDragOverCategory(e: React.DragEvent, categoryKey: string) {
    if (isVoiceMemberDrag(e.dataTransfer.types)) return
    e.preventDefault()
    setDragOverTarget(categoryKey)
  }

  async function handleDropOnChannel(e: React.DragEvent, targetChannel: Channel) {
    if (handleMemberDrop(e, targetChannel)) return
    e.preventDefault()
    const draggedId = e.dataTransfer.getData('text/plain')
    setDragOverTarget(null)
    setDraggedChannelId(null)
    if (!draggedId || draggedId === targetChannel.id) return
    await moveChannelToCategory(draggedId, targetChannel.category_id, targetChannel.id)
  }

  async function handleDropOnCategory(e: React.DragEvent, categoryId: string | null) {
    if (isVoiceMemberDrag(e.dataTransfer.types)) return
    e.preventDefault()
    const draggedId = e.dataTransfer.getData('text/plain')
    setDragOverTarget(null)
    setDraggedChannelId(null)
    if (!draggedId) return
    await moveChannelToCategory(draggedId, categoryId)
  }
  const [showRoles, setShowRoles] = useState(false)
  const [showModeration, setShowModeration] = useState(false)

  const canManageChannels = isOwner || permissions.manage_channels
  const canManageRoles = isOwner || permissions.manage_roles
  const canViewAuditLog = isOwner || permissions.view_audit_log

  const uncategorized = channels.filter((c) => c.category_id === null).sort((a, b) => a.position - b.position)
  const sortedCategories = [...categories].sort((a, b) => a.position - b.position)
  return (
    <aside data-tour="channels" className="w-64 bg-mv-side flex flex-col shrink-0 rounded-tl-[var(--radius-panel)] border-l border-t border-[var(--color-line)] overflow-hidden">
      {server.banner_url && (
        <div className="relative h-24 w-full overflow-hidden shrink-0">
          <img src={server.banner_url} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-mv-side" />
        </div>
      )}
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          className="w-full h-14 px-4 flex items-center justify-between border-b border-[var(--color-line)] text-white font-semibold text-left hover:bg-white/[0.04] transition-colors"
        >
          <span className="truncate font-display text-[15px]">{server.name}</span>
          <ChevronDownIcon className="w-4 h-4 shrink-0" aria-hidden />
        </button>

        {menuOpen && (
          <div className="absolute top-full left-2 right-2 mt-1.5 surface-elevated rounded-xl p-1.5 z-20 animate-pop-in">
            <button
              onClick={() => {
                setShowInvite(true)
                setMenuOpen(false)
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-mv-accent hover:bg-mv-accent/10 transition-colors"
            >
              Convidar pessoas
            </button>
            <button
              onClick={() => {
                setShowInviteFriends(true)
                setMenuOpen(false)
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-mv-accent hover:bg-mv-accent/10 transition-colors"
            >
              Chamar amigos
            </button>
            {canManageChannels && (
              <>
                <button
                  onClick={() => {
                    setShowCreateChannel({ categoryId: null })
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-mv-text hover:bg-white/[0.06] transition-colors"
                >
                  Criar canal
                </button>
                <button
                  onClick={() => {
                    setShowCreateCategory(true)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-mv-text hover:bg-white/[0.06] transition-colors"
                >
                  Criar categoria
                </button>
              </>
            )}
            {canManageRoles && (
              <button
                onClick={() => {
                  setShowRoles(true)
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-mv-text hover:bg-white/[0.06] transition-colors"
              >
                Cargos
              </button>
            )}
            {canViewAuditLog && (
              <button
                onClick={() => {
                  setShowModeration(true)
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-mv-text hover:bg-white/[0.06] transition-colors"
              >
                Moderação
              </button>
            )}
            <button
              onClick={() => {
                setShowSettings(true)
                setMenuOpen(false)
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-mv-text hover:bg-white/[0.06] transition-colors"
            >
              Configurações do servidor
            </button>
            {/* Divisor só quando há item depois dele (o dono não tem "Sair"). */}
            {!isOwner && (
              <>
                <div className="h-px bg-white/10 my-1.5" />
                <button
                  onClick={() => {
                    setShowLeave(true)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Sair do servidor
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        {loadingChannels ? (
          <ChannelSidebarSkeleton />
        ) : channelsLoadError ? (
          <div className="mx-1 px-4 py-5 rounded-xl border border-rose-500/20 bg-rose-500/[0.05] flex flex-col items-center text-center gap-2">
            <span className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center" aria-hidden="true">
              <WarningIcon className="w-5 h-5 text-rose-400" aria-hidden />
            </span>
            <p className="text-sm font-medium text-mv-text">Não foi possível carregar os canais</p>
            <p className="text-xs text-mv-muted break-words">{channelsLoadError}</p>
            <button onClick={() => refresh()} className="btn-secondary h-8 px-3 text-xs mt-1">
              Tentar de novo
            </button>
          </div>
        ) : (
          <>
        <button
          onClick={() => setShowEvents(true)}
          className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[14px] font-medium text-mv-muted hover:bg-white/[0.04] hover:text-mv-text transition-colors"
        >
          <CalendarIcon className="w-5 h-5 shrink-0" aria-hidden />
          Eventos
          {upcomingEventsCount > 0 && (
            <span className="ml-auto badge-count !shadow-none">{upcomingEventsCount}</span>
          )}
        </button>

        {uncategorized.length > 0 && (
          <div
            className={`space-y-0.5 rounded ${dragOverTarget === 'uncategorized' ? 'bg-white/5' : ''}`}
            onDragOver={(e) => handleDragOverCategory(e, 'uncategorized')}
            onDrop={(e) => handleDropOnCategory(e, null)}
          >
            {uncategorized.map((channel) => (
              <Fragment key={channel.id}>
                <ChannelRow
                  channel={channel}
                  active={activeChannelId === channel.id}
                  unread={unreadChannelIds.has(channel.id)}
                  muted={mutedChannelIds.has(channel.id)}
                  pinned={pinnedIds.has(channel.id)}
                  isOwner={isOwner}
                  isDragOver={(dragOverTarget === channel.id && draggedChannelId !== channel.id) || memberDropTarget === channel.id}
                  onSelect={() => onSelectChannel(channel)}
                  onEdit={() => setEditingChannel(channel)}
                  onMoveUp={() => moveChannel(channel.id, null, 'up')}
                  onMoveDown={() => moveChannel(channel.id, null, 'down')}
                  onDragStart={(e) => handleDragStart(e, channel.id)}
                  onDragOver={(e) => handleDragOverChannel(e, channel)}
                  onDragLeave={() => {
                    setDragOverTarget(null)
                    setMemberDropTarget(null)
                  }}
                  onDrop={(e) => handleDropOnChannel(e, channel)}
                  onRename={(name) => updateChannel(channel.id, { name: name.toLowerCase().replace(/\s+/g, "-") })}
                  onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                />
                {channel.type === 'voice' && (
                  <VoiceChannelPresence
                    channelId={channel.id}
                    profileById={profileById}
                    userLimit={channel.user_limit}
                    serverId={server.id}
                    ownerId={server.owner_id}
                    isOwner={isOwner}
                    canMoveMembers={canMoveMembers}
                    onMemberDragStart={setMemberDrag}
                    onMemberDragEnd={() => {
                      setMemberDrag(null)
                      setMemberDropTarget(null)
                    }}
                    onDragOver={(e) => handleMemberDragOver(e, channel)}
                    onDragLeave={() => setMemberDropTarget(null)}
                    onDrop={(e) => handleMemberDrop(e, channel)}
                  />
                )}
              </Fragment>
            ))}
          </div>
        )}

        {uncategorized.length > 0 && sortedCategories.length > 0 && (
          <div className="h-px bg-white/10 mx-1" />
        )}

        {sortedCategories.map((category) => {
          const categoryChannels = channels
            .filter((c) => c.category_id === category.id)
            .sort((a, b) => a.position - b.position)

          return (
            <div
              key={category.id}
              className={`group/category rounded transition-colors ${
                dragOverTarget === category.id ? 'bg-white/5 ring-1 ring-dashed ring-mv-accent/50' : ''
              }`}
              onDragOver={(e) => handleDragOverCategory(e, category.id)}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={(e) => handleDropOnCategory(e, category.id)}
            >
              <div
                className="px-1 mb-1 flex items-center justify-between rounded cursor-pointer select-none"
                onClick={() => toggleCategoryCollapse(category.id)}
              >
                <div className="flex items-center gap-1 min-w-0">
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className={`w-3 h-3 shrink-0 text-mv-muted transition-transform ${
                      collapsedCategories.has(category.id) ? '-rotate-90' : ''
                    }`}
                  >
                    <path d="M12 16a1 1 0 0 1-.7-.3l-6-6a1 1 0 1 1 1.4-1.4L12 13.6l5.3-5.3a1 1 0 0 1 1.4 1.4l-6 6a1 1 0 0 1-.7.3z" />
                  </svg>
                  <InlineEditableLabel
                    value={category.name}
                    editable={isOwner}
                    onSave={(name) => updateCategory(category.id, name.toUpperCase())}
                    className="text-[11px] font-semibold uppercase text-mv-muted tracking-[0.08em] truncate group-hover/category:text-mv-text transition-colors"
                  />
                </div>
                {isOwner && (
                  <div className="hidden group-hover/category:flex items-center gap-1 shrink-0">
                    <button
                      title="Mover categoria para cima"
                      aria-label="Mover categoria para cima"
                      onClick={(e) => {
                        e.stopPropagation()
                        moveCategory(category.id, 'up')
                      }}
                      className="text-mv-muted hover:text-white"
                    >
                      <ChevronUpIcon className="w-3 h-3" aria-hidden />
                    </button>
                    <button
                      title="Mover categoria para baixo"
                      aria-label="Mover categoria para baixo"
                      onClick={(e) => {
                        e.stopPropagation()
                        moveCategory(category.id, 'down')
                      }}
                      className="text-mv-muted hover:text-white"
                    >
                      <ChevronDownIcon className="w-3 h-3" aria-hidden />
                    </button>
                    <button
                      title="Criar canal nesta categoria"
                      aria-label="Criar canal nesta categoria"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowCreateChannel({ categoryId: category.id })
                      }}
                      className="text-mv-muted hover:text-white"
                    >
                      <PlusIcon className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              {!collapsedCategories.has(category.id) && (
                <div className="space-y-0.5">
                  {categoryChannels.map((channel) => (
                    <Fragment key={channel.id}>
                      <ChannelRow
                        channel={channel}
                        active={activeChannelId === channel.id}
                        unread={unreadChannelIds.has(channel.id)}
                        muted={mutedChannelIds.has(channel.id)}
                        pinned={pinnedIds.has(channel.id)}
                        isOwner={isOwner}
                        isDragOver={(dragOverTarget === channel.id && draggedChannelId !== channel.id) || memberDropTarget === channel.id}
                        onSelect={() => onSelectChannel(channel)}
                        onEdit={() => setEditingChannel(channel)}
                        onMoveUp={() => moveChannel(channel.id, category.id, 'up')}
                        onMoveDown={() => moveChannel(channel.id, category.id, 'down')}
                        onDragStart={(e) => handleDragStart(e, channel.id)}
                        onDragOver={(e) => handleDragOverChannel(e, channel)}
                        onDragLeave={() => {
                          setDragOverTarget(null)
                          setMemberDropTarget(null)
                        }}
                        onDrop={(e) => handleDropOnChannel(e, channel)}
                        onRename={(name) => updateChannel(channel.id, { name: name.toLowerCase().replace(/\s+/g, '-') })}
                        onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                      />
                      {channel.type === 'voice' && (
                        <VoiceChannelPresence
                    channelId={channel.id}
                    profileById={profileById}
                    userLimit={channel.user_limit}
                    serverId={server.id}
                    ownerId={server.owner_id}
                    isOwner={isOwner}
                    canMoveMembers={canMoveMembers}
                    onMemberDragStart={setMemberDrag}
                    onMemberDragEnd={() => {
                      setMemberDrag(null)
                      setMemberDropTarget(null)
                    }}
                    onDragOver={(e) => handleMemberDragOver(e, channel)}
                    onDragLeave={() => setMemberDropTarget(null)}
                    onDrop={(e) => handleMemberDrop(e, channel)}
                  />
                      )}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        </>
        )}
      </div>

      {moveError && (
        <div
          role="alert"
          className="mx-2.5 mb-2 px-3 py-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.08] flex items-start gap-2 animate-fade-in"
        >
          <p className="text-xs text-rose-300 flex-1 min-w-0 break-words">{moveError}</p>
          <button
            onClick={() => setMoveError(null)}
            title="Fechar aviso"
            aria-label="Fechar aviso"
            className="shrink-0 text-rose-300/70 hover:text-rose-200"
          >
            <CloseIcon className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      )}

      {showInvite &&<InviteModal serverId={server.id} onClose={() => setShowInvite(false)} />}
      {showInviteFriends && (
        <InviteFriendsModal serverId={server.id} onClose={() => setShowInviteFriends(false)} />
      )}
      {showSettings && (
        <ServerSettingsModal
          server={server}
          isOwner={isOwner}
          channels={channels}
          onClose={() => setShowSettings(false)}
          onDeleted={() => {
            setShowSettings(false)
            onServerDeleted()
          }}
        />
      )}
      {showLeave && (
        <LeaveServerModal
          serverId={server.id}
          serverName={server.name}
          onClose={() => setShowLeave(false)}
          onLeft={() => {
            setShowLeave(false)
            onServerLeft()
          }}
        />
      )}
      {showCreateChannel && (
        <CreateChannelModal
          categories={sortedCategories}
          defaultCategoryId={showCreateChannel.categoryId}
          onClose={() => setShowCreateChannel(null)}
        />
      )}
      {showCreateCategory && (
        <CreateCategoryModal onClose={() => setShowCreateCategory(false)} />
      )}
      {editingChannel && (
        <EditChannelModal
          channel={editingChannel}
          serverId={server.id}
          onClose={() => setEditingChannel(null)}
        />
      )}
      {showRoles && <RolesManagerModal serverId={server.id} onClose={() => setShowRoles(false)} />}
      {showModeration && <ModerationLogModal serverId={server.id} onClose={() => setShowModeration(false)} />}

      {menuState && contextChannel && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          onClose={closeMenu}
          items={[
            { label: 'Abrir canal', onClick: () => onSelectChannel(contextChannel) },
            {
              label: pinnedIds.has(contextChannel.id) ? 'Desafixar canal' : 'Fixar canal',
              onClick: () => togglePinChannel(contextChannel.id),
            },
            {
              label: 'Copiar nome do canal',
              onClick: () => copyText(contextChannel.name),
            },
            {
              label:
                getLevel(contextChannel.id) === 'all'
                  ? 'Notificar: só menções'
                  : getLevel(contextChannel.id) === 'mentions'
                    ? 'Silenciar totalmente'
                    : 'Reativar notificações',
              onClick: () => {
                const current = getLevel(contextChannel.id)
                const next = current === 'all' ? 'mentions' : current === 'mentions' ? 'muted' : 'all'
                setNotificationLevel(contextChannel.id, next)
              },
            },
            ...(isOwner
              ? [
                  { label: 'Editar canal', onClick: () => setEditingChannel(contextChannel) },
                  {
                    label: 'Mover para cima',
                    onClick: () => moveChannel(contextChannel.id, contextChannel.category_id, 'up'),
                  },
                  {
                    label: 'Mover para baixo',
                    onClick: () => moveChannel(contextChannel.id, contextChannel.category_id, 'down'),
                  },
                  ...(sortedCategories.length > 0
                    ? [
                        ...sortedCategories
                          .filter((cat) => cat.id !== contextChannel.category_id)
                          .map((cat) => ({
                            label: `Mover para "${cat.name}"`,
                            divider: cat.id === sortedCategories.filter((c) => c.id !== contextChannel.category_id)[0]?.id,
                            onClick: () => moveChannelToCategory(contextChannel.id, cat.id),
                          })),
                        ...(contextChannel.category_id !== null
                          ? [
                              {
                                label: 'Remover da categoria',
                                onClick: () => moveChannelToCategory(contextChannel.id, null),
                              },
                            ]
                          : []),
                      ]
                    : []),
                  {
                    label: 'Excluir canal',
                    danger: true,
                    divider: true,
                    onClick: () => {
                      if (confirm(`Excluir o canal "${contextChannel.name}"? Essa ação não pode ser desfeita.`)) {
                        deleteChannel(contextChannel.id)
                      }
                    },
                  },
                ]
              : []),
          ]}
        />
      )}

      {showWelcome && <ServerWelcomeModal server={server} onDismiss={dismissWelcome} />}

      {showEvents && (
        <EventsModal
          serverId={server.id}
          channels={channels}
          canCreate={isOwner || permissions.manage_channels}
          membersById={profileById}
          onClose={() => setShowEvents(false)}
        />
      )}
    </aside>
  )
}
