import { useCallback, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { VideoTile } from './CallMediaTiles'
import { useAuth } from '../../hooks/useAuth'
import { useServerMembers } from '../../hooks/useServerMembers'
import { isNativeMobileApp } from '../../lib/platform'
import { useVoiceConnectionQuality, useVoiceCore, useVoiceSpeaking, type VoiceParticipantInfo } from '../../hooks/useVoice'
import { useModeration } from '../../hooks/useModeration'
import { useRoles } from '../../hooks/useRoles'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useFriends } from '../../context/FriendsContext'
import { InviteFriendsModal } from '../modals/InviteFriendsModal'
import { SoundboardPanel } from '../ui/SoundboardPanel'
import { SettingsModal } from '../modals/SettingsModal'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import type { Channel, Profile, Role } from '../../types/database'

// VideoTile mora em CallMediaTiles.tsx (arquivo pequeno, compartilhado
// com DMCallOverlay.tsx) — ver o comentário lá pra saber por quê (tem
// a ver com esse arquivo aqui ser lazy-loaded).
//
// TRIGÉSIMA NONA RODADA — o áudio da call inteira (voz de todo mundo +
// som de toda transmissão de tela) saiu completamente deste arquivo e
// foi pro VoiceCallAudio.tsx, montado direto em MainLayout.tsx fora do
// ciclo de vida de "canal que você está olhando agora" — ver o
// comentário grande lá pro motivo (navegar pra outro canal SEM sair da
// call não pode mais parar o áudio). Este arquivo cuida só da parte
// VISUAL (vídeo, botões, sliders de volume que ALTERAM o volume
// guardado em VoiceContext, mas não tocam áudio nenhum sozinhos).

// "Palco" de compartilhamentos de tela: divide o espaço certinho
// dependendo de quantas pessoas estão compartilhando ao mesmo tempo.

