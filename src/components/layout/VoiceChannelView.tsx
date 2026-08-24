import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { VideoTile, RemoteAudio } from './CallMediaTiles'
import { useAuth } from '../../hooks/useAuth'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useVoice } from '../../hooks/useVoice'
import { useModeration } from '../../hooks/useModeration'
import { useRoles } from '../../hooks/useRoles'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useFriends } from '../../context/FriendsContext'
import { InviteFriendsModal } from '../modals/InviteFriendsModal'
import { SoundboardPanel } from '../ui/SoundboardPanel'
import { SettingsModal } from '../modals/SettingsModal'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import type { VoiceParticipant } from '../../context/VoiceContext'
import type { Channel, Profile, Role } from '../../types/database'

// VideoTile/RemoteAudio agora moram em CallMediaTiles.tsx (arquivo
// pequeno, compartilhado com DMCallOverlay.tsx) — ver o comentário lá
// pra saber por quê (tem a ver com esse arquivo aqui ser lazy-loaded).

// "Palco" de compartilhamentos de tela: divide o espaço certinho
// dependendo de quantas pessoas estão compartilhando ao mesmo tempo.
function ScreenShareAudio({ stream, volume }: { stream: MediaStream; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume))
  }, [volume])
  if (stream.getAudioTracks().length === 0) return null
  return <audio ref={ref} autoPlay />
}

