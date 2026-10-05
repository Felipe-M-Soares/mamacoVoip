import { useCallback, useEffect, useRef, useState } from 'react'
import { DeviceSelect } from '../ui/DeviceSelect'
import { Avatar } from '../ui/Avatar'
import { VideoTile } from './CallMediaTiles'
import { GameStreamMenuSection } from './GameStreamControls'
import { rememberVolume, toggleVolumeMute } from '../../lib/muteMemory'
import { useAuth } from '../../hooks/useAuth'
import { useServerMembers } from '../../hooks/useServerMembers'
import { isNativeMobileApp } from '../../lib/platform'
import { useVoiceConnectionQuality, useVoiceCore, useVoiceSpeaking, type VoiceParticipantInfo } from '../../hooks/useVoice'
import { useModeration } from '../../hooks/useModeration'
import { useRoles } from '../../hooks/useRoles'
import { VoiceMemberCard, type VoiceMemberCardTarget } from './VoiceMemberCard'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useFriends } from '../../context/FriendsContext'
import { InviteFriendsModal } from '../modals/InviteFriendsModal'
import { SoundboardPanel } from '../ui/SoundboardPanel'
import { SettingsModal } from '../modals/SettingsModal'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import type { Channel, Profile, Role } from '../../types/database'
import { copyText } from '../../lib/copyText'
import { focusStream, hideStream, showStream, useStreamView } from '../../lib/streamView'
import { AudioMixer } from './AudioMixer'

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

type StageShare = { key: string; name: string; stream: MediaStream; isLocal: boolean }

