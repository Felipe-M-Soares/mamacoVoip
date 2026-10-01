import { useCallback, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useLocalVoiceConnectionQuality, useVoiceCore } from '../../hooks/useVoice'
import { useConnectionPing } from '../../hooks/useConnectionPing'
import { useVoiceMediaRtt } from '../../hooks/useVoiceMediaRtt'
import { describeMediaPath } from '../../lib/webrtcRtt'
import { useClickOutside } from '../../hooks/useClickOutside'
import { Avatar } from '../ui/Avatar'
import type { ProfileStatus } from '../../types/database'
import { lazyModal } from '../modals/lazyModal'
import { playDeafenSound, playUndeafenSound } from '../../lib/sounds'
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

// Modais/painéis carregados só quando abertos (fora do pacote inicial).
const EditProfileModal = lazyModal(() => import('../modals/EditProfileModal').then((m) => m.EditProfileModal))
const SettingsModal = lazyModal(() => import('../modals/SettingsModal').then((m) => m.SettingsModal))
const SoundboardPanel = lazyModal(() => import('../ui/SoundboardPanel').then((m) => m.SoundboardPanel))

const STATUS_OPTIONS: { value: ProfileStatus; label: string; dot: string }[] = [
  { value: 'online', label: 'Online', dot: 'bg-mv-green' },
  { value: 'idle', label: 'Ausente', dot: 'bg-yellow-500' },
  { value: 'dnd', label: 'Não perturbe', dot: 'bg-red-500' },
  { value: 'offline', label: 'Invisível', dot: 'bg-gray-500' },
]

// Ícone de barrinhas de sinal (tipo wifi/celular) — mesmos limiares de
// cor de antes (verde <100ms, amarelo <250ms, vermelho acima disso).
// Fica numa FAIXA PRÓPRIA acima do resto do painel (pedido explícito:
// "o ping tem que ser acima") em vez de espremida ao lado do nome — com
// texto "Xms" do lado, não só as barrinhas sozinhas.
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

// Ícone de "transmissão"/sinal em arcos — usado na fileira "Voz
// conectada", mesma ideia visual de referência que um app de chat popular usa ali
// (um ícone de conexão, não só uma bolinha).
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

