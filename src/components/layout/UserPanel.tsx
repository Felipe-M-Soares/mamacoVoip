import { useCallback, useEffect, useState } from 'react'
import { RangeInput } from '../ui/RangeInput'
import { DeviceSelect } from '../ui/DeviceSelect'
import { useAuth } from '../../hooks/useAuth'
import { useLocalVoiceConnectionQuality, useVoiceCore } from '../../hooks/useVoice'
import { useConnectionPing } from '../../hooks/useConnectionPing'
import { useVoiceMediaRtt } from '../../hooks/useVoiceMediaRtt'
import { describeMediaPath } from '../../lib/webrtcRtt'
import { useClickOutside } from '../../hooks/useClickOutside'
import { Avatar } from '../ui/Avatar'
import type { ProfileStatus } from '../../types/database'
import { lazyModal } from '../modals/lazyModal'
import {
  CameraOffIcon,
  CameraIcon as VideoIcon,
  CheckIcon,
  ChevronDownIcon,
  HangUpIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon as MicGlyph,
  MicOffIcon,
  NoiseSuppressionIcon,
  ScreenShareIcon as ScreenShareGlyph,
  SettingsIcon,
  SoundboardIcon,
  VoiceConnectedIcon,
} from '../ui/icons'

const EditProfileModal = lazyModal(() => import('../modals/EditProfileModal').then((m) => m.EditProfileModal))
const SettingsModal = lazyModal(() => import('../modals/SettingsModal').then((m) => m.SettingsModal))
import type { SettingsTab } from '../modals/SettingsModal'
const SoundboardPanel = lazyModal(() => import('../ui/SoundboardPanel').then((m) => m.SoundboardPanel))

const STATUS_OPTIONS: { value: ProfileStatus; label: string; dot: string }[] = [
  { value: 'online', label: 'Online', dot: 'bg-mv-green' },
  { value: 'idle', label: 'Ausente', dot: 'bg-yellow-500' },
  { value: 'dnd', label: 'Não perturbe', dot: 'bg-red-500' },
  { value: 'offline', label: 'Invisível', dot: 'bg-gray-500' },
]