function ScreenShareStage({
  shares,
  focused,
  onFocus,
  onHide,
}: {
  shares: StageShare[]
  focused: string | null
  onFocus: (key: string | null) => void
  onHide: (key: string) => void
}) {
  const focusedShare = focused ? (shares.find((s) => s.key === focused) ?? null) : null
  // Destaque: uma grande + as outras em miniatura ao lado (clique troca).
  if (focusedShare && shares.length > 1) {
    const others = shares.filter((s) => s.key !== focusedShare.key)
    return (
      <div className="flex max-lg:flex-col gap-3 mb-4 w-full animate-fade-in">
        <div className="flex-1 min-w-0 mx-auto w-full" style={{ maxWidth: 'calc((100dvh - 300px) * 16 / 9)' }}>
          <ShareTile share={focusedShare} isFocused onFocus={onFocus} onHide={onHide} />
        </div>
        <div className="flex lg:flex-col gap-2 lg:w-56 shrink-0 max-lg:overflow-x-auto lg:overflow-y-auto lg:max-h-[calc(100dvh-300px)]">
          {others.map((share) => (
            <div key={share.key} className="max-lg:w-48 shrink-0">
              <ShareTile share={share} small onFocus={onFocus} onHide={onHide} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const cols = shares.length <= 1 ? 1 : shares.length <= 4 ? 2 : 3
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
      {shares.map((share) => (
        <ShareTile
          key={share.key}
          share={share}
          onFocus={shares.length > 1 ? onFocus : undefined}
          onHide={onHide}
        />
      ))}
    </div>
  )
}

function ShareTile({
  share,
  isFocused = false,
  small = false,
  onFocus,
  onHide,
}: {
  share: StageShare
  isFocused?: boolean
  small?: boolean
  onFocus?: (key: string | null) => void
  onHide: (key: string) => void
}) {
  const voice = useVoiceCore()
  const [showVolume, setShowVolume] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const tileRef = useRef<HTMLDivElement | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const hasAudio = share.stream.getAudioTracks().length > 0
  const shareVolume = voice.getScreenShareVolume(share.key)
  const isMuted = shareVolume === 0

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === tileRef.current && tileRef.current !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Tela cheia do QUADRO inteiro (não do <video>): assim continuam os
  // MESMOS controles do app (mudo, volume) — sem os controles nativos do
  // vídeo, que brigavam com o volume do app.
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await tileRef.current?.requestFullscreen()
    } catch {
      // recusado — sem problema
    }
  }
  async function goFloating() {
    const el = videoRef.current
    if (!el) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      await el.requestPictureInPicture()
    } catch {
      // sem suporte — sem problema
    }
  }

  const btn = 'w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-white/[0.12] transition-colors'

  return (
    <div
      ref={tileRef}
      className={`relative overflow-hidden bg-black group/share w-full ${
        isFullscreen
          ? 'rounded-none border-0'
          : `aspect-video rounded-2xl border shadow-[0_18px_40px_-20px_rgb(0_0_0/0.8)] ${
              isFocused ? 'border-mv-accent/50' : 'border-[var(--color-line)]'
            }`
      } ${small ? 'cursor-pointer hover:border-[var(--color-line-strong)]' : ''}`}
      onClick={small && onFocus ? () => onFocus(share.key) : undefined}
      onDoubleClick={!small && !share.isLocal ? () => void toggleFullscreen() : undefined}
      onMouseLeave={() => setShowVolume(false)}
      title={small ? `Destacar a transmissão de ${share.name}` : undefined}
    >
      {share.isLocal ? (
        // A SUA transmissão não tem prévia ao vivo de propósito: se a
        // captura for de tela cheia, ela pegaria esta janela mostrando a
        // própria captura — o efeito de espelho infinito.
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-mv-muted bg-mv-canvas">
          {!small && (
            <div className="w-14 h-14 rounded-2xl bg-mv-accent/15 text-mv-accent ring-1 ring-inset ring-mv-accent/25 flex items-center justify-center mb-1">
              <ScreenIcon className="w-7 h-7" />
            </div>
          )}
          <p className={`${small ? 'text-[12px]' : 'text-[14px]'} font-semibold text-white text-center px-4`}>
            Você está compartilhando sua tela
          </p>
        </div>
      ) : (
        <VideoTile stream={share.stream} fit="contain" ref={videoRef} />
      )}

      <span
        className={`glass absolute bottom-2 left-2 font-medium text-white rounded-full flex items-center gap-1.5 max-w-[80%] truncate ${
          small ? 'text-[11px] px-2 py-0.5' : 'text-[12px] px-2.5 py-1'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" aria-hidden />
        {share.name}
        {share.isLocal && ' (você)'}
        {!share.isLocal && hasAudio && isMuted && <span className="text-rose-300">· mudo</span>}
      </span>

      <div
        className={`absolute top-2 right-2 flex items-center gap-1 p-1 rounded-full glass transition-all duration-150 ${
          small
            ? 'opacity-0 group-hover/share:opacity-100'
            : 'opacity-0 scale-95 group-hover/share:opacity-100 group-hover/share:scale-100 focus-within:opacity-100 focus-within:scale-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {!small && !share.isLocal && hasAudio && (
          <>
            <button
              onClick={() =>
                toggleVolumeMute(`screen:${share.key}`, shareVolume, (v) => voice.setScreenShareVolume(share.key, v), 60)
              }
              title={isMuted ? 'Reativar som da transmissão' : 'Silenciar som da transmissão'}
              aria-label={isMuted ? 'Reativar som da transmissão' : 'Silenciar som da transmissão'}
              className={isMuted ? 'w-8 h-8 flex items-center justify-center rounded-full bg-rose-500/20 text-rose-400' : btn}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                {isMuted ? (
                  <path d="M16.5 12A4.5 4.5 0 0 0 14 8v1.2l2.4 2.4c.06-.2.1-.4.1-.6zM3 3l18 18-1.4 1.4-3.4-3.4A4.5 4.5 0 0 1 14 20v-2a2.5 2.5 0 0 0 1-2v-.2L3 3.4 3 3z" />
                ) : (
                  <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8z" />
                )}
              </svg>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowVolume((v) => !v)}
                title="Volume da transmissão"
                aria-label="Volume da transmissão"
                className={btn}
              >
                <SlidersIcon />
              </button>
              {showVolume && (
                <div className="absolute top-10 right-0 surface-elevated rounded-xl animate-pop-in p-3 w-48 z-10">
                  <p className="text-[11px] font-semibold text-mv-text mb-2 flex justify-between">
                    <span>Som da transmissão</span>
                    <span className="tabular-nums text-mv-muted">{shareVolume}%</span>
                  </p>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={shareVolume}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      rememberVolume(`screen:${share.key}`, v)
                      voice.setScreenShareVolume(share.key, v)
                    }}
                    className="w-full accent-mv-accent"
                  />
                </div>
              )}
            </div>
          </>
        )}
        {!small && onFocus && !isFullscreen && (
          <button
            onClick={() => onFocus(isFocused ? null : share.key)}
            title={isFocused ? 'Sair do destaque (mostrar todas lado a lado)' : 'Destacar esta transmissão'}
            aria-label={isFocused ? 'Sair do destaque' : 'Destacar esta transmissão'}
            className={btn}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5" aria-hidden>
              {isFocused ? (
                <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
              ) : (
                <path d="M3 3h12v12H3zM18 3h3v5h-3zM18 11h3v5h-3zM3 18h18v3H3z" />
              )}
            </svg>
          </button>
        )}
        {!small && !share.isLocal && (
          <>
            <button
              onClick={() => void toggleFullscreen()}
              title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
              aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              className={btn}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                {isFullscreen ? (
                  <path d="M8 4h2v6H4V8h4V4zm6 0h2v4h4v2h-6V4zM4 14h6v6H8v-4H4v-2zm10 0h6v2h-4v4h-2v-6z" />
                ) : (
                  <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm16 0h-2v4h-4v2h6v-6z" />
                )}
              </svg>
            </button>
            <button
              onClick={goFloating}
              title="Janela flutuante (pode arrastar pra fora do app)"
              aria-label="Janela flutuante"
              className={btn}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zm-2-7h-6v5h6v-5z" />
              </svg>
            </button>
          </>
        )}
        {/* Fecha só pra você: some o vídeo E o som (continua no ar pros outros). */}
        <button
          onClick={() => onHide(share.key)}
          title="Fechar esta transmissão (some o vídeo e o som só pra você)"
          aria-label="Fechar esta transmissão"
          className="w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-rose-500/80 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function ScreenIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
    </svg>
  )
}

function SlidersIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  )
}

// Gerenciador de transmissões: uma pílula por pessoa ao vivo. Clique =
// assistir em destaque; o olho fecha/reabre (fechada = sem vídeo e sem som).
function StreamManagerBar({
  shares,
  hidden,
  focused,
}: {
  shares: StageShare[]
  hidden: ReadonlySet<string>
  focused: string | null
}) {
  return (
    <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 shrink-0" role="toolbar" aria-label="Transmissões ao vivo">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mv-muted shrink-0 mr-1">
        Ao vivo · {shares.length}
      </span>
      {shares.map((s) => {
        const isHidden = hidden.has(s.key)
        const isFocused = focused === s.key
        return (
          <div
            key={s.key}
            className={`flex items-center shrink-0 rounded-full border text-[12px] transition-colors ${
              isFocused
                ? 'border-mv-accent/60 bg-mv-accent/15 text-white'
                : isHidden
                  ? 'border-[var(--color-line)] text-mv-muted'
                  : 'border-[var(--color-line-strong)] text-mv-text bg-white/[0.03]'
            }`}
          >
            <button
              type="button"
              onClick={() => focusStream(isFocused ? null : s.key)}
              title={isFocused ? 'Mostrar todas lado a lado' : `Assistir ${s.name} em destaque`}
              className="flex items-center gap-1.5 pl-2.5 pr-1.5 h-7 font-medium"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isHidden ? 'bg-white/30' : 'bg-rose-500'}`} aria-hidden />
              <span className="max-w-[140px] truncate">
                {s.name}
                {s.isLocal && ' (você)'}
              </span>
              {isHidden && !s.isLocal && <span className="text-mv-accent font-semibold">· Assistir</span>}
            </button>
            <button
              type="button"
              onClick={() => (isHidden ? showStream(s.key) : hideStream(s.key))}
              title={isHidden ? 'Reabrir (vídeo e som)' : 'Fechar (some o vídeo e o som só pra você)'}
              aria-label={isHidden ? `Reabrir transmissão de ${s.name}` : `Fechar transmissão de ${s.name}`}
              className="w-7 h-7 flex items-center justify-center rounded-full text-mv-muted hover:text-white hover:bg-white/[0.08]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3.5 h-3.5" aria-hidden>
                {isHidden ? (
                  <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6M6.6 6.6C3.9 8.3 2.5 12 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.2-1" />
                ) : (
                  <>
                    <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
                    <circle cx="12" cy="12" r="2.5" />
                  </>
                )}
              </svg>
            </button>
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
  if (tone === 'active') return `${base} bg-mv-accent text-white shadow-[0_6px_18px_-6px_var(--color-mv-accent)] hover:brightness-110`
  if (tone === 'off') return `${base} bg-rose-500/15 text-rose-400 ring-1 ring-inset ring-rose-500/35 hover:bg-rose-500/25`
  return `${base} bg-white/[0.07] text-mv-text hover:bg-white/[0.13] hover:text-white`
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
  onOpenCard,
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
  /** Clique no quadro: abre o cartão de opções (VoiceMemberCard) */
  onOpenCard?: (userId: string, x: number, y: number) => void
  // Só pro cartão local: o estado de mudo/ensurdecido é conhecido só do
  // próprio usuário (o LiveKit não expõe isso dos outros aqui).
  selfMuted?: boolean
  selfDeafened?: boolean
}) {
  const voice = useVoiceCore()
  const [videoHiddenLocally, setVideoHiddenLocally] = useState(false)
  const { menuState, openMenu, closeMenu } = useContextMenuState()
  // Lidos direto do store de atividade: só ESTE tile re-renderiza quando
  // a pessoa começa/para de falar (antes a tela da call inteira — e o app
  // todo — era redesenhada a cada mudança).
  const speaking = useVoiceSpeaking(userId)
  const peerQuality = useVoiceConnectionQuality(isLocal ? null : userId)
  const cameraStream = isLocal ? voice.localCameraStream : data?.cameraStream ?? null
  const hasCameraVideo = isLocal ? Boolean(localVideoEnabled && cameraStream) : Boolean(data?.cameraStream?.getVideoTracks().length)

  // O volume de cada pessoa fica no cartão que abre ao clicar no quadro
  // (VoiceMemberCard) e no mixer "Volumes" da barra de controles — antes
  // havia mais um slider escondido em cada quadro, que às vezes abria
  // cortado e brigava com o clique do cartão.

  // O áudio (mic/câmera) deste participante toca via VoiceCallAudio.tsx,
  // montado fora daqui e sempre ativo — ver o comentário grande no topo
  // do arquivo. Este componente só cuida do vídeo/controles visuais.

  const myRoleIds = new Set(userRoleIds ?? [])
  const menuItems = [
    { label: 'Ver perfil', onClick: () => onViewProfile?.(userId) },
    { label: 'Mensagem', onClick: () => onMessageUser?.(userId) },
    ...(username ? [{ label: 'Mencionar (copiar @)', onClick: () => copyText(`@${username}`) }] : []),
    {
      label: videoHiddenLocally ? 'Mostrar vídeo' : 'Desativar vídeo (só pra você)',
      onClick: () => setVideoHiddenLocally((v) => !v),
    },
    ...(username
      ? [{ label: 'Adicionar amigo', onClick: () => onAddFriend?.(username) }]
      : []),
    ...(onInvite ? [{ label: 'Convidar para o servidor', onClick: () => onInvite() }] : []),
    { label: 'Copiar ID do usuário', onClick: () => copyText(userId) },
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
        className="flex flex-col items-center gap-1.5 w-[76px] shrink-0 p-2 rounded-2xl hover:bg-white/[0.04] transition-colors"
        onClick={(e) => {
          if (!onOpenCard || (e.target as HTMLElement).closest('button, input, a')) return
          onOpenCard(userId, e.clientX, e.clientY)
        }}
        onContextMenu={!isLocal ? openMenu : undefined}
      >
        <div
          className={`relative rounded-full transition-shadow duration-200 ${
            speaking ? 'ring-2 ring-mv-speaking ring-offset-2 ring-offset-mv-main shadow-[0_0_14px_0] shadow-mv-speaking/50' : ''
          }`}
        >
          <Avatar name={name} avatarUrl={avatarUrl} decorationUrl={decorationUrl} size={44} />
          {(selfMuted || selfDeafened) && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-mv-main flex items-center justify-center text-rose-400"
              title={selfDeafened ? 'Áudio desativado' : 'Microfone mutado'}
            >
              {selfDeafened ? <HeadphonesOffIcon className="w-3 h-3" /> : <MicOffIcon className="w-3 h-3" />}
            </span>
          )}
        </div>
        <span className="text-[11px] font-medium text-mv-text truncate max-w-full">{isLocal ? 'Você' : name}</span>
        {menuState && !isLocal && <ContextMenu x={menuState.x} y={menuState.y} onClose={closeMenu} items={menuItems} />}
      </div>
    )
  }

  return (
    <div
      className={`relative aspect-video rounded-2xl flex items-center justify-center overflow-hidden border transition-[border-color,box-shadow] duration-200 group/tile animate-fade-in ${
        speaking
          ? 'border-mv-speaking/70 shadow-[0_0_0_1px_var(--color-mv-speaking),0_0_28px_-6px_var(--color-mv-speaking)]'
          : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]'
      }`}
      style={{
        background:
          'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-mv-raised) 55%, transparent), transparent 70%), var(--color-mv-canvas)',
      }}
      onClick={(e) => {
        if (!onOpenCard || (e.target as HTMLElement).closest('button, input, a')) return
        onOpenCard(userId, e.clientX, e.clientY)
      }}
      onContextMenu={!isLocal ? openMenu : undefined}
    >
      {hasCameraVideo && cameraStream && !videoHiddenLocally ? (
        // Prévia própria espelhada (como um espelho), padrão de apps de vídeo;
        // quem assiste recebe a imagem normal.
        <VideoTile stream={cameraStream} sinkId={sinkId} mirror={isLocal} />
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
              <span className="absolute -inset-3 rounded-full bg-mv-speaking/15 animate-ping [animation-duration:1.6s]" aria-hidden />
              <span className="absolute -inset-1.5 rounded-full ring-[3px] ring-mv-speaking shadow-[0_0_24px_0] shadow-mv-speaking/50" aria-hidden />
            </>
          )}
          <div className="relative">
            <Avatar name={name} avatarUrl={avatarUrl} decorationUrl={decorationUrl} size={88} />
          </div>
        </div>
        </div>
      )}
      <span className="glass absolute bottom-2.5 left-2.5 max-w-[calc(100%-5.5rem)] text-[13px] font-medium text-white pl-2.5 pr-2.5 py-1 rounded-full flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${speaking ? 'bg-mv-speaking' : 'bg-white/30'}`} aria-hidden />
        <span className="truncate">
          {name}
          {isLocal && ' (você)'}
        </span>
        {!isLocal && peerQuality !== undefined && (
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
              peerQuality === 'excellent'
                ? 'text-mv-green'
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
  const { hidden: hiddenShareKeys, focused: focusedShareKey } = useStreamView()
  const [showMixer, setShowMixer] = useState(false)
  const mixerRef = useClickOutside<HTMLDivElement>(showMixer, useCallback(() => setShowMixer(false), []))

  const [memberCard, setMemberCard] = useState<VoiceMemberCardTarget | null>(null)
  function openMemberCard(userId: string, x: number, y: number) {
    setMemberCard({ userId, serverId, channelId: channel.id, x, y })
  }

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
    <section className="flex-1 flex flex-col min-w-0 bg-mv-main border-t border-l border-[var(--color-line)]">
      <header className="h-14 px-4 flex items-center gap-2.5 border-b border-[var(--color-line)] shrink-0">
        <span className="w-8 h-8 rounded-[10px] bg-white/[0.05] flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px] text-mv-muted" aria-hidden>
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
          </svg>
        </span>
        <h2 className="font-display font-semibold text-white truncate">{channel.name}</h2>
        {isConnectedHere && (
          <span className="chip shrink-0" title="Pessoas conectadas / limite">
            <span className="w-1.5 h-1.5 rounded-full bg-mv-green" aria-hidden />
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
            <span className="absolute inset-0 rounded-full bg-mv-accent/10 blur-2xl" />
            <div className="relative w-16 h-16 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-[0_12px_30px_-10px_var(--color-mv-accent)]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white">
                <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" />
              </svg>
            </div>
          </div>
          <h3 className="font-display text-xl font-semibold text-white">{channel.name}</h3>
          <p className="text-[14px] text-mv-muted mt-1.5 max-w-sm">
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
            <span className="absolute inset-0 rounded-full bg-mv-accent/10 blur-2xl" />
            <div className="relative w-16 h-16 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-[0_12px_30px_-10px_var(--color-mv-accent)]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white">
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
              </svg>
            </div>
          </div>
          <h3 className="font-display text-xl font-semibold text-white">{channel.name}</h3>
          <p className="text-[14px] text-mv-muted mt-1.5 max-w-sm">
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
            className="mt-6 h-11 px-6 rounded-[10px] bg-mv-green text-white text-[14px] font-semibold flex items-center gap-2 shadow-[0_8px_22px_-10px_var(--color-mv-green)] hover:brightness-110 hover:-translate-y-px active:translate-y-0 transition-all disabled:opacity-60 disabled:hover:translate-y-0"
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
            {(screenShares.length > 1 || hiddenCount > 0) && (
              <StreamManagerBar shares={screenShares} hidden={hiddenShareKeys} focused={focusedShareKey} />
            )}
            {!hasScreenShares && hiddenCount > 0 && (
              // Transmissões fechadas: nada é baixado até clicar em Assistir.
              <div className="flex flex-wrap gap-3 justify-center mb-4">
                {screenShares
                  .filter((s) => hiddenShareKeys.has(s.key))
                  .map((s) => (
                    <div
                      key={s.key}
                      className="w-full max-w-sm aspect-video rounded-2xl border border-[var(--color-line)] bg-mv-canvas flex flex-col items-center justify-center gap-3 px-4 text-center"
                    >
                      <p className="text-[14px] font-semibold text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" aria-hidden />
                        {s.name} está ao vivo
                      </p>
                      <button type="button" onClick={() => focusStream(s.key)} className="btn-primary h-9 px-4 text-[13px]">
                        Assistir transmissão
                      </button>
                    </div>
                  ))}
              </div>
            )}
            {hasScreenShares && (
              <ScreenShareStage
                shares={visibleScreenShares}
                focused={focusedShareKey}
                onFocus={focusStream}
                onHide={hideStream}
              />
            )}

            {hasScreenShares ? (
              // Com tela(s) compartilhada(s) em foco, os participantes viram
              // uma tira compacta embaixo do palco em vez do grid grande.
              <div className="flex flex-wrap gap-2.5 justify-center pt-1">
                {profile && showOwnTile && (
                  <ParticipantTile
                    onOpenCard={openMemberCard}
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
                    onOpenCard={openMemberCard}
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
                    onOpenCard={openMemberCard}
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
                    onOpenCard={openMemberCard}
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
                  <p className="text-[13px] text-mv-muted mt-0.5">Chame a galera — quem entrar aparece aqui na hora.</p>
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
                atalho pras configurações — mesma ideia de apps de chat populares de
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
                          ? 'bg-mv-green text-white'
                          : 'bg-white/[0.07] text-mv-muted'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
                    </svg>
                  </div>
                ) : (
                  <button
                    onClick={() => voice.toggleMute()}
                    disabled={!isSpeaker}
                    title={
                      !isSpeaker
                        ? 'Só donos/moderadores podem falar neste canal de palco'
                        : voice.muted
                          ? 'Ativar microfone'
                          : 'Mutar microfone'
                    }
                    aria-label={
                      !isSpeaker
                        ? 'Só donos/moderadores podem falar neste canal de palco'
                        : voice.muted
                          ? 'Ativar microfone'
                          : 'Mutar microfone'
                    }
                    aria-pressed={deafened || voice.muted}
                    className={`w-12 h-12 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      deafened || voice.muted
                        ? 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
                        : 'bg-white/[0.07] text-mv-text hover:bg-white/[0.13] hover:text-white'
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
                      : 'bg-white/[0.05] text-mv-muted hover:text-white hover:bg-white/[0.12]'
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
                      <DeviceSelect
                        value={voice.audioSettings.micId}
                        options={voice.audioSettings.microphones}
                        onChange={(id) => void voice.changeMicrophone(id ?? '')}
                        className="w-full bg-mv-canvas text-mv-text text-[13px] px-2.5 py-2 outline-none"
                        ariaLabel="Microfone"
                      />
                    </div>
                  )}

                  {voice.audioSettings.supportsOutputSelection && voice.audioSettings.speakers.length > 0 && (
                    <div className="mb-2">
                      <p className="field-label px-1 !mb-1.5">Saída de áudio</p>
                      <DeviceSelect
                        value={voice.audioSettings.speakerId}
                        options={voice.audioSettings.speakers}
                        onChange={(id) => voice.audioSettings.setSpeakerId(id)}
                        className="w-full bg-mv-canvas text-mv-text text-[13px] px-2.5 py-2 outline-none"
                        ariaLabel="Saída de áudio"
                      />
                    </div>
                  )}

                  {/* "Desativar áudio" fica no botão do fone, ao lado — sem repetir aqui. */}

                  <div className="h-px bg-[var(--color-line)] my-1.5" />

                  <button
                    onClick={() => {
                      setShowMicMenu(false)
                      setShowSettingsFromVoice(true)
                    }}
                    className="w-full flex items-center gap-2.5 text-left text-[13px] font-medium px-2.5 py-2 rounded-lg hover:bg-white/[0.06] hover:text-mv-text text-mv-muted transition-colors"
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

            {/* Mixer: todos os volumes (geral, efeitos, cada voz, cada
                transmissão) num lugar só. */}
            <div className="relative" ref={mixerRef}>
              <button
                onClick={() => setShowMixer((v) => !v)}
                title="Volumes (vozes e transmissões)"
                aria-label="Volumes (vozes e transmissões)"
                aria-expanded={showMixer}
                className={controlBtnClass(showMixer ? 'active' : 'neutral')}
              >
                <SlidersIcon className="w-5 h-5" />
              </button>
              {showMixer && (
                <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 max-sm:left-auto max-sm:right-0 max-sm:translate-x-0 surface-elevated rounded-2xl p-3 z-30 animate-pop-in">
                  <AudioMixer profileById={profileById} />
                </div>
              )}
            </div>

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
              <div className="flex items-end gap-1.5 px-1 max-sm:hidden">
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-mv-muted px-1">Resolução</span>
                  <select
                    value={voice.screenShareQuality.resolution}
                    onChange={(e) =>
                      voice.screenShareQuality.setResolution(e.target.value as (typeof voice.screenShareQuality.resolutionOptions)[number]['value'])
                    }
                    title="Resolução do compartilhamento de tela"
                    aria-label="Resolução do compartilhamento de tela"
                    className="bg-mv-canvas text-mv-text text-xs h-8 pl-2.5 outline-none max-w-[150px] truncate"
                  >
                    {voice.screenShareQuality.resolutionOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-mv-muted px-1">FPS</span>
                  <select
                    value={voice.screenShareQuality.frameRate}
                    onChange={(e) => voice.screenShareQuality.setFrameRate(Number(e.target.value) as 15 | 30 | 60)}
                    title="Taxa de quadros do compartilhamento de tela"
                    aria-label="Taxa de quadros do compartilhamento de tela"
                    className="bg-mv-canvas text-mv-text text-xs h-8 pl-2.5 outline-none"
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
                de apps de chat populares na barra de chamada. */}
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
                    className="w-full flex items-center gap-2.5 text-left text-[13px] font-medium px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-mv-text transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
                      <path d="M15 12a5 5 0 1 0-4.9-6H9a1 1 0 1 0 0 2h1.1c.1.4.2.7.4 1H9a1 1 0 1 0 0 2h2.5c.9.6 2 1 3.2 1zM3 20a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6 1 1 0 1 1-2 0 4 4 0 0 0-4-4H9a4 4 0 0 0-4 4 1 1 0 1 1-2 0zm16-2v-2h-2v-2h2v-2h2v2h2v2h-2v2h-2z" />
                    </svg>
                    Convidar para a chamada
                  </button>

                  <div className="h-px bg-[var(--color-line)] my-1.5" />

                  <label className="w-full flex items-center gap-2.5 text-left text-[13px] px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-mv-text cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={showOwnTile}
                      onChange={(e) => setShowOwnTile(e.target.checked)}
                      className="accent-mv-accent"
                    />
                    Mostrar minha própria câmera
                  </label>

                  <label className="w-full flex items-center gap-2.5 text-left text-[13px] px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-mv-text cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={hideNoVideoParticipants}
                      onChange={(e) => setHideNoVideoParticipants(e.target.checked)}
                      className="accent-mv-accent"
                    />
                    Ocultar quem está sem câmera
                  </label>

                  <p className="text-[11px] leading-snug text-mv-muted px-2.5 pt-1 pb-0.5">
                    Essas duas preferências valem só enquanto você estiver nesta chamada.
                  </p>

                  {/* Só no app desktop: detecção de jogo e sobreposição dependem do Electron. */}
                  {Boolean(window.electronAPI) && (
                    <>
                      <div className="h-px bg-[var(--color-line)] my-1.5" />
                      <GameStreamMenuSection />
                    </>
                  )}

                  <div className="h-px bg-[var(--color-line)] my-1.5" />

                  <button
                    onClick={() => {
                      setShowMoreMenu(false)
                      setShowSettingsFromVoice(true)
                    }}
                    className="w-full flex items-center gap-2.5 text-left text-[13px] font-medium px-2.5 py-2 rounded-lg hover:bg-white/[0.06] hover:text-mv-text text-mv-muted transition-colors"
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
      {memberCard && <VoiceMemberCard target={memberCard} onClose={() => setMemberCard(null)} />}
      {showSettingsFromVoice && (
        <SettingsModal initialTab="audio" onClose={() => setShowSettingsFromVoice(false)} />
      )}
    </section>
  )
}