function ScreenShareStage({
  shares,
  onHide,
}: {
  shares: { key: string; name: string; stream: MediaStream; isLocal: boolean }[]
  onHide: (key: string) => void
}) {
  const voice = useVoice()
  const [openVolumeFor, setOpenVolumeFor] = useState<string | null>(null)
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const cols = shares.length <= 1 ? 1 : shares.length <= 2 ? 2 : shares.length <= 4 ? 2 : 3

  // Tela cheia de verdade (cobre o monitor inteiro, não só a janela do
  // app) e janela flutuante de verdade (Picture-in-Picture do próprio
  // navegador/Chromium — pode ser arrastada, redimensionada, e tirada
  // pra fora do app) usam as APIs nativas em vez de um "modo" mantido
  // manualmente — assim o estado nunca desincroniza do que o sistema
  // operacional está realmente mostrando.
  async function goFullscreen(key: string) {
    const el = videoRefs.current[key]
    if (!el) return
    try {
      await el.requestFullscreen()
    } catch {
      // navegador/SO recusou (raro) — sem problema, só não faz nada
    }
  }

  async function goFloating(key: string) {
    const el = videoRefs.current[key]
    if (!el) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      await el.requestPictureInPicture()
    } catch {
      // navegador sem suporte a PiP — sem problema, só não faz nada
    }
  }

  return (
    <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {shares.map((share) => {
        const hasAudio = share.stream.getAudioTracks().length > 0
        const shareVolume = voice.getScreenShareVolume(share.key)
        const isMuted = shareVolume === 0
        const effectiveVolume = (voice.masterVolume / 100) * (shareVolume / 100)

        return (
          <div
            key={share.key}
            className="relative aspect-video rounded-lg overflow-hidden border border-black/30 bg-black group/share w-full h-full"
            onMouseLeave={() => setOpenVolumeFor((v) => (v === share.key ? null : v))}
          >
            {share.isLocal ? (
              // A SUA PRÓPRIA transmissão nunca ganha uma prévia de vídeo
              // ao vivo aqui de propósito — se a captura for de TELA
              // CHEIA (não só uma janela), ela inclui esta própria janela
              // do app, que por sua vez estaria mostrando esse vídeo ao
              // vivo... que a captura pegaria de novo no frame seguinte,
              // e de novo, e de novo: um espelho infinito recursivo (é
              // exatamente esse "efeito caleidoscópio" que apareceu
              // quando isso não existia). Como é a SUA tela, você já sabe
              // o que está mostrando — não faz falta uma prévia.
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-discord-text-muted">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 opacity-60">
                  <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
                </svg>
                <p className="text-xs text-center px-4">Você está compartilhando sua tela</p>
                <p className="text-[10px] text-center px-6 opacity-70">
                  Sem prévia aqui de propósito — evita o efeito de espelho infinito se a captura pegar esta janela
                </p>
              </div>
            ) : (
              <VideoTile
                stream={share.stream}
                fit="contain"
                ref={(el) => {
                  videoRefs.current[share.key] = el
                }}
              />
            )}
            {!share.isLocal && <ScreenShareAudio stream={share.stream} volume={effectiveVolume} />}
            <span className="absolute bottom-1.5 left-2 text-xs text-white bg-black/60 px-1.5 py-0.5 rounded flex items-center gap-1">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
              </svg>
              {share.name}
              {share.isLocal && ' (você)'}
            </span>

            <div className="absolute top-1.5 right-2 flex items-center gap-1.5 opacity-0 scale-90 group-hover/share:opacity-100 group-hover/share:scale-100 transition-all duration-150">
              {!share.isLocal && hasAudio && (
                <button
                  onClick={() => voice.setScreenShareVolume(share.key, isMuted ? 100 : 0)}
                  title={isMuted ? 'Reativar áudio' : 'Silenciar essa transmissão'}
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-white ${
                    isMuted ? 'bg-red-600' : 'bg-black/60 hover:bg-black/80'
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                    {isMuted ? (
                      <path d="M16.5 12A4.5 4.5 0 0 0 14 8v1.2l2.4 2.4c.06-.2.1-.4.1-.6zM3 3l18 18-1.4 1.4-3.4-3.4A4.5 4.5 0 0 1 14 20v-2a2.5 2.5 0 0 0 1-2v-.2L3 3.4 3 3z" />
                    ) : (
                      <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8z" />
                    )}
                  </svg>
                </button>
              )}

              {!share.isLocal && hasAudio && (
                <div className="relative">
                  <button
                    onClick={() => setOpenVolumeFor((v) => (v === share.key ? null : share.key))}
                    title="Ajustar volume do áudio desta transmissão"
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M12 3a1 1 0 0 1 1 1v16a1 1 0 0 1-1.7.7L7 16H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h3l4.3-4.7A1 1 0 0 1 12 3z" />
                    </svg>
                  </button>
                  {openVolumeFor === share.key && (
                    <div className="absolute top-7 right-0 bg-discord-darker rounded-lg shadow-xl border border-black/40 p-2.5 w-36 z-10">
                      <p className="text-[10px] text-discord-text-muted mb-1.5">Áudio da transmissão: {shareVolume}%</p>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={shareVolume}
                        onChange={(e) => voice.setScreenShareVolume(share.key, Number(e.target.value))}
                        className="w-full accent-discord-blurple"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Tela cheia / janela flutuante agem sobre o elemento de
                  vídeo — a sua própria transmissão não tem um (ver
                  comentário acima), então esses botões só fazem sentido
                  pras transmissões dos OUTROS. */}
              {!share.isLocal && (
                <>
                  <button
                    onClick={() => goFullscreen(share.key)}
                    title="Tela cheia"
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm16 0h-2v4h-4v2h6v-6z" />
                    </svg>
                  </button>

                  <button
                    onClick={() => goFloating(share.key)}
                    title="Janela flutuante (pode arrastar pra fora do app)"
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zm-2-7h-6v5h6v-5z" />
                    </svg>
                  </button>
                </>
              )}

              {/* Fecha só a VISUALIZAÇÃO desta transmissão pra você — não
                  para o compartilhamento (se for sua) nem tira ninguém da
                  sala. É só um "esconder da minha tela", reversível pelo
                  aviso "N ocultas" que aparece embaixo. */}
              <button
                onClick={() => onHide(share.key)}
                title="Fechar esta transmissão (continua no ar, só não aparece mais aqui)"
                className="w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
                </svg>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ParticipantTile({
  userId,
  name,
  avatarUrl,
  decorationUrl,
  data,
  isLocal,
  localVideoEnabled,
  sinkId,
  compact = false,
  onViewProfile,
  onMessageUser,
  username,
  canModerate,
  onKick,
  onBan,
  roles,
  userRoleIds,
  onToggleRole,
  onAddFriend,
  onInvite,
}: {
  userId: string
  name: string
  username?: string
  avatarUrl?: string | null
  decorationUrl?: string | null
  data: VoiceParticipant | undefined
  isLocal: boolean
  localVideoEnabled?: boolean
  sinkId?: string | null
  compact?: boolean
  onViewProfile?: (userId: string) => void
  onMessageUser?: (userId: string) => void
  canModerate?: boolean
  onKick?: (userId: string) => void
  onBan?: (userId: string) => void
  roles?: Role[]
  userRoleIds?: string[]
  onToggleRole?: (userId: string, roleId: string) => void
  onAddFriend?: (username: string) => void
  onInvite?: () => void
}) {
  const voice = useVoice()
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [videoHiddenLocally, setVideoHiddenLocally] = useState(false)
  const { menuState, openMenu, closeMenu } = useContextMenuState()
  const speaking = data?.speaking ?? false
  const hasCameraVideo = isLocal ? localVideoEnabled : Boolean(data?.cameraStream?.getVideoTracks().length)
  const participantVolume = isLocal ? 100 : voice.getParticipantVolume(userId)
  const effectiveVolume = (voice.masterVolume / 100) * (participantVolume / 100)

  const volumeButton = !isLocal && (
    <div
      className={
        compact
          ? 'relative'
          : 'absolute top-1.5 left-1.5 opacity-0 scale-90 group-hover/tile:opacity-100 group-hover/tile:scale-100 transition-all duration-150'
      }
    >
      <button
        onClick={() => setShowVolumeSlider((v) => !v)}
        title="Ajustar volume deste participante"
        className={
          compact
            ? 'w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80'
            : 'w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80'
        }
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
          <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8z" />
        </svg>
      </button>
      {showVolumeSlider && (
        // No card não-compact, o botão fica perto do topo (top-1.5) e o
        // card em volta corta qualquer coisa que passe da borda dele
        // (overflow-hidden, ali embaixo em ParticipantTile) — abrindo
        // pra CIMA (bottom-full) o popup saía inteiro por fora da área
        // visível e ficava cortado (por isso "clicar não aparecia
        // nada"). Abrindo pra BAIXO (top-full) ele fica dentro da área
        // do próprio card, que tem espaço de sobra logo abaixo do botão.
        <div className="absolute top-full left-0 mt-1 bg-discord-darker rounded-lg shadow-xl border border-black/40 p-2.5 w-32 z-10">
          <p className="text-[10px] text-discord-text-muted mb-1.5">{participantVolume}%</p>
          <input
            type="range"
            min={0}
            max={100}
            value={participantVolume}
            onChange={(e) => voice.setParticipantVolume(userId, Number(e.target.value))}
            className="w-full accent-discord-blurple"
          />
        </div>
      )}
    </div>
  )

  const audioEl = !isLocal && data?.cameraStream && (
    <RemoteAudio stream={data.cameraStream} sinkId={sinkId} volume={effectiveVolume} />
  )

  const myRoleIds = new Set(userRoleIds ?? [])
  const menuItems = [
    { label: 'Ver perfil', onClick: () => onViewProfile?.(userId) },
    { label: 'Mensagem', onClick: () => onMessageUser?.(userId) },
    ...(username ? [{ label: 'Mencionar (copiar @)', onClick: () => navigator.clipboard.writeText(`@${username}`) }] : []),
    { label: 'Ajustar volume', onClick: () => setShowVolumeSlider(true) },
    {
      label: videoHiddenLocally ? 'Mostrar vídeo' : 'Desativar vídeo (só pra você)',
      onClick: () => setVideoHiddenLocally((v) => !v),
    },
    ...(username
      ? [{ label: 'Adicionar amigo', onClick: () => onAddFriend?.(username) }]
      : []),
    ...(onInvite ? [{ label: 'Convidar para o servidor', onClick: () => onInvite() }] : []),
    { label: 'Copiar ID do usuário', onClick: () => navigator.clipboard.writeText(userId) },
    ...(roles && roles.length > 0 && canModerate
      ? roles.map((r) => ({
          label: `${myRoleIds.has(r.id) ? '✓ ' : '   '} Cargo: ${r.name}`,
          onClick: () => onToggleRole?.(userId, r.id),
        }))
      : []),
    ...(canModerate
      ? [
          { label: `Expulsar ${name}`, danger: true, onClick: () => onKick?.(userId) },
          { label: `Banir ${name}`, danger: true, onClick: () => onBan?.(userId) },
        ]
      : []),
  ]

  if (compact) {
    return (
      <div
        className="flex flex-col items-center gap-1 w-16 shrink-0"
        onMouseLeave={() => setShowVolumeSlider(false)}
        onContextMenu={!isLocal ? openMenu : undefined}
      >
        <div
          className={`relative rounded-full transition-shadow ${
            speaking ? 'ring-2 ring-discord-blurple shadow-[0_0_8px_0] shadow-discord-blurple/60 animate-pulse' : ''
          }`}
        >
          <Avatar name={name} avatarUrl={avatarUrl} decorationUrl={decorationUrl} size={48} />
          {audioEl}
        </div>
        <span className="text-[10px] text-discord-text truncate max-w-full">{isLocal ? 'Você' : name}</span>
        {volumeButton}
        {menuState && !isLocal && <ContextMenu x={menuState.x} y={menuState.y} onClose={closeMenu} items={menuItems} />}
      </div>
    )
  }

  return (
    <div
      className={`relative aspect-video bg-discord-darker rounded-lg flex items-center justify-center overflow-hidden border-2 transition-colors group/tile ${
        speaking ? 'border-discord-blurple' : 'border-transparent'
      }`}
      onMouseLeave={() => setShowVolumeSlider(false)}
      onContextMenu={!isLocal ? openMenu : undefined}
    >
      {hasCameraVideo && data?.cameraStream && !videoHiddenLocally ? (
        <VideoTile stream={data.cameraStream} sinkId={sinkId} />
      ) : (
        // Sem câmera, o ícone/avatar no centro é a única coisa "visível"
        // pra indicar quem está falando — sem esse anel pulsando, só a
        // borda fina do card mudava de cor, o que é fácil de não notar. O
        // mesmo tratamento (ring + sombra + animate-pulse) já existe na
        // listinha de participantes da sidebar (ChannelSidebar.tsx); aqui
        // só reaplica o mesmo padrão no avatar grande.
        <div
          className={`relative rounded-full transition-shadow ${
            speaking ? 'ring-4 ring-discord-blurple shadow-[0_0_16px_0] shadow-discord-blurple/60 animate-pulse' : ''
          }`}
        >
          <Avatar name={name} avatarUrl={avatarUrl} decorationUrl={decorationUrl} size={64} />
        </div>
      )}
      {audioEl}
      <span className="absolute bottom-1.5 left-2 text-sm font-medium text-white bg-black/50 px-1.5 py-0.5 rounded flex items-center gap-1.5">
        {name}
        {isLocal && ' (você)'}
        {!isLocal && voice.connectionQuality[userId] !== undefined && (
          <span
            className={`text-[10px] font-mono font-normal ${
              voice.connectionQuality[userId] < 100
                ? 'text-discord-green'
                : voice.connectionQuality[userId] < 250
                  ? 'text-yellow-400'
                  : 'text-red-400'
            }`}
            title="Latência real da chamada com essa pessoa"
          >
            {voice.connectionQuality[userId]}ms
          </span>
        )}
      </span>
      {volumeButton}
      {menuState && !isLocal && <ContextMenu x={menuState.x} y={menuState.y} onClose={closeMenu} items={menuItems} />}
    </div>
  )
}

export function VoiceChannelView({
  channel,
  serverId,
  onViewProfile,
  onMessageUser,
}: {
  channel: Channel
  serverId: string
  onViewProfile?: (profile: Profile) => void
  onMessageUser?: (userId: string) => void
}) {
  const { profile } = useAuth()
  const { members } = useServerMembers(serverId)
  const voice = useVoice()
  const { permissions, kickMember, banMember } = useModeration(serverId)
  const { roles, rolesForUser, assignRole, removeRole } = useRoles(serverId)
  const { sendRequest } = useFriends()
  const [showInvite, setShowInvite] = useState(false)
  const [showSoundboard, setShowSoundboard] = useState(false)
  const [showMicMenu, setShowMicMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showSettingsFromVoice, setShowSettingsFromVoice] = useState(false)
  // Clique fora fecha — ver useClickOutside.ts sobre o bug do onMouseLeave
  // antigo fechando o menu antes do mouse alcançar as opções.
  const micMenuRef = useClickOutside<HTMLDivElement>(showMicMenu, useCallback(() => setShowMicMenu(false), []))
  const moreMenuRef = useClickOutside<HTMLDivElement>(showMoreMenu, useCallback(() => setShowMoreMenu(false), []))
  // "Desativar áudio" (deafen) agora mora no VoiceContext (voice.deafened
  // / voice.toggleDeafen) — assim o UserPanel (sempre visível) e esta
  // barra de controles enxergam e alternam o MESMO estado, em vez de
  // cada um ter sua própria cópia desincronizada.
  const deafened = voice.deafened
  const toggleDeafen = voice.toggleDeafen
  // Preferências só desta sessão de call (não persistem — reinicia toda
  // vez que entra de novo, igual um "modo de exibição" temporário).
  const [showOwnTile, setShowOwnTile] = useState(true)
  const [hideNoVideoParticipants, setHideNoVideoParticipants] = useState(false)
  // Transmissões que a própria pessoa fechou LOCALMENTE (ver
  // ScreenShareStage) — só tira da SUA tela, não afeta quem está
  // compartilhando nem quem mais está assistindo. Fica de fora da sala
  // de voz o tempo todo, só não aparece mais o vídeo em si.
  const [hiddenShareKeys, setHiddenShareKeys] = useState<Set<string>>(new Set())

  function handleViewParticipantProfile(userId: string) {
    const p = members.find((m) => m.user_id === userId)?.profile
    if (p) onViewProfile?.(p)
  }

  // Em canal Palco, só quem modera pode falar — has_permission() já
  // conta o dono do servidor como tendo qualquer permissão, então não
  // precisa checar owner separado.
  const isSpeaker = !channel.is_stage || permissions.manage_channels

  const profileById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))
  const isConnectedHere = voice.connectedChannelId === channel.id
  const isConnectedElsewhere = voice.connectedChannelId !== null && !isConnectedHere

  async function handleSwitchHere() {
    voice.leave()
    await voice.join(channel.id, serverId)
    if (!isSpeaker) voice.toggleMute()
  }

  const screenShares: { key: string; name: string; stream: MediaStream; isLocal: boolean }[] = []
  if (voice.screenSharing && voice.localScreenStream && profile) {
    screenShares.push({
      key: 'local',
      name: profile.display_name || profile.username,
      stream: voice.localScreenStream,
      isLocal: true,
    })
  }
  Object.entries(voice.participants).forEach(([userId, data]) => {
    if (data.screenStream) {
      const p = profileById[userId]
      screenShares.push({
        key: userId,
        name: p?.display_name || p?.username || 'Usuário',
        stream: data.screenStream,
        isLocal: false,
      })
    }
  })
  const visibleScreenShares = screenShares.filter((s) => !hiddenShareKeys.has(s.key))
  const hasScreenShares = visibleScreenShares.length > 0
  const hiddenCount = screenShares.length - visibleScreenShares.length

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
        </svg>
        <h2 className="font-display font-semibold tracking-wide text-white">{channel.name}</h2>
        {isConnectedHere && (
          <span className="text-xs text-discord-text-muted">
            {Object.keys(voice.participants).length + 1}/{voice.maxParticipants} conectados
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowInvite(true)}
          className="text-xs px-3 py-1.5 rounded btn-primary flex items-center gap-1.5 shrink-0"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M15 12a5 5 0 1 0-4.9-6H9a1 1 0 1 0 0 2h1.1c.1.4.2.7.4 1H9a1 1 0 1 0 0 2h2.5c.9.6 2 1 3.2 1zM3 20a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6 1 1 0 1 1-2 0 4 4 0 0 0-4-4H9a4 4 0 0 0-4 4 1 1 0 1 1-2 0zm16-2v-2h-2v-2h2v-2h2v2h2v2h-2v2h-2z" />
          </svg>
          Chamar amigos
        </button>
      </header>

      {isConnectedElsewhere ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="w-16 h-16 rounded-full bg-discord-lighter flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-discord-text-muted">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
            </svg>
          </div>
          <h3 className="font-display text-xl font-bold text-white tracking-wide">{channel.name}</h3>
          <p className="text-discord-text-muted mt-1 max-w-sm">
            Você já está conectado em outro canal de voz. Quer trocar pra este?
          </p>
          <button
            onClick={handleSwitchHere}
            disabled={voice.connecting}
            className="mt-4 px-5 py-2.5 rounded btn-primary disabled:opacity-60"
          >
            {voice.connecting ? 'Trocando...' : 'Trocar de canal'}
          </button>
        </div>
      ) : !isConnectedHere ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="w-16 h-16 rounded-full bg-discord-lighter flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-discord-text-muted">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
            </svg>
          </div>
          <h3 className="font-display text-xl font-bold text-white tracking-wide">{channel.name}</h3>
          <p className="text-discord-text-muted mt-1 max-w-sm">
            Ninguém está no canal de voz ainda. Entre pra começar uma chamada.
          </p>
          {voice.error && <p className="text-sm text-red-400 mt-3">{voice.error}</p>}
          <button
            onClick={async () => {
              await voice.join(channel.id, serverId)
              if (!isSpeaker) voice.toggleMute()
            }}
            disabled={voice.connecting}
            className="mt-4 px-5 py-2.5 rounded bg-discord-green text-white font-medium hover:brightness-110 transition-colors disabled:opacity-60"
          >
            {voice.connecting ? 'Conectando...' : 'Entrar no canal de voz'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">
            {hiddenCount > 0 && (
              <button
                onClick={() => setHiddenShareKeys(new Set())}
                className="mb-3 self-center text-xs text-discord-text-muted hover:text-white bg-discord-lighter hover:bg-discord-darker px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                </svg>
                {hiddenCount === 1 ? '1 transmissão oculta' : `${hiddenCount} transmissões ocultas`} — mostrar
              </button>
            )}
            {hasScreenShares && (
              <ScreenShareStage
                shares={visibleScreenShares}
                onHide={(key) => setHiddenShareKeys((prev) => new Set(prev).add(key))}
              />
            )}

            {hasScreenShares ? (
              // Com tela(s) compartilhada(s) em foco, os participantes viram
              // uma tira compacta embaixo do palco em vez do grid grande.
              <div className="flex flex-wrap gap-3 justify-center pt-1">
                {profile && showOwnTile && (
                  <ParticipantTile
                    userId={profile.id}
                    name={profile.display_name || profile.username}
                    avatarUrl={profile.avatar_url}
                    decorationUrl={profile.avatar_decoration_url}
                    data={undefined}
                    isLocal
                    localVideoEnabled={voice.videoEnabled}
                    compact
                  />
                )}
                {Object.entries(voice.participants)
                  .filter(([, data]) => !hideNoVideoParticipants || Boolean(data.cameraStream?.getVideoTracks().length))
                  .map(([userId, data]) => {
                  const p = profileById[userId]
                  return (
                    <ParticipantTile
                      key={userId}
                      userId={userId}
                      name={p?.display_name || p?.username || 'Usuário'}
                      username={p?.username}
                      avatarUrl={p?.avatar_url}
                      decorationUrl={p?.avatar_decoration_url}
                      data={data}
                      isLocal={false}
                      sinkId={voice.audioSettings.speakerId}
                      compact
                      onViewProfile={handleViewParticipantProfile}
                      onMessageUser={onMessageUser}
                      canModerate={permissions.kick_members || permissions.ban_members}
                      onKick={async (uid) => {
                        if (!confirm('Expulsar essa pessoa do servidor? Ela pode entrar de novo com um convite.')) return
                        const { error } = await kickMember(uid)
                        if (error) alert(error)
                      }}
                      onBan={async (uid) => {
                        if (!confirm('Banir essa pessoa do servidor? Ela não vai conseguir voltar sem ser desbanida antes.')) return
                        const { error } = await banMember(uid)
                        if (error) alert(error)
                      }}
                      roles={roles}
                      userRoleIds={rolesForUser(userId).map((r) => r.id)}
                      onToggleRole={async (uid, roleId) => {
                        const has = rolesForUser(uid).some((r) => r.id === roleId)
                        const { error } = has ? await removeRole(uid, roleId) : await assignRole(uid, roleId)
                        if (error) alert(error)
                      }}
                      onAddFriend={async (uname) => {
                        const { error } = await sendRequest(uname)
                        if (error) alert(error)
                      }}
                      onInvite={() => setShowInvite(true)}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {profile && showOwnTile && (
                  <ParticipantTile
                    userId={profile.id}
                    name={profile.display_name || profile.username}
                    avatarUrl={profile.avatar_url}
                    decorationUrl={profile.avatar_decoration_url}
                    data={undefined}
                    isLocal
                    localVideoEnabled={voice.videoEnabled}
                  />
                )}
                {Object.entries(voice.participants)
                  .filter(([, data]) => !hideNoVideoParticipants || Boolean(data.cameraStream?.getVideoTracks().length))
                  .map(([userId, data]) => {
                  const p = profileById[userId]
                  return (
                    <ParticipantTile
                      key={userId}
                      userId={userId}
                      name={p?.display_name || p?.username || 'Usuário'}
                      username={p?.username}
                      avatarUrl={p?.avatar_url}
                      decorationUrl={p?.avatar_decoration_url}
                      data={data}
                      isLocal={false}
                      sinkId={voice.audioSettings.speakerId}
                      onViewProfile={handleViewParticipantProfile}
                      onMessageUser={onMessageUser}
                      canModerate={permissions.kick_members || permissions.ban_members}
                      onKick={async (uid) => {
                        if (!confirm('Expulsar essa pessoa do servidor? Ela pode entrar de novo com um convite.')) return
                        const { error } = await kickMember(uid)
                        if (error) alert(error)
                      }}
                      onBan={async (uid) => {
                        if (!confirm('Banir essa pessoa do servidor? Ela não vai conseguir voltar sem ser desbanida antes.')) return
                        const { error } = await banMember(uid)
                        if (error) alert(error)
                      }}
                      roles={roles}
                      userRoleIds={rolesForUser(userId).map((r) => r.id)}
                      onToggleRole={async (uid, roleId) => {
                        const has = rolesForUser(uid).some((r) => r.id === roleId)
                        const { error } = has ? await removeRole(uid, roleId) : await assignRole(uid, roleId)
                        if (error) alert(error)
                      }}
                      onAddFriend={async (uname) => {
                        const { error } = await sendRequest(uname)
                        if (error) alert(error)
                      }}
                      onInvite={() => setShowInvite(true)}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <div className="px-4 pb-6 shrink-0 flex flex-wrap items-center justify-center gap-3">
            {/* Mic + seta: clicar no mic muta/desmuta na hora igual antes;
                a setinha ao lado abre um painel com escolha de
                microfone/saída de áudio, "Desativar áudio" (deafen) e um
                atalho pras configurações — mesma ideia do Discord de
                anexar as opções extras no botão em vez de espalhar em
                selects soltos pela barra. */}
            <div className="relative" ref={micMenuRef}>
              <div className="flex items-stretch rounded-full overflow-hidden">
                {voice.pushToTalkEnabled ? (
                  <div
                    title={`Push-to-talk: segure ${voice.pushToTalkKey} pra falar`}
                    className={`w-11 h-11 flex items-center justify-center transition-colors ${
                      deafened
                        ? 'bg-red-600 text-white'
                        : voice.pushToTalkActive
                          ? 'bg-discord-green text-white'
                          : 'bg-discord-lighter text-discord-text-muted'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
                    </svg>
                  </div>
                ) : (
                  <button
                    onClick={voice.toggleMute}
                    disabled={!isSpeaker}
                    title={
                      !isSpeaker
                        ? 'Só donos/moderadores podem falar neste canal Palco'
                        : voice.muted
                          ? 'Ativar microfone'
                          : 'Mutar microfone'
                    }
                    className={`w-11 h-11 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      deafened || voice.muted
                        ? 'bg-red-600 text-white'
                        : 'bg-discord-lighter text-discord-text hover:bg-discord-darker'
                    }`}
                  >
                    {deafened || voice.muted ? (
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-8.6 3.5L18 5A1 1 0 1 0 16.6 3.6L3.6 16.6A1 1 0 1 0 5 18l2-2A7 7 0 0 0 19 11zM12 15a3 3 0 0 0 3-3l-5.7 5.7A3 3 0 0 0 12 15zM9 6a3 3 0 0 1 6 0v3.5l2-2V6a5 5 0 0 0-9.9-1L9 6.6V6z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
                      </svg>
                    )}
                  </button>
                )}
                <button
                  onClick={() => setShowMicMenu((v) => !v)}
                  title="Configurações de voz"
                  className={`w-5 h-11 flex items-center justify-center transition-colors ${
                    deafened || voice.muted
                      ? 'bg-red-600/80 text-white/80 hover:text-white'
                      : 'bg-discord-lighter text-discord-text-muted hover:text-white'
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </button>
              </div>

              {showMicMenu && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-discord-darker rounded-lg shadow-xl border border-black/40 p-2 w-64 z-20">
                  {voice.audioSettings.microphones.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-bold uppercase text-discord-text-muted px-1 mb-1">Microfone</p>
                      <select
                        value={voice.audioSettings.micId ?? ''}
                        onChange={(e) => voice.changeMicrophone(e.target.value)}
                        className="w-full bg-discord-lighter text-discord-text text-xs rounded px-2 py-1.5 outline-none"
                      >
                        {voice.audioSettings.microphones.map((m) => (
                          <option key={m.deviceId} value={m.deviceId}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {voice.audioSettings.supportsOutputSelection && voice.audioSettings.speakers.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-bold uppercase text-discord-text-muted px-1 mb-1">Saída de áudio</p>
                      <select
                        value={voice.audioSettings.speakerId ?? ''}
                        onChange={(e) => voice.audioSettings.setSpeakerId(e.target.value || null)}
                        className="w-full bg-discord-lighter text-discord-text text-xs rounded px-2 py-1.5 outline-none"
                      >
                        {voice.audioSettings.speakers.map((s) => (
                          <option key={s.deviceId} value={s.deviceId}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mb-1">
                    <p className="text-[10px] text-discord-text-muted px-1 mb-1.5">Volume geral: {voice.masterVolume}%</p>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={voice.masterVolume}
                      onChange={(e) => voice.setMasterVolume(Number(e.target.value))}
                      className="w-full accent-discord-blurple px-1"
                    />
                  </div>

                  <button
                    onClick={toggleDeafen}
                    className={`w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-discord-lighter ${
                      deafened ? 'text-red-400' : 'text-discord-text'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                      <path d="M12 3a9 9 0 0 0-9 9v6a2 2 0 0 0 2 2h2v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h2a2 2 0 0 0 2-2v-6a9 9 0 0 0-9-9z" />
                    </svg>
                    {deafened ? 'Reativar áudio' : 'Desativar áudio'}
                  </button>

                  <div className="h-px bg-black/30 my-1" />

                  <button
                    onClick={() => {
                      setShowMicMenu(false)
                      setShowSettingsFromVoice(true)
                    }}
                    className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-discord-lighter text-discord-text-muted"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.9 3a7.6 7.6 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.9 7.9 0 0 0-1.8-1L16 2h-4l-.6 2.9a7.9 7.9 0 0 0-1.8 1l-2.4-1-2 3.4L7 10a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.9 7.9 0 0 0 1.8 1L12 22h4l.6-2.9a7.9 7.9 0 0 0 1.8-1l2.4 1 2-3.4-2-1.6c.05-.3.1-.6.1-1z" />
                    </svg>
                    Configurações de voz
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={voice.toggleVideo}
              title={voice.videoEnabled ? 'Desativar câmera' : 'Ativar câmera'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                voice.videoEnabled ? 'bg-discord-blurple text-white' : 'bg-discord-lighter text-discord-text hover:bg-discord-darker'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            </button>

            <button
              onClick={voice.toggleScreenShare}
              title={voice.screenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                voice.screenSharing ? 'bg-discord-blurple text-white' : 'bg-discord-lighter text-discord-text hover:bg-discord-darker'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
              </svg>
            </button>

            {/* Precisa ser escolhido ANTES de clicar em "compartilhar tela"
                — a resolução/fps viram uma constraint que já vai junto no
                próprio pedido de captura (getDisplayMedia), então depois
                que a captura começa não dá mais pra trocar (por isso some
                enquanto voice.screenSharing for true). Por isso mora aqui,
                do lado do botão de compartilhar, com um texto visível de
                verdade (não só um tooltip escondido) — antes era só um
                <select> sem legenda nenhuma, fácil de nem notar que dava
                pra escolher qualidade/fps. */}
            {!voice.screenSharing && (
              <div className="flex flex-col items-start gap-0.5">
                <span className="text-[9px] font-bold uppercase text-discord-text-muted px-1">
                  Qualidade da transmissão
                </span>
                <select
                  value={voice.screenShareQuality.quality}
                  onChange={(e) => voice.screenShareQuality.setQuality(e.target.value as 'performance' | 'quality')}
                  title="Qualidade e fps do compartilhamento de tela"
                  className="bg-discord-lighter text-discord-text text-xs rounded-full px-3 py-2 outline-none max-w-[190px] truncate"
                >
                  <option value="performance">Desempenho — 1080p, 30fps</option>
                  <option value="quality">Qualidade máxima — resolução da sua tela, até 60fps</option>
                </select>
              </div>
            )}

            <button
              onClick={() => setShowSoundboard(true)}
              title="Soundboard"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-discord-lighter text-discord-text hover:bg-discord-darker transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M9 3a1 1 0 0 1 1 1v16a1 1 0 1 1-2 0v-3.09A5.5 5.5 0 0 1 3 11.5 5.5 5.5 0 0 1 8 6.05V4a1 1 0 0 1 1-1zm6 3a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0v-.05A5.5 5.5 0 0 1 9.5 12 5.5 5.5 0 0 1 14 6.55V7a1 1 0 0 1 1-1zm4-2a1 1 0 0 1 1 1v14a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1z" />
              </svg>
            </button>

            {/* "..." — o resto das opções que não precisam de um botão
                dedicado o tempo todo, mesma ideia do menu de "mais opções"
                do Discord na barra de chamada. */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu((v) => !v)}
                title="Mais opções"
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                  showMoreMenu ? 'bg-discord-darker text-white' : 'bg-discord-lighter text-discord-text hover:bg-discord-darker'
                }`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                </svg>
              </button>

              {showMoreMenu && (
                <div className="absolute bottom-full right-0 mb-2 bg-discord-darker rounded-lg shadow-xl border border-black/40 p-2 w-60 z-20">
                  <button
                    onClick={() => {
                      setShowMoreMenu(false)
                      setShowInvite(true)
                    }}
                    className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-discord-lighter text-discord-text"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                      <path d="M15 12a5 5 0 1 0-4.9-6H9a1 1 0 1 0 0 2h1.1c.1.4.2.7.4 1H9a1 1 0 1 0 0 2h2.5c.9.6 2 1 3.2 1zM3 20a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6 1 1 0 1 1-2 0 4 4 0 0 0-4-4H9a4 4 0 0 0-4 4 1 1 0 1 1-2 0zm16-2v-2h-2v-2h2v-2h2v2h2v2h-2v2h-2z" />
                    </svg>
                    Convidar para a chamada
                  </button>

                  <div className="h-px bg-black/30 my-1" />

                  <label className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-discord-lighter text-discord-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showOwnTile}
                      onChange={(e) => setShowOwnTile(e.target.checked)}
                      className="accent-discord-blurple"
                    />
                    Mostrar minha própria câmera
                  </label>

                  <label className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-discord-lighter text-discord-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideNoVideoParticipants}
                      onChange={(e) => setHideNoVideoParticipants(e.target.checked)}
                      className="accent-discord-blurple"
                    />
                    Ocultar quem está sem câmera
                  </label>

                  <p className="text-[10px] text-discord-text-muted px-2 pt-1 pb-0.5">
                    Essas duas preferências valem só enquanto você estiver nesta chamada.
                  </p>

                  <div className="h-px bg-black/30 my-1" />

                  <button
                    onClick={() => {
                      setShowMoreMenu(false)
                      setShowSettingsFromVoice(true)
                    }}
                    className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-discord-lighter text-discord-text-muted"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.9 3a7.6 7.6 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.9 7.9 0 0 0-1.8-1L16 2h-4l-.6 2.9a7.9 7.9 0 0 0-1.8 1l-2.4-1-2 3.4L7 10a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.9 7.9 0 0 0 1.8 1L12 22h4l.6-2.9a7.9 7.9 0 0 0 1.8-1l2.4 1 2-3.4-2-1.6c.05-.3.1-.6.1-1z" />
                    </svg>
                    Configurações de voz e vídeo
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={voice.leave}
              title="Desconectar"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
              </svg>
            </button>
          </div>
        </>
      )}

      {showInvite && (
        <InviteFriendsModal
          serverId={serverId}
          channelId={channel.id}
          channelName={channel.name}
          onClose={() => setShowInvite(false)}
        />
      )}
      {showSoundboard && <SoundboardPanel serverId={serverId} onClose={() => setShowSoundboard(false)} />}
      {showSettingsFromVoice && (
        <SettingsModal initialTab="audio" onClose={() => setShowSettingsFromVoice(false)} />
      )}
    </section>
  )
}