function ScreenShareStage({
  shares,
  onHide,
}: {
  shares: { key: string; name: string; stream: MediaStream; isLocal: boolean }[]
  onHide: (key: string) => void
}) {
  const voice = useVoiceCore()
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
    <div
      className="grid gap-3 mb-4 w-full mx-auto animate-fade-in"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        // Só visual: limita a largura pra o palco (16:9) caber na altura
        // disponível e sobrar espaço pra tira de participantes embaixo.
        maxWidth: `calc((100dvh - 330px) / ${Math.ceil(shares.length / cols)} * 16 / 9 * ${cols})`,
      }}
    >
      {shares.map((share) => {
        const hasAudio = share.stream.getAudioTracks().length > 0
        const shareVolume = voice.getScreenShareVolume(share.key)
        const isMuted = shareVolume === 0

        return (
          <div
            key={share.key}
            className="relative aspect-video rounded-2xl overflow-hidden border border-[var(--color-line)] bg-black group/share w-full h-full shadow-[0_18px_40px_-20px_rgb(0_0_0/0.8)]"
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
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-discord-text-muted bg-discord-darker">
                <div className="w-14 h-14 rounded-2xl bg-discord-blurple/15 text-discord-blurple ring-1 ring-inset ring-discord-blurple/25 flex items-center justify-center mb-1">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                    <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
                  </svg>
                </div>
                <p className="text-[14px] font-semibold text-white text-center px-4">Você está compartilhando sua tela</p>
                <p className="text-[12px] text-center px-6 max-w-sm">
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
            {/* O áudio dessa transmissão toca via VoiceCallAudio.tsx (montado
                fora daqui, sempre ativo — ver o comentário grande no topo
                deste arquivo) — aqui só o vídeo e os controles. */}
            <span className="glass absolute bottom-2.5 left-2.5 text-[12px] font-medium text-white px-2.5 py-1 rounded-full flex items-center gap-1.5 max-w-[80%] truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" aria-hidden />
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
              </svg>
              {share.name}
              {share.isLocal && ' (você)'}
            </span>

            <div className="absolute top-2.5 right-2.5 flex items-center gap-1 p-1 rounded-full glass opacity-0 scale-95 group-hover/share:opacity-100 group-hover/share:scale-100 focus-within:opacity-100 focus-within:scale-100 transition-all duration-150">
              {!share.isLocal && hasAudio && (
                <button
                  onClick={() => voice.setScreenShareVolume(share.key, isMuted ? 100 : 0)}
                  title={isMuted ? 'Reativar áudio' : 'Silenciar essa transmissão'}
                  aria-label={isMuted ? 'Reativar áudio' : 'Silenciar essa transmissão'}
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                    isMuted ? 'bg-rose-500/20 text-rose-400' : 'text-white hover:bg-white/[0.12]'
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
                    aria-label="Ajustar volume do áudio desta transmissão"
                    className="w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-white/[0.12] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M12 3a1 1 0 0 1 1 1v16a1 1 0 0 1-1.7.7L7 16H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h3l4.3-4.7A1 1 0 0 1 12 3z" />
                    </svg>
                  </button>
                  {openVolumeFor === share.key && (
                    <div className="absolute top-10 right-0 surface-elevated rounded-xl animate-pop-in p-3 w-44 z-10">
                      <p className="text-[11px] font-semibold text-discord-text mb-2 flex justify-between"><span>Áudio da transmissão</span><span className="tabular-nums text-discord-text-muted">{shareVolume}%</span></p>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={shareVolume}
                        onChange={(e) => voice.setScreenShareVolume(share.key, Number(e.target.value))}
                        className="w-full accent-discord-blurple"
                      />
                      <p className="text-[10px] leading-snug text-discord-text-muted mt-1.5">Acima de 100% reforça o som (útil se o jogo/app estiver baixo).</p>
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
                    aria-label="Tela cheia"
                    className="w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-white/[0.12] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm16 0h-2v4h-4v2h6v-6z" />
                    </svg>
                  </button>

                  <button
                    onClick={() => goFloating(share.key)}
                    title="Janela flutuante (pode arrastar pra fora do app)"
                    aria-label="Janela flutuante (pode arrastar pra fora do app)"
                    className="w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-white/[0.12] transition-colors"
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
                aria-label="Fechar esta transmissão (continua no ar, só não aparece mais aqui)"
                className="w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-rose-500/80 transition-colors"
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

// Ícones pequenos de estado (mudo / ensurdecido) usados nos cartões.
function MicOffIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3" />
      <path d="M19 11a7 7 0 0 1-1.1 3.8M5 11a7 7 0 0 0 11.2 5.6M12 18v3M8 21h8" />
    </svg>
  )
}
function HeadphonesOffIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 3l18 18M4 18v-6a8 8 0 0 1 12.9-6.3M20 12v6a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3M4 14h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2" />
    </svg>
  )
}
function HeadphonesIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 18v-6a8 8 0 0 1 16 0v6" />
      <path d="M4 14h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM20 14h-3a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2z" />
    </svg>
  )
}

// Botão redondo grande da barra de controles da call. `tone` define o
// estado visual: neutro, ativo (ligado, cor da marca) ou "desligado em
// vermelho" (mudo / ensurdecido).
function controlBtnClass(tone: 'neutral' | 'active' | 'off') {
  const base =
    'w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
  if (tone === 'active') return `${base} bg-discord-blurple text-white shadow-[0_6px_18px_-6px_var(--color-discord-blurple)] hover:brightness-110`
  if (tone === 'off') return `${base} bg-rose-500/15 text-rose-400 ring-1 ring-inset ring-rose-500/35 hover:bg-rose-500/25`
  return `${base} bg-white/[0.07] text-discord-text hover:bg-white/[0.13] hover:text-white`
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
  selfMuted = false,
  selfDeafened = false,
}: {
  userId: string
  name: string
  username?: string
  avatarUrl?: string | null
  decorationUrl?: string | null
  data: VoiceParticipantInfo | undefined
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
  // Só pro cartão local: o estado de mudo/ensurdecido é conhecido só do
  // próprio usuário (o LiveKit não expõe isso dos outros aqui).
  selfMuted?: boolean
  selfDeafened?: boolean
}) {
  const voice = useVoiceCore()
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [videoHiddenLocally, setVideoHiddenLocally] = useState(false)
  const { menuState, openMenu, closeMenu } = useContextMenuState()
  // Lidos direto do store de atividade: só ESTE tile re-renderiza quando
  // a pessoa começa/para de falar (antes a tela da call inteira — e o app
  // todo — era redesenhada a cada mudança).
  const speaking = useVoiceSpeaking(userId)
  const peerQuality = useVoiceConnectionQuality(isLocal ? null : userId)
  const hasCameraVideo = isLocal ? localVideoEnabled : Boolean(data?.cameraStream?.getVideoTracks().length)
  const participantVolume = isLocal ? 100 : voice.getParticipantVolume(userId)

  const volumeButton = !isLocal && (
    <div
      className={
        compact
          ? 'relative'
          : 'absolute top-2.5 left-2.5 z-10 opacity-0 scale-95 group-hover/tile:opacity-100 group-hover/tile:scale-100 focus-within:opacity-100 focus-within:scale-100 transition-all duration-150'
      }
    >
      <button
        onClick={() => setShowVolumeSlider((v) => !v)}
        title="Ajustar volume deste participante"
        aria-label="Ajustar volume deste participante"
        className={
          compact
            ? 'w-6 h-6 flex items-center justify-center rounded-full bg-white/[0.07] text-discord-text-muted hover:bg-white/[0.14] hover:text-white transition-colors'
            : 'glass w-8 h-8 flex items-center justify-center rounded-full text-white hover:brightness-125 transition-all'
        }
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
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
        <div className="absolute top-full left-0 mt-1.5 surface-elevated rounded-xl animate-pop-in p-3 w-40 z-10">
          <p className="text-[11px] font-semibold text-discord-text mb-2 flex justify-between">
            <span>Volume</span>
            <span className="tabular-nums text-discord-text-muted">{participantVolume}%</span>
          </p>
          {/* Vai até 200% agora (não só 100%) — dá pra REFORÇAR o volume
              de quem tem captação de mic fraca, não só abaixar quem já
              está alto. Ver o GainNode em RemoteAudio, CallMediaTiles.tsx. */}
          <input
            type="range"
            min={0}
            max={200}
            value={participantVolume}
            onChange={(e) => voice.setParticipantVolume(userId, Number(e.target.value))}
            className="w-full accent-discord-blurple"
          />
        </div>
      )}
    </div>
  )

  // O áudio (mic/câmera) deste participante toca via VoiceCallAudio.tsx,
  // montado fora daqui e sempre ativo — ver o comentário grande no topo
  // do arquivo. Este componente só cuida do vídeo/controles visuais.

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
        className="flex flex-col items-center gap-1.5 w-[76px] shrink-0 p-2 rounded-2xl bg-white/[0.03] border border-[var(--color-line)]"
        onMouseLeave={() => setShowVolumeSlider(false)}
        onContextMenu={!isLocal ? openMenu : undefined}
      >
        <div
          className={`relative rounded-full transition-shadow duration-200 ${
            speaking ? 'ring-2 ring-discord-green ring-offset-2 ring-offset-discord-channels shadow-[0_0_14px_0] shadow-discord-green/50' : ''
          }`}
        >
          <Avatar name={name} avatarUrl={avatarUrl} decorationUrl={decorationUrl} size={44} />
          {(selfMuted || selfDeafened) && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-discord-channels flex items-center justify-center text-rose-400"
              title={selfDeafened ? 'Áudio desativado' : 'Microfone mutado'}
            >
              {selfDeafened ? <HeadphonesOffIcon className="w-3 h-3" /> : <MicOffIcon className="w-3 h-3" />}
            </span>
          )}
        </div>
        <span className="text-[11px] font-medium text-discord-text truncate max-w-full">{isLocal ? 'Você' : name}</span>
        {volumeButton}
        {menuState && !isLocal && <ContextMenu x={menuState.x} y={menuState.y} onClose={closeMenu} items={menuItems} />}
      </div>
    )
  }

  return (
    <div
      className={`relative aspect-video rounded-2xl flex items-center justify-center overflow-hidden border transition-[border-color,box-shadow] duration-200 group/tile animate-fade-in ${
        speaking
          ? 'border-discord-green/70 shadow-[0_0_0_1px_var(--color-discord-green),0_0_28px_-6px_var(--color-discord-green)]'
          : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]'
      }`}
      style={{
        background:
          'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-discord-lighter) 55%, transparent), transparent 70%), var(--color-discord-darker)',
      }}
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
        <div className="max-sm:scale-[0.6] transition-transform">
        <div className="relative flex items-center justify-center">
          {speaking && (
            <>
              <span className="absolute -inset-3 rounded-full bg-discord-green/15 animate-ping [animation-duration:1.6s]" aria-hidden />
              <span className="absolute -inset-1.5 rounded-full ring-[3px] ring-discord-green shadow-[0_0_24px_0] shadow-discord-green/50" aria-hidden />
            </>
          )}
          <div className="relative">
            <Avatar name={name} avatarUrl={avatarUrl} decorationUrl={decorationUrl} size={88} />
          </div>
        </div>
        </div>
      )}
      <span className="glass absolute bottom-2.5 left-2.5 max-w-[calc(100%-5.5rem)] text-[13px] font-medium text-white pl-2.5 pr-2.5 py-1 rounded-full flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${speaking ? 'bg-discord-green' : 'bg-white/30'}`} aria-hidden />
        <span className="truncate">
          {name}
          {isLocal && ' (você)'}
        </span>
        {!isLocal && peerQuality !== undefined && (
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
              peerQuality === 'excellent'
                ? 'text-discord-green'
                : peerQuality === 'good'
                  ? 'text-yellow-400'
                  : 'text-red-400'
            }`}
            title="Qualidade da conexão dessa pessoa com o servidor de voz"
          >
            {peerQuality === 'excellent'
              ? 'Ótima'
              : peerQuality === 'good'
                ? 'Boa'
                : peerQuality === 'poor'
                  ? 'Instável'
                  : 'Perdida'}
          </span>
        )}
      </span>
      {(selfMuted || selfDeafened) && (
        <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1">
          {selfMuted && (
            <span className="glass w-7 h-7 rounded-full flex items-center justify-center text-rose-400" title="Microfone mutado" aria-label="Microfone mutado" role="img">
              <MicOffIcon />
            </span>
          )}
          {selfDeafened && (
            <span className="glass w-7 h-7 rounded-full flex items-center justify-center text-rose-400" title="Áudio desativado" aria-label="Áudio desativado" role="img">
              <HeadphonesOffIcon />
            </span>
          )}
        </span>
      )}
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
  const voice = useVoiceCore()
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

  // Só visual: quantas colunas a grade de participantes usa, pra os
  // cartões ficarem grandes com pouca gente e compactos com muita.
  const visibleTileCount =
    (profile && showOwnTile ? 1 : 0) +
    Object.values(voice.participants).filter(
      (data) => !hideNoVideoParticipants || Boolean(data.cameraStream?.getVideoTracks().length)
    ).length
  const gridColsClass =
    visibleTileCount <= 1
      ? 'grid-cols-1 max-w-3xl'
      : visibleTileCount === 2
        ? 'grid-cols-1 sm:grid-cols-2 max-w-5xl'
        : visibleTileCount <= 4
          ? 'grid-cols-1 min-[480px]:grid-cols-2 max-w-5xl'
          : visibleTileCount <= 9
            ? 'grid-cols-2 md:grid-cols-3 max-w-6xl'
            : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'
  const aloneInCall = isConnectedHere && Object.keys(voice.participants).length === 0

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels border-t border-l border-[var(--color-line)]">
      <header className="h-14 px-4 flex items-center gap-2.5 border-b border-[var(--color-line)] shrink-0">
        <span className="w-8 h-8 rounded-[10px] bg-white/[0.05] flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px] text-discord-text-muted" aria-hidden>
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
          </svg>
        </span>
        <h2 className="font-display font-semibold text-white truncate">{channel.name}</h2>
        {isConnectedHere && (
          <span className="chip shrink-0" title="Pessoas conectadas / limite">
            <span className="w-1.5 h-1.5 rounded-full bg-discord-green" aria-hidden />
            {Object.keys(voice.participants).length + 1}/{voice.maxParticipants} conectados
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowInvite(true)}
          aria-label="Chamar amigos"
          title="Chamar amigos"
          className="h-9 px-3 sm:px-3.5 text-[13px] btn-primary flex items-center gap-1.5 shrink-0"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M15 12a5 5 0 1 0-4.9-6H9a1 1 0 1 0 0 2h1.1c.1.4.2.7.4 1H9a1 1 0 1 0 0 2h2.5c.9.6 2 1 3.2 1zM3 20a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6 1 1 0 1 1-2 0 4 4 0 0 0-4-4H9a4 4 0 0 0-4 4 1 1 0 1 1-2 0zm16-2v-2h-2v-2h2v-2h2v2h2v2h-2v2h-2z" />
          </svg>
          <span className="hidden sm:inline">Chamar amigos</span>
        </button>
      </header>

      {isConnectedElsewhere ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 animate-fade-in">
          <div className="relative w-28 h-28 mb-6 flex items-center justify-center" aria-hidden>
            <span className="absolute inset-0 rounded-full border border-[var(--color-line)]" />
            <span className="absolute inset-3 rounded-full border border-[var(--color-line-strong)]" />
            <span className="absolute inset-0 rounded-full bg-discord-blurple/10 blur-2xl" />
            <div className="relative w-16 h-16 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-[0_12px_30px_-10px_var(--color-discord-blurple)]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white">
                <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" />
              </svg>
            </div>
          </div>
          <h3 className="font-display text-xl font-semibold text-white">{channel.name}</h3>
          <p className="text-[14px] text-discord-text-muted mt-1.5 max-w-sm">
            Você já está conectado em outro canal de voz. Quer trocar pra este?
          </p>
          <button
            onClick={handleSwitchHere}
            disabled={voice.connecting}
            className="mt-6 h-11 px-6 text-[14px] btn-primary flex items-center gap-2"
          >
            {voice.connecting ? 'Trocando...' : 'Trocar de canal'}
          </button>
        </div>
      ) : !isConnectedHere ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 animate-fade-in">
          <div className="relative w-28 h-28 mb-6 flex items-center justify-center" aria-hidden>
            <span className="absolute inset-0 rounded-full border border-[var(--color-line)]" />
            <span className="absolute inset-3 rounded-full border border-[var(--color-line-strong)]" />
            <span className="absolute inset-0 rounded-full bg-discord-blurple/10 blur-2xl" />
            <div className="relative w-16 h-16 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-[0_12px_30px_-10px_var(--color-discord-blurple)]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white">
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
              </svg>
            </div>
          </div>
          <h3 className="font-display text-xl font-semibold text-white">{channel.name}</h3>
          <p className="text-[14px] text-discord-text-muted mt-1.5 max-w-sm">
            Ninguém está no canal de voz ainda. Entre pra começar uma chamada.
          </p>
          {voice.error && (
            <p role="alert" className="mt-4 max-w-sm text-[13px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-[10px] px-3 py-2">
              {voice.error}
            </p>
          )}
          <button
            onClick={async () => {
              await voice.join(channel.id, serverId)
              if (!isSpeaker) voice.toggleMute()
            }}
            disabled={voice.connecting}
            className="mt-6 h-11 px-6 rounded-[10px] bg-discord-green text-white text-[14px] font-semibold flex items-center gap-2 shadow-[0_8px_22px_-10px_var(--color-discord-green)] hover:brightness-110 hover:-translate-y-px active:translate-y-0 transition-all disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {voice.connecting ? (
              <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden>
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
              </svg>
            )}
            {voice.connecting ? 'Conectando...' : 'Entrar no canal de voz'}
          </button>
        </div>
      ) : (
        <>
          {/* Antes disso, voice.error só aparecia na tela de "ninguém no
              canal ainda" (acima) — uma vez conectado, qualquer erro (ex:
              falha na captura de áudio por processo experimental — ver
              VoiceContext.tsx) ficava guardado no estado mas NUNCA
              aparecia na tela pra ninguém ver, por mais que a mensagem
              existisse de verdade. Esse aviso aqui é o que faltava pra
              erros durante uma call em andamento serem visíveis de
              verdade. */}
          {/* Queda breve de rede: o LiveKit está tentando reconectar
              sozinho (antes a call só "congelava" sem explicação). */}
          {voice.reconnecting && (
            <div
              role="status"
              className="mx-4 mt-3 px-3.5 py-2.5 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-200 text-[13px] font-medium flex items-center gap-2.5 shrink-0 animate-fade-slide-in"
            >
              <span className="w-4 h-4 rounded-full border-2 border-amber-300/30 border-t-amber-300 animate-spin shrink-0" aria-hidden />
              Conexão instável — reconectando ao canal de voz...
            </div>
          )}
          {voice.error && (
            <div role="alert" className="mx-4 mt-3 pl-3.5 pr-1.5 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[13px] flex items-center justify-between gap-3 shrink-0 animate-fade-slide-in">
              <span className="py-1">{voice.error}</span>
              <button
                onClick={voice.clearError}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-rose-300/70 hover:text-rose-200 hover:bg-rose-500/15 shrink-0 transition-colors"
                aria-label="Fechar aviso"
                title="Fechar aviso"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="w-3.5 h-3.5" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">
            {hiddenCount > 0 && (
              <button
                onClick={() => setHiddenShareKeys(new Set())}
                className="chip mb-3 self-center !px-3 !py-1.5 !text-[12px] hover:text-white hover:bg-white/[0.1] transition-colors"
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
              <div className="flex flex-wrap gap-2.5 justify-center pt-1">
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
                    selfMuted={!voice.pushToTalkEnabled && voice.muted}
                    selfDeafened={deafened}
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
              <div className="flex-1 flex flex-col justify-center">
              <div className={`grid gap-3 w-full mx-auto ${gridColsClass}`}>
                {profile && showOwnTile && (
                  <ParticipantTile
                    userId={profile.id}
                    name={profile.display_name || profile.username}
                    avatarUrl={profile.avatar_url}
                    decorationUrl={profile.avatar_decoration_url}
                    data={undefined}
                    isLocal
                    localVideoEnabled={voice.videoEnabled}
                    selfMuted={!voice.pushToTalkEnabled && voice.muted}
                    selfDeafened={deafened}
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
              {aloneInCall && (
                <div className="mt-5 flex flex-col items-center text-center animate-fade-slide-in">
                  <p className="text-[14px] font-semibold text-white">Só você por aqui, por enquanto</p>
                  <p className="text-[13px] text-discord-text-muted mt-0.5">Chame a galera — quem entrar aparece aqui na hora.</p>
                  <button
                    onClick={() => setShowInvite(true)}
                    className="btn-secondary mt-3 h-9 px-4 text-[13px] flex items-center gap-2"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
                      <circle cx="9" cy="8" r="3.5" />
                      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
                    </svg>
                    Convidar amigos
                  </button>
                </div>
              )}
              </div>
            )}
          </div>

          <div className="px-3 pb-4 pt-1 shrink-0 flex justify-center">
          <div
            role="toolbar"
            aria-label="Controles da chamada"
            className="glass rounded-2xl px-2.5 py-2 flex flex-wrap items-center justify-center gap-2 shadow-[0_18px_44px_-18px_rgb(0_0_0/0.85)] max-w-full"
          >
            {/* Mic + seta: clicar no mic muta/desmuta na hora igual antes;
                a setinha ao lado abre um painel com escolha de
                microfone/saída de áudio, "Desativar áudio" (deafen) e um
                atalho pras configurações — mesma ideia do Discord de
                anexar as opções extras no botão em vez de espalhar em
                selects soltos pela barra. */}
            <div className="relative" ref={micMenuRef}>
              <div className="flex items-stretch rounded-full overflow-hidden ring-1 ring-inset ring-[var(--color-line)]">
                {voice.pushToTalkEnabled ? (
                  <div
                    title={`Push-to-talk: segure ${voice.pushToTalkKey} pra falar`}
                    className={`w-12 h-12 flex items-center justify-center transition-colors ${
                      deafened
                        ? 'bg-rose-500/15 text-rose-400'
                        : voice.pushToTalkActive
                          ? 'bg-discord-green text-white'
                          : 'bg-white/[0.07] text-discord-text-muted'
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
                    aria-label={
                      !isSpeaker
                        ? 'Só donos/moderadores podem falar neste canal Palco'
                        : voice.muted
                          ? 'Ativar microfone'
                          : 'Mutar microfone'
                    }
                    aria-pressed={deafened || voice.muted}
                    className={`w-12 h-12 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      deafened || voice.muted
                        ? 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
                        : 'bg-white/[0.07] text-discord-text hover:bg-white/[0.13] hover:text-white'
                    }`}
                  >
                    {deafened || voice.muted ? (
                      <MicOffIcon className="w-5 h-5" />
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
                  aria-label="Configurações de voz"
                  aria-expanded={showMicMenu}
                  className={`w-7 h-12 flex items-center justify-center border-l border-[var(--color-line)] transition-colors ${
                    deafened || voice.muted
                      ? 'bg-rose-500/10 text-rose-300/80 hover:text-rose-200 hover:bg-rose-500/20'
                      : 'bg-white/[0.05] text-discord-text-muted hover:text-white hover:bg-white/[0.12]'
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className={`w-3.5 h-3.5 transition-transform ${showMicMenu ? 'rotate-180' : ''}`}>
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </button>
              </div>

              {showMicMenu && (
                <div className="absolute bottom-full left-0 sm:left-1/2 sm:-translate-x-1/2 mb-3 surface-elevated rounded-2xl animate-pop-in p-2.5 w-72 z-20">
                  {voice.audioSettings.microphones.length > 0 && (
                    <div className="mb-2">
                      <p className="field-label px-1 !mb-1.5">Microfone</p>
                      <select
                        value={voice.audioSettings.micId ?? ''}
                        onChange={(e) => voice.changeMicrophone(e.target.value)}
                        className="w-full bg-discord-darker text-discord-text text-[13px] px-2.5 py-2 outline-none"
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
                      <p className="field-label px-1 !mb-1.5">Saída de áudio</p>
                      <select
                        value={voice.audioSettings.speakerId ?? ''}
                        onChange={(e) => voice.audioSettings.setSpeakerId(e.target.value || null)}
                        className="w-full bg-discord-darker text-discord-text text-[13px] px-2.5 py-2 outline-none"
                      >
                        {voice.audioSettings.speakers.map((s) => (
                          <option key={s.deviceId} value={s.deviceId}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mb-1.5 px-1">
                    <div className="flex items-baseline justify-between">
                      <p className="field-label !mb-1.5">Volume geral</p>
                      <span className="text-[11px] font-semibold tabular-nums text-discord-text-muted">{voice.masterVolume}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={voice.masterVolume}
                      onChange={(e) => voice.setMasterVolume(Number(e.target.value))}
                      className="w-full accent-discord-blurple"
                    />
                  </div>

                  <button
                    onClick={toggleDeafen}
                    className={`w-full flex items-center gap-2.5 text-left text-[13px] font-medium px-2.5 py-2 rounded-lg hover:bg-white/[0.06] transition-colors ${
                      deafened ? 'text-rose-400' : 'text-discord-text'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
                      <path d="M12 3a9 9 0 0 0-9 9v6a2 2 0 0 0 2 2h2v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h2a2 2 0 0 0 2-2v-6a9 9 0 0 0-9-9z" />
                    </svg>
                    {deafened ? 'Reativar áudio' : 'Desativar áudio'}
                  </button>

                  <div className="h-px bg-[var(--color-line)] my-1.5" />

                  <button
                    onClick={() => {
                      setShowMicMenu(false)
                      setShowSettingsFromVoice(true)
                    }}
                    className="w-full flex items-center gap-2.5 text-left text-[13px] font-medium px-2.5 py-2 rounded-lg hover:bg-white/[0.06] hover:text-discord-text text-discord-text-muted transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
                      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.9 3a7.6 7.6 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.9 7.9 0 0 0-1.8-1L16 2h-4l-.6 2.9a7.9 7.9 0 0 0-1.8 1l-2.4-1-2 3.4L7 10a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.9 7.9 0 0 0 1.8 1L12 22h4l.6-2.9a7.9 7.9 0 0 0 1.8-1l2.4 1 2-3.4-2-1.6c.05-.3.1-.6.1-1z" />
                    </svg>
                    Configurações de voz
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={toggleDeafen}
              title={deafened ? 'Reativar áudio' : 'Desativar áudio'}
              aria-label={deafened ? 'Reativar áudio' : 'Desativar áudio'}
              aria-pressed={deafened}
              className={controlBtnClass(deafened ? 'off' : 'neutral')}
            >
              {deafened ? <HeadphonesOffIcon className="w-5 h-5" /> : <HeadphonesIcon />}
            </button>

            <span className="hidden sm:block w-px h-7 bg-[var(--color-line-strong)] mx-0.5" aria-hidden />

            <button
              onClick={voice.toggleVideo}
              title={voice.videoEnabled ? 'Desativar câmera' : 'Ativar câmera'}
              aria-label={voice.videoEnabled ? 'Desativar câmera' : 'Ativar câmera'}
              aria-pressed={voice.videoEnabled}
              className={controlBtnClass(voice.videoEnabled ? 'active' : 'neutral')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            </button>

            <button
              onClick={() => voice.toggleScreenShare()}
              disabled={voice.screenShareConnecting}
              hidden={isNativeMobileApp()}
              title={
                voice.screenShareConnecting
                  ? 'Conectando...'
                  : voice.screenSharing
                    ? 'Parar compartilhamento'
                    : 'Compartilhar tela'
              }
              aria-label={
                voice.screenShareConnecting
                  ? 'Conectando...'
                  : voice.screenSharing
                    ? 'Parar compartilhamento'
                    : 'Compartilhar tela'
              }
              aria-pressed={voice.screenSharing}
              className={`${controlBtnClass(voice.screenSharing ? 'active' : 'neutral')} disabled:cursor-wait`}
            >
              {voice.screenShareConnecting ? (
                // VIGÉSIMA QUINTA RODADA — ver screenShareConnecting em
                // VoiceContext.tsx: a cadeia de tentativas de captura
                // (retry, HWND, plano B, fallback GDI) pode levar vários
                // segundos no pior caso. Sem isso, o botão parecia
                // travado/sem reação nesse tempo todo.
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 animate-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
                </svg>
              )}
            </button>

            {/* Só aparece DURANTE uma transmissão — troca a janela/tela
                sem precisar parar e compartilhar de novo do zero (abre o
                mesmo seletor de novo e troca o conteúdo por baixo, sem
                piscar pra quem está assistindo — ver switchScreenShareSource
                em VoiceContext.tsx). */}
            {voice.screenSharing && (
              <button
                onClick={voice.switchScreenShareSource}
                title="Trocar janela/tela compartilhada"
                aria-label="Trocar janela/tela compartilhada"
                className={controlBtnClass('neutral')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" />
                </svg>
              </button>
            )}

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
              <div className="flex items-end gap-1.5 px-1">
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted px-1">Resolução</span>
                  <select
                    value={voice.screenShareQuality.resolution}
                    onChange={(e) =>
                      voice.screenShareQuality.setResolution(e.target.value as (typeof voice.screenShareQuality.resolutionOptions)[number]['value'])
                    }
                    title="Resolução do compartilhamento de tela"
                    aria-label="Resolução do compartilhamento de tela"
                    className="bg-discord-darker text-discord-text text-xs h-8 pl-2.5 outline-none max-w-[150px] truncate"
                  >
                    {voice.screenShareQuality.resolutionOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted px-1">FPS</span>
                  <select
                    value={voice.screenShareQuality.frameRate}
                    onChange={(e) => voice.screenShareQuality.setFrameRate(Number(e.target.value) as 15 | 30 | 60)}
                    title="Taxa de quadros do compartilhamento de tela"
                    aria-label="Taxa de quadros do compartilhamento de tela"
                    className="bg-discord-darker text-discord-text text-xs h-8 pl-2.5 outline-none"
                  >
                    {voice.screenShareQuality.frameRateOptions.map((fps) => (
                      <option key={fps} value={fps}>
                        {fps}fps
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <button
              onClick={() => setShowSoundboard(true)}
              title="Soundboard"
              aria-label="Soundboard"
              aria-haspopup="dialog"
              className={controlBtnClass(showSoundboard ? 'active' : 'neutral')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </button>

            {/* "..." — o resto das opções que não precisam de um botão
                dedicado o tempo todo, mesma ideia do menu de "mais opções"
                do Discord na barra de chamada. */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu((v) => !v)}
                title="Mais opções"
                aria-label="Mais opções"
                aria-expanded={showMoreMenu}
                className={`${controlBtnClass('neutral')} ${showMoreMenu ? '!bg-white/[0.16] !text-white' : ''}`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                </svg>
              </button>

              {showMoreMenu && (
                <div className="absolute bottom-full right-0 mb-3 surface-elevated rounded-2xl animate-pop-in p-2 w-64 z-20">
                  <button
                    onClick={() => {
                      setShowMoreMenu(false)
                      setShowInvite(true)
                    }}
                    className="w-full flex items-center gap-2.5 text-left text-[13px] font-medium px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-discord-text transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
                      <path d="M15 12a5 5 0 1 0-4.9-6H9a1 1 0 1 0 0 2h1.1c.1.4.2.7.4 1H9a1 1 0 1 0 0 2h2.5c.9.6 2 1 3.2 1zM3 20a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6 1 1 0 1 1-2 0 4 4 0 0 0-4-4H9a4 4 0 0 0-4 4 1 1 0 1 1-2 0zm16-2v-2h-2v-2h2v-2h2v2h2v2h-2v2h-2z" />
                    </svg>
                    Convidar para a chamada
                  </button>

                  <div className="h-px bg-[var(--color-line)] my-1.5" />

                  <label className="w-full flex items-center gap-2.5 text-left text-[13px] px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-discord-text cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={showOwnTile}
                      onChange={(e) => setShowOwnTile(e.target.checked)}
                      className="accent-discord-blurple"
                    />
                    Mostrar minha própria câmera
                  </label>

                  <label className="w-full flex items-center gap-2.5 text-left text-[13px] px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-discord-text cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={hideNoVideoParticipants}
                      onChange={(e) => setHideNoVideoParticipants(e.target.checked)}
                      className="accent-discord-blurple"
                    />
                    Ocultar quem está sem câmera
                  </label>

                  <p className="text-[11px] leading-snug text-discord-text-muted px-2.5 pt-1 pb-0.5">
                    Essas duas preferências valem só enquanto você estiver nesta chamada.
                  </p>

                  <div className="h-px bg-[var(--color-line)] my-1.5" />

                  <button
                    onClick={() => {
                      setShowMoreMenu(false)
                      setShowSettingsFromVoice(true)
                    }}
                    className="w-full flex items-center gap-2.5 text-left text-[13px] font-medium px-2.5 py-2 rounded-lg hover:bg-white/[0.06] hover:text-discord-text text-discord-text-muted transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
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
              aria-label="Desconectar"
              className="btn-danger !rounded-full w-16 h-12 flex items-center justify-center ml-0.5"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 rotate-[135deg]" aria-hidden>
                <path d="M20 15.5c-1.2 0-2.5-.2-3.6-.6-.4-.1-.8 0-1.1.3l-2.2 2.2c-2.8-1.4-5.2-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1.1-.4-1.1-.6-2.4-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z" />
              </svg>
            </button>
          </div>
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
