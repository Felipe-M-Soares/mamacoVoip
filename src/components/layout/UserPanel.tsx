import { useCallback, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useVoice } from '../../hooks/useVoice'
import { useConnectionPing } from '../../hooks/useConnectionPing'
import { useClickOutside } from '../../hooks/useClickOutside'
import { Avatar } from '../ui/Avatar'
import { EditProfileModal } from '../modals/EditProfileModal'
import { SettingsModal } from '../modals/SettingsModal'
import { SoundboardPanel } from '../ui/SoundboardPanel'
import type { ProfileStatus } from '../../types/database'

const STATUS_OPTIONS: { value: ProfileStatus; label: string; dot: string }[] = [
  { value: 'online', label: 'Online', dot: 'bg-discord-green' },
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
      ? 'text-discord-green'
      : tier === 'ok'
        ? 'text-yellow-500'
        : tier === 'bad'
          ? 'text-red-500'
          : 'text-discord-text-muted/40'
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
// conectada", mesma ideia visual de referência que o Discord usa ali
// (um ícone de conexão, não só uma bolinha).
function BroadcastIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M5.8 5.8a9 9 0 0 0 0 12.4" strokeOpacity="0.55" />
      <path d="M18.2 5.8a9 9 0 0 1 0 12.4" strokeOpacity="0.55" />
    </svg>
  )
}

function PhoneHangupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 8.5c-2.9 0-5.6.7-8 2v3.2c0 .6.4 1.1.9 1.3 1.2.4 2.4.7 3.6.9.5.1.9-.1 1.2-.5l1-1.5c.2-.3.6-.5 1-.4 1.5.4 2.9.4 4.4 0 .4-.1.8.1 1 .4l1 1.5c.3.4.7.6 1.2.5 1.2-.2 2.4-.5 3.6-.9.5-.2.9-.7.9-1.3v-3.2c-2.4-1.3-5.1-2-8-2H12z" />
    </svg>
  )
}

function CameraIcon({ off, className }: { off?: boolean; className?: string }) {
  if (off) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M17 10.5V7a1 1 0 0 0-1-1H6.4M4 6.4A1 1 0 0 0 3 7v10a1 1 0 0 0 1 1h9.6M17 13.5v3a1 1 0 0 1-1 1H8m9-4v-.5l4-4v11l-4-4"
          fill="currentColor"
          fillOpacity="0"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M2.5 2.5l19 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
  )
}

function ScreenShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
    </svg>
  )
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  )
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11 2a1 1 0 0 1 1 1c0 4.4 2.6 7 7 7a1 1 0 1 1 0 2c-4.4 0-7 2.6-7 7a1 1 0 1 1-2 0c0-4.4-2.6-7-7-7a1 1 0 1 1 0-2c4.4 0 7-2.6 7-7a1 1 0 0 1 1-1z" />
    </svg>
  )
}

function MicIcon({ muted, className }: { muted?: boolean; className?: string }) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-8.6 3.5L18 5A1 1 0 1 0 16.6 3.6L3.6 16.6A1 1 0 1 0 5 18l2-2A7 7 0 0 0 19 11zM12 15a3 3 0 0 0 3-3l-5.7 5.7A3 3 0 0 0 12 15zM9 6a3 3 0 0 1 6 0v3.5l2-2V6a5 5 0 0 0-9.9-1L9 6.6V6z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
    </svg>
  )
}