// Um dos 4 botões quadrados da fileira de atalhos da call (câmera,
// compartilhar tela, soundboard, redução de ruído) — mesmo visual pra
// todos, só muda o ícone/estado "ativo".
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
      className={`h-8 rounded-lg flex items-center justify-center transition-colors ${
        active
          ? 'bg-mv-accent/20 text-mv-accent hover:bg-mv-accent/30'
          : 'bg-white/[0.06] text-mv-muted hover:bg-white/[0.1] hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

// Card de "jogando agora" — mostrado sempre que há um jogo detectado
// (useGamePresence.ts), em qualquer tela (servidor ou Início/DMs). Quando
// a pessoa também está numa chamada de voz, a legenda de baixo passa a
// indicar se aquele jogo está sendo compartilhado com a call ou não —
// mesma ideia da referência de apps de chat populares ("Não Compartilhando").
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

// Card "Voz conectada" + fileira de atalhos da call — igual a referência
// que a pessoa mandou (nome do canal + botão de desligar em cima,
// câmera/tela/soundboard/redução de ruído embaixo). Vive AQUI (dentro do
// UserPanel, que é universal) em vez de ficar preso à barra lateral de
// um servidor específico — assim continua aparecendo mesmo navegando
// pelo Início/DMs ou por outro servidor enquanto a call de outro
// servidor continua rolando, igual o apps de chat populares faz.
function VoiceHud() {
  const voice = useVoiceCore()
  const [showSoundboard, setShowSoundboard] = useState(false)

  if (!voice.connectedChannelId) return null

  function toggleNoiseSuppression() {
    const next = !voice.audioSettings.noiseSuppression
    voice.audioSettings.setNoiseSuppression(next)
    voice.refreshAudioConstraints({ noiseSuppression: next })
  }

  return (
    <div className="mx-2 mt-2 rounded-xl bg-mv-green/[0.07] border border-mv-green/20 overflow-hidden shrink-0">
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        {/* Clicar volta pra tela da sala (ex.: depois de abrir um canal de texto). */}
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
          className="min-w-0 flex-1 flex items-center gap-2.5 text-left rounded-lg -m-1 p-1 enabled:hover:bg-white/[0.05] transition-colors group/hud"
        >
          <BroadcastIcon className="w-4 h-4 text-mv-green shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-mv-green truncate leading-tight">Voz conectada</span>
            <span className="block text-sm text-mv-muted group-enabled/hud:group-hover/hud:text-mv-text group-enabled/hud:group-hover/hud:underline truncate leading-tight">
              {voice.connectedChannelName ?? '...'}
            </span>
          </span>
        </button>
        <button
          onClick={voice.leave}
          title="Desconectar"
          aria-label="Desconectar"
          className="w-8 h-8 rounded-full flex items-center justify-center text-mv-muted hover:bg-red-500/10 hover:text-red-400 transition-colors shrink-0"
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
        <HudSquareButton title="Soundboard" onClick={() => setShowSoundboard(true)}>
          <GridIcon className="w-4 h-4" />
        </HudSquareButton>
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
  // TRIGÉSIMA QUARTA RODADA — antes disso, a call era mesh (P2P direto
  // entre cada dupla de pessoas), então "latência da chamada" fazia
  // sentido como uma média das idas-e-voltas reais medidas com cada
  // peer (via WebRTC getStats()). Com o LiveKit (SFU), todo mundo fala
  // só com o servidor — não existe mais "latência até fulano", só a SUA
  // latência até o servidor de voz. `localConnectionQuality` (uma
  // classificação: ótima/boa/instável/perdida, não mais um número em
  // ms) é o que o LiveKit entrega — mapeada aqui pra um valor em ms
  // aproximado só pra reaproveitar o mesmo ícone de barrinhas
  // (WifiSignalIcon) sem precisar reescrevê-lo.
  const localConnectionQuality = useLocalVoiceConnectionQuality()
  // Durante a call: RTT REAL do WebRTC até o servidor de mídia (getStats,
  // par de candidatos em uso — docs/PING.md). Enquanto a 1ª medição não
  // chega, cai na classificação do LiveKit mapeada pra um ms aproximado.
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
  const [showSettings, setShowSettings] = useState(false)
  const [micMenuOpen, setMicMenuOpen] = useState(false)
  const [headphoneMenuOpen, setHeadphoneMenuOpen] = useState(false)

  // Clique fora fecha cada menu — ver comentário em useClickOutside.ts
  // sobre por que o onMouseLeave antigo fechava o menu cedo demais.
  const menuRef = useClickOutside<HTMLDivElement>(menuOpen, useCallback(() => setMenuOpen(false), []))
  const micMenuRef = useClickOutside<HTMLDivElement>(micMenuOpen, useCallback(() => setMicMenuOpen(false), []))
  const headphoneMenuRef = useClickOutside<HTMLDivElement>(headphoneMenuOpen, useCallback(() => setHeadphoneMenuOpen(false), []))

  if (!profile) return null

  return (
    <div className="shrink-0 p-2 bg-mv-canvas">
      <div className="rounded-2xl bg-[var(--color-elevated)] border border-[var(--color-line)] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7)]">
      {/* Faixa de ping — ACIMA do painel principal (pedido explícito),
          igual uma barra de status permanente. Sempre visível, não só
          durante uma call, pra sempre dar uma noção de conexão. */}
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

      {/* Mic: clique muta/desmuta na hora. A setinha fica ENCOSTADA no
          canto do próprio botão (não como um botão separado do lado) —
          isso é o que faltava de espaço em telas mais estreitas: dois
          botões lado a lado (ícone + seta) exigiam quase o dobro da
          largura, e com avatar+nome+mic+fone+engrenagem tudo na mesma
          fileira, não cabia numa sidebar de 240px — o layout quebrava e
          empurrava tudo pra baixo torto. Como um selinho no canto, a
          seta some do espaço da fileira mas continua clicável. */}
      <div className="relative shrink-0" ref={micMenuRef}>
        <button
          title={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
          aria-label={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
          onClick={voice.toggleMute}
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
                <select
                  value={voice.audioSettings.micId ?? ''}
                  onChange={(e) => voice.changeMicrophone(e.target.value)}
                  className="w-full bg-mv-raised text-mv-text text-xs rounded px-2 py-1.5 outline-none"
                >
                  {voice.audioSettings.microphones.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={() => {
                setMicMenuOpen(false)
                setShowSettings(true)
              }}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-mv-raised text-mv-muted"
            >
              <GearIcon className="w-3.5 h-3.5 shrink-0" />
              Configurações de voz
            </button>
          </div>
        )}
      </div>

      {/* Fone: mesma ideia do mic acima — botão único, seta em selinho no
          canto em vez de um segundo botão do lado. */}
      <div className="relative shrink-0" ref={headphoneMenuRef}>
        <button
          title={voice.deafened ? 'Reativar áudio' : 'Desativar áudio'}
          aria-label={voice.deafened ? 'Reativar áudio' : 'Desativar áudio'}
          onClick={() => {
            // O som de ensurdecer toca ANTES: toggleDeafen também muta o
            // microfone, e sounds.ts engole o som de mute nessa janela.
            if (voice.deafened) playUndeafenSound()
            else playDeafenSound()
            voice.toggleDeafen()
          }}
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
                <select
                  value={voice.audioSettings.speakerId ?? ''}
                  onChange={(e) => voice.audioSettings.setSpeakerId(e.target.value || null)}
                  className="w-full bg-mv-raised text-mv-text text-xs rounded px-2 py-1.5 outline-none"
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
              <p className="text-[10px] text-mv-muted px-1 mb-1.5">Volume geral: {voice.masterVolume}%</p>
              <input
                type="range"
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
                setShowSettings(true)
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
        onClick={() => setShowSettings(true)}
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
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </div>
      </div>
    </div>
  )
}