function WifiSignalIcon({ pingMs, size = 12 }: { pingMs: number | null; size?: number }) {
  const tier = pingMs === null ? 'none' : pingMs < 100 ? 'good' : pingMs < 250 ? 'ok' : 'bad'
  const color =
    tier === 'good'
      ? 'text-mv-green'
      : tier === 'ok'
        ? 'text-yellow-500'
        : tier === 'bad'
          ? 'text-red-500'
          : 'text-mv-muted/40'
  const litBars = tier === 'good' ? 3 : tier === 'ok' ? 2 : tier === 'bad' ? 1 : 0
  const unit = size / 3

  return (
    <span className={`inline-flex items-end justify-center gap-[2px] shrink-0 ${color}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`rounded-sm bg-current ${i < litBars ? '' : 'opacity-25'}`}
          style={{ width: Math.max(2, unit * 0.4), height: unit + i * unit }}
        />
      ))}
    </span>
  )
}

function BroadcastIcon({ className }: { className?: string }) {
  return <VoiceConnectedIcon className={className} aria-hidden />
}

function PhoneHangupIcon({ className }: { className?: string }) {
  return <HangUpIcon className={className} aria-hidden />
}

function CameraIcon({ off, className }: { off?: boolean; className?: string }) {
  return off ? <CameraOffIcon className={className} aria-hidden /> : <VideoIcon className={className} aria-hidden />
}

function ScreenShareIcon({ className }: { className?: string }) {
  return <ScreenShareGlyph className={className} aria-hidden />
}

function GridIcon({ className }: { className?: string }) {
  return <SoundboardIcon className={className} aria-hidden />
}

function SparkleIcon({ className }: { className?: string }) {
  return <NoiseSuppressionIcon className={className} aria-hidden />
}

function MicIcon({ muted, className }: { muted?: boolean; className?: string }) {
  return muted ? <MicOffIcon className={className} aria-hidden /> : <MicGlyph className={className} aria-hidden />
}

function HeadphoneIcon({ off, className }: { off?: boolean; className?: string }) {
  return off ? <HeadphonesOffIcon className={className} aria-hidden /> : <HeadphonesIcon className={className} aria-hidden />
}

function GearIcon({ className }: { className?: string }) {
  return <SettingsIcon className={className} aria-hidden />
}

function ChevronIcon({ className }: { className?: string }) {
  return <ChevronDownIcon className={className} strokeWidth={3} aria-hidden />
}

function HudSquareButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active ?? undefined}
      style={{ '--cut': '7px' } as React.CSSProperties}
      className={`mv-ctl !w-full !h-9 ${active ? 'mv-ctl--active' : 'mv-ctl--neutral !text-mv-muted hover:!text-white'}`}
    >
      {children}
    </button>
  )
}

function PlayingActivityCard() {
  const { profile } = useAuth()
  const voice = useVoiceCore()
  if (!profile?.playing) return null

  const subtitle = voice.connectedChannelId
    ? voice.screenSharing
      ? 'Compartilhando tela'
      : 'Não compartilhando'
    : 'Jogando agora'

  return (
    <div className="mx-2 mt-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-[var(--color-line)] flex items-center gap-2.5 shrink-0">
      <span className="text-base shrink-0">🎮</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white truncate leading-tight">{profile.playing}</p>
        <p className="text-[11px] text-mv-muted truncate leading-tight">{subtitle}</p>
      </div>
    </div>
  )
}

function VoiceHud() {
  const voice = useVoiceCore()
  const [showSoundboard, setShowSoundboard] = useState(false)
  useEffect(() => {
    const open = () => setShowSoundboard(true)
    window.addEventListener('mv:open-soundboard', open)
    return () => window.removeEventListener('mv:open-soundboard', open)
  }, [])

  if (!voice.connectedChannelId) return null

  function toggleNoiseSuppression() {
    const next = !voice.audioSettings.noiseSuppression
    voice.audioSettings.setNoiseSuppression(next)
    voice.refreshAudioConstraints({ noiseSuppression: next })
  }

  return (
    <div className="mx-2 mt-2 rounded-md bg-gradient-to-b from-mv-green/[0.09] to-mv-green/[0.03] shadow-[inset_0_0_0_1px_rgb(34_197_94_/_0.22),inset_2px_0_0_var(--color-mv-green)] overflow-hidden shrink-0">
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => {
            if (!voice.connectedServerId || !voice.connectedChannelId) return
            window.dispatchEvent(
              new CustomEvent('mv:open-voice-room', {
                detail: { serverId: voice.connectedServerId, channelId: voice.connectedChannelId },
              })
            )
          }}
          disabled={!voice.connectedServerId}
          title={voice.connectedServerId ? 'Voltar para a sala de voz' : undefined}
          className="min-w-0 flex-1 flex items-center gap-2.5 text-left rounded -m-1 p-1 enabled:hover:bg-white/[0.05] transition-colors group/hud"
        >
          <BroadcastIcon className="w-4 h-4 text-mv-green shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-display text-[10.5px] font-bold uppercase tracking-[0.14em] text-mv-green truncate leading-tight"><span className="mv-live-dot shrink-0" aria-hidden />Voz conectada</span>
            <span className="block text-sm text-mv-muted group-enabled/hud:group-hover/hud:text-mv-text group-enabled/hud:group-hover/hud:underline truncate leading-tight">
              {voice.connectedChannelName ?? '...'}
            </span>
          </span>
        </button>
        <button
          onClick={voice.leave}
          title="Desconectar"
          aria-label="Desconectar"
          className="mv-close !w-8 !h-8 shrink-0 hover:!bg-red-500/20 hover:!text-red-400"
        >
          <PhoneHangupIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="px-2 pb-2 grid grid-cols-4 gap-1.5">
        <HudSquareButton active={voice.videoEnabled} title={voice.videoEnabled ? 'Desativar câmera' : 'Ativar câmera'} onClick={voice.toggleVideo}>
          <CameraIcon off={!voice.videoEnabled} className="w-4 h-4" />
        </HudSquareButton>
        <HudSquareButton
          active={voice.screenSharing}
          title={voice.screenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
          onClick={voice.toggleScreenShare}
        >
          <ScreenShareIcon className="w-4 h-4" />
        </HudSquareButton>
        {voice.connectedServerId && (
          <HudSquareButton title="Soundboard" onClick={() => setShowSoundboard(true)}>
            <GridIcon className="w-4 h-4" />
          </HudSquareButton>
        )}
        <HudSquareButton
          active={voice.audioSettings.noiseSuppression}
          title={voice.audioSettings.noiseSuppression ? 'Desativar redução de ruído' : 'Ativar redução de ruído'}
          onClick={toggleNoiseSuppression}
        >
          <SparkleIcon className="w-4 h-4" />
        </HudSquareButton>
      </div>

      {showSoundboard && voice.connectedServerId && (
        <SoundboardPanel serverId={voice.connectedServerId} onClose={() => setShowSoundboard(false)} />
      )}
    </div>
  )
}

export function UserPanel() {
  const { profile, signOut, updateStatus } = useAuth()
  const voice = useVoiceCore()
  const apiPingMs = useConnectionPing()
  const localConnectionQuality = useLocalVoiceConnectionQuality()
  const mediaPath = useVoiceMediaRtt(Boolean(voice.connectedChannelId))
  const callQualityMs: number | null = !voice.connectedChannelId
    ? null
    : mediaPath
      ? mediaPath.rttMs
      : localConnectionQuality
        ? localConnectionQuality === 'excellent'
          ? 40
          : localConnectionQuality === 'good'
            ? 150
            : 350
        : null
  const pingMs = callQualityMs ?? apiPingMs
  const callQualityLabel =
    localConnectionQuality === 'excellent'
      ? 'Ótima'
      : localConnectionQuality === 'good'
        ? 'Boa'
        : localConnectionQuality === 'poor'
          ? 'Instável'
          : 'Perdida'
  const pingLabel =
    pingMs === null
      ? 'Medindo sua conexão...'
      : callQualityMs !== null
        ? mediaPath
          ? `Ping da chamada: ${mediaPath.rttMs}ms até o servidor de voz (${describeMediaPath(mediaPath)}) — ${callQualityLabel}`
          : `Conexão com a chamada: ${callQualityLabel}`
        : `${pingMs}ms até o servidor`
  const [menuOpen, setMenuOpen] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [showSettings, setShowSettings] = useState<SettingsTab | null>(null)
  const [micMenuOpen, setMicMenuOpen] = useState(false)
  const [headphoneMenuOpen, setHeadphoneMenuOpen] = useState(false)

  const menuRef = useClickOutside<HTMLDivElement>(menuOpen, useCallback(() => setMenuOpen(false), []))
  const micMenuRef = useClickOutside<HTMLDivElement>(micMenuOpen, useCallback(() => setMicMenuOpen(false), []))
  const headphoneMenuRef = useClickOutside<HTMLDivElement>(headphoneMenuOpen, useCallback(() => setHeadphoneMenuOpen(false), []))

  if (!profile) return null

  return (
    <div data-tour="user-panel" className="shrink-0 p-2 bg-mv-canvas">
      <div className="mv-brackets rounded-2xl bg-[var(--color-elevated)] border border-[var(--color-line)] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7)]">
      <div
        title={pingLabel}
        className="h-7 px-3 flex items-center gap-1.5 border-b border-[var(--color-line)]"
      >
        <WifiSignalIcon pingMs={pingMs} size={12} />
        <span className="text-[10px] text-mv-muted truncate">
          {pingMs === null
            ? 'Medindo conexão...'
            : callQualityMs !== null
              ? mediaPath
                ? `${mediaPath.rttMs}ms · ${callQualityLabel}`
                : callQualityLabel
              : `${pingMs}ms`}
        </span>
      </div>

      <PlayingActivityCard />
      <VoiceHud />

      <div className="relative h-14 px-1.5 flex items-center gap-0.5" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex items-center gap-2.5 flex-1 min-w-0 px-1.5 py-1.5 rounded-xl hover:bg-white/[0.06] transition-colors"
      >
        <Avatar
          name={profile.username}
          avatarUrl={profile.avatar_url}
          decorationUrl={profile.avatar_decoration_url}
          status={profile.status}
          userId={profile.id}
          size={36}
        />
        <div className="min-w-0 text-left">
          <p className="text-sm font-medium text-white truncate">{profile.display_name || profile.username}</p>
          {voice.connectedChannelId ? (
            <p className="flex items-center gap-1 text-xs text-mv-green truncate">
              <BroadcastIcon className="w-3 h-3 shrink-0" />
              Em voz
            </p>
          ) : (
            <p className="text-xs text-mv-muted truncate">{profile.custom_status || `@${profile.username}`}</p>
          )}
        </div>
      </button>

      <div className="relative shrink-0" ref={micMenuRef}>
        <button
          title={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
          aria-label={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
          onClick={() => voice.toggleMute()}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
            voice.deafened || voice.muted ? 'text-rose-400 bg-rose-500/10 hover:bg-rose-500/20' : 'text-mv-muted hover:bg-white/[0.08] hover:text-white'
          }`}
        >
          <MicIcon muted={voice.deafened || voice.muted} className="w-5 h-5" />
        </button>
        <button
          title="Configurações de microfone"
          aria-label="Configurações de microfone"
          onClick={(e) => {
            e.stopPropagation()
            setMicMenuOpen((v) => !v)
          }}
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-mv-raised text-mv-muted hover:text-white hover:bg-mv-accent flex items-center justify-center ring-2 ring-[var(--color-elevated)] transition-colors"
        >
          <ChevronIcon className="w-2.5 h-2.5" />
        </button>
        {micMenuOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-56 surface-elevated rounded-xl animate-pop-in p-2 z-20">
            {voice.audioSettings.microphones.length > 0 && (
              <div className="mb-1.5">
                <p className="text-[10px] font-bold uppercase text-mv-muted px-1 mb-1">Microfone</p>
                <DeviceSelect
                  value={voice.audioSettings.micId}
                  options={voice.audioSettings.microphones}
                  onChange={(id) => void voice.changeMicrophone(id ?? '')}
                  className="w-full bg-mv-raised text-mv-text text-xs rounded px-2 py-1.5 outline-none"
                  ariaLabel="Microfone"
                />
              </div>
            )}
            <button
              onClick={() => {
                setMicMenuOpen(false)
                setShowSettings('audio')
              }}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-mv-raised text-mv-muted"
            >
              <GearIcon className="w-3.5 h-3.5 shrink-0" />
              Configurações de voz
            </button>
          </div>
        )}
      </div>

      <div className="relative shrink-0" ref={headphoneMenuRef}>
        <button
          title={voice.deafened ? 'Reativar áudio' : 'Desativar áudio'}
          aria-label={voice.deafened ? 'Reativar áudio' : 'Desativar áudio'}
          onClick={() => voice.toggleDeafen()}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
            voice.deafened ? 'text-rose-400 bg-rose-500/10 hover:bg-rose-500/20' : 'text-mv-muted hover:bg-white/[0.08] hover:text-white'
          }`}
        >
          <HeadphoneIcon off={voice.deafened} className="w-5 h-5" />
        </button>
        <button
          title="Configurações de áudio"
          aria-label="Configurações de áudio"
          onClick={(e) => {
            e.stopPropagation()
            setHeadphoneMenuOpen((v) => !v)
          }}
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-mv-raised text-mv-muted hover:text-white hover:bg-mv-accent flex items-center justify-center ring-2 ring-[var(--color-elevated)] transition-colors"
        >
          <ChevronIcon className="w-2.5 h-2.5" />
        </button>
        {headphoneMenuOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-56 surface-elevated rounded-xl animate-pop-in p-2 z-20">
            {voice.audioSettings.supportsOutputSelection && voice.audioSettings.speakers.length > 0 && (
              <div className="mb-1.5">
                <p className="text-[10px] font-bold uppercase text-mv-muted px-1 mb-1">Saída de áudio</p>
                <DeviceSelect
                  value={voice.audioSettings.speakerId}
                  options={voice.audioSettings.speakers}
                  onChange={(id) => voice.audioSettings.setSpeakerId(id)}
                  className="w-full bg-mv-raised text-mv-text text-xs rounded px-2 py-1.5 outline-none"
                  ariaLabel="Saída de áudio"
                />
              </div>
            )}
            <div className="mb-1">
              <p className="text-[10px] text-mv-muted px-1 mb-1.5">Volume geral: {voice.masterVolume}%</p>
              <RangeInput
                min={0}
                max={100}
                value={voice.masterVolume}
                onChange={(e) => voice.setMasterVolume(Number(e.target.value))}
                className="w-full accent-mv-accent px-1"
              />
            </div>
            <button
              onClick={() => {
                setHeadphoneMenuOpen(false)
                setShowSettings('audio')
              }}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-mv-raised text-mv-muted"
            >
              <GearIcon className="w-3.5 h-3.5 shrink-0" />
              Configurações de áudio
            </button>
          </div>
        )}
      </div>

      <button
        title="Configurações"
        aria-label="Configurações"
        onClick={() => setShowSettings('account')}
        className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/[0.08] text-mv-muted hover:text-white hover:rotate-45 transition-all duration-300 shrink-0"
      >
        <GearIcon className="w-5 h-5" />
      </button>

      {menuOpen && (
        <div className="absolute bottom-full left-2 mb-2 w-52 surface-elevated rounded-xl animate-pop-in py-1.5 z-20">
          <p className="px-3 pt-1 pb-1.5 text-xs font-bold uppercase text-mv-muted">Definir status</p>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                updateStatus(opt.value)
                setMenuOpen(false)
              }}
              className="w-full flex items-center gap-2.5 text-left px-3 py-1.5 text-sm text-mv-text hover:bg-white/5 transition-colors"
            >
              <span className={`w-2.5 h-2.5 rounded-full ${opt.dot}`} />
              {opt.label}
              {profile.status === opt.value && (
<CheckIcon className="w-3.5 h-3.5 ml-auto text-mv-accent" strokeWidth={2.5} aria-hidden />
              )}
            </button>
          ))}
          <div className="h-px bg-white/10 my-1.5" />
          <button
            onClick={() => {
              setShowEditProfile(true)
              setMenuOpen(false)
            }}
            className="w-full text-left px-3 py-2 text-sm text-mv-text hover:bg-white/5 transition-colors"
          >
            Editar perfil
          </button>
          <button
            onClick={signOut}
            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Sair da conta
          </button>
        </div>
      )}

      {showEditProfile && <EditProfileModal onClose={() => setShowEditProfile(false)} />}
      {showSettings && <SettingsModal initialTab={showSettings} onClose={() => setShowSettings(null)} />}
      </div>
      </div>
    </div>
  )
}