function HeadphoneIcon({ off, className }: { off?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 3a9 9 0 0 0-9 9v6a2 2 0 0 0 2 2h2v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h2a2 2 0 0 0 2-2v-6a9 9 0 0 0-9-9z" />
      {off && <path d="M2.5 2.5l19 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  )
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6l-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M7 10l5 5 5-5z" />
    </svg>
  )
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
      className={`aspect-square rounded-md flex items-center justify-center transition-colors ${
        active
          ? 'bg-discord-blurple/20 text-discord-blurple hover:bg-discord-blurple/30'
          : 'bg-discord-lighter/70 text-discord-text-muted hover:bg-discord-lighter hover:text-white'
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
// mesma ideia da referência do Discord ("Não Compartilhando").
export function PlayingActivityCard() {
  const { profile } = useAuth()
  const voice = useVoice()
  if (!profile?.playing) return null

  const subtitle = voice.connectedChannelId
    ? voice.screenSharing
      ? 'Compartilhando tela'
      : 'Não compartilhando'
    : 'Jogando agora'

  return (
    <div className="mx-2 mt-2 px-3 py-2 rounded-lg bg-discord-darker/60 flex items-center gap-2.5 shrink-0">
      <span className="text-base shrink-0">🎮</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white truncate leading-tight">{profile.playing}</p>
        <p className="text-[11px] text-discord-text-muted truncate leading-tight">{subtitle}</p>
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
// servidor continua rolando, igual o Discord de verdade faz.
function VoiceHud() {
  const voice = useVoice()
  const [showSoundboard, setShowSoundboard] = useState(false)

  if (!voice.connectedChannelId) return null

  function toggleNoiseSuppression() {
    const next = !voice.audioSettings.noiseSuppression
    voice.audioSettings.setNoiseSuppression(next)
    voice.refreshAudioConstraints({ noiseSuppression: next })
  }

  return (
    <div className="mx-2 mt-2 rounded-lg bg-discord-darker/60 overflow-hidden shrink-0">
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <BroadcastIcon className="w-4 h-4 text-discord-green shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-discord-green truncate leading-tight">Voz conectada</p>
          <p className="text-sm text-discord-text-muted truncate leading-tight">{voice.connectedChannelName ?? '...'}</p>
        </div>
        <button
          onClick={voice.leave}
          title="Desconectar"
          aria-label="Desconectar"
          className="w-8 h-8 rounded-full flex items-center justify-center text-discord-text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors shrink-0"
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
  const voice = useVoice()
  const apiPingMs = useConnectionPing()
  // Enquanto estiver numa call com pelo menos uma outra pessoa, prefere
  // a latência REAL medida pela própria conexão de voz (voice.connectionQuality
  // — round-trip de verdade até quem está na call, via WebRTC getStats(),
  // já existia mas não tinha lugar nenhum na UI) em vez da latência até
  // o servidor do banco de dados, que não tem relação com o atraso que
  // você ouve na voz dos outros.
  const callRttValues = Object.values(voice.connectionQuality)
  const callRttMs =
    voice.connectedChannelId && callRttValues.length > 0
      ? Math.round(callRttValues.reduce((a, b) => a + b, 0) / callRttValues.length)
      : null
  const pingMs = callRttMs ?? apiPingMs
  const pingLabel =
    pingMs === null ? 'Medindo sua conexão...' : callRttMs !== null ? `${pingMs}ms de latência na chamada` : `${pingMs}ms até o servidor`
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
    <div className="shrink-0">
      {/* Faixa de ping — ACIMA do painel principal (pedido explícito),
          igual uma barra de status permanente. Sempre visível, não só
          durante uma call, pra sempre dar uma noção de conexão. */}
      <div
        title={pingLabel}
        className="h-6 px-3 flex items-center gap-1.5 bg-discord-darker/40 border-t border-black/10"
      >
        <WifiSignalIcon pingMs={pingMs} size={12} />
        <span className="text-[10px] text-discord-text-muted truncate">
          {pingMs === null ? 'Medindo conexão...' : `${pingMs}ms`}
        </span>
      </div>

      <PlayingActivityCard />
      <VoiceHud />

      <div className="relative h-16 bg-discord-darker/60 px-3 flex items-center gap-2 border-t border-black/10 mt-2" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2.5 flex-1 min-w-0 px-1.5 py-1.5 rounded hover:bg-white/5 transition-colors"
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
            <p className="flex items-center gap-1 text-xs text-discord-green truncate">
              <BroadcastIcon className="w-3 h-3 shrink-0" />
              Em voz
            </p>
          ) : (
            <p className="text-xs text-discord-text-muted truncate">{profile.custom_status || `@${profile.username}`}</p>
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
          className={`w-9 h-9 rounded flex items-center justify-center transition-colors ${
            voice.deafened || voice.muted ? 'text-red-400 hover:bg-white/10' : 'text-discord-text-muted hover:bg-white/10 hover:text-white'
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
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-discord-darker text-discord-text-muted hover:text-white flex items-center justify-center ring-2 ring-discord-darker"
        >
          <ChevronIcon className="w-2.5 h-2.5" />
        </button>
        {micMenuOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-56 bg-discord-darker rounded-lg shadow-xl border border-black/40 p-2 z-20">
            {voice.audioSettings.microphones.length > 0 && (
              <div className="mb-1.5">
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
            <button
              onClick={() => {
                setMicMenuOpen(false)
                setShowSettings(true)
              }}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-discord-lighter text-discord-text-muted"
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
          onClick={voice.toggleDeafen}
          className={`w-9 h-9 rounded flex items-center justify-center transition-colors ${
            voice.deafened ? 'text-red-400 hover:bg-white/10' : 'text-discord-text-muted hover:bg-white/10 hover:text-white'
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
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-discord-darker text-discord-text-muted hover:text-white flex items-center justify-center ring-2 ring-discord-darker"
        >
          <ChevronIcon className="w-2.5 h-2.5" />
        </button>
        {headphoneMenuOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-56 bg-discord-darker rounded-lg shadow-xl border border-black/40 p-2 z-20">
            {voice.audioSettings.supportsOutputSelection && voice.audioSettings.speakers.length > 0 && (
              <div className="mb-1.5">
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
              onClick={() => {
                setHeadphoneMenuOpen(false)
                setShowSettings(true)
              }}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-discord-lighter text-discord-text-muted"
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
        className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 text-discord-text-muted hover:text-white transition-colors shrink-0"
      >
        <GearIcon className="w-5 h-5" />
      </button>

      {menuOpen && (
        <div className="absolute bottom-full left-2 mb-2 w-52 bg-discord-darker rounded-md shadow-xl border border-black/40 py-1.5 z-20">
          <p className="px-3 pt-1 pb-1.5 text-xs font-bold uppercase text-discord-text-muted">Definir status</p>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                updateStatus(opt.value)
                setMenuOpen(false)
              }}
              className="w-full flex items-center gap-2.5 text-left px-3 py-1.5 text-sm text-discord-text hover:bg-white/5 transition-colors"
            >
              <span className={`w-2.5 h-2.5 rounded-full ${opt.dot}`} />
              {opt.label}
              {profile.status === opt.value && (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 ml-auto text-discord-blurple">
                  <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
                </svg>
              )}
            </button>
          ))}
          <div className="h-px bg-white/10 my-1.5" />
          <button
            onClick={() => {
              setShowEditProfile(true)
              setMenuOpen(false)
            }}
            className="w-full text-left px-3 py-2 text-sm text-discord-text hover:bg-white/5 transition-colors"
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
  )
}
