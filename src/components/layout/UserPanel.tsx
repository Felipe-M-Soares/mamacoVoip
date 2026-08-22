import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useVoice } from '../../hooks/useVoice'
import { useConnectionPing } from '../../hooks/useConnectionPing'
import { Avatar } from '../ui/Avatar'
import { EditProfileModal } from '../modals/EditProfileModal'
import { SettingsModal } from '../modals/SettingsModal'
import type { ProfileStatus } from '../../types/database'

const STATUS_OPTIONS: { value: ProfileStatus; label: string; dot: string }[] = [
  { value: 'online', label: 'Online', dot: 'bg-discord-green' },
  { value: 'idle', label: 'Ausente', dot: 'bg-yellow-500' },
  { value: 'dnd', label: 'Não perturbe', dot: 'bg-red-500' },
  { value: 'offline', label: 'Invisível', dot: 'bg-gray-500' },
]

export function UserPanel() {
  const { profile, signOut, updateStatus } = useAuth()
  const voice = useVoice()
  const pingMs = useConnectionPing()
  const [menuOpen, setMenuOpen] = useState(false)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  if (!profile) return null

  return (
    <div className="shrink-0">
      {pingMs !== null && (
        <div className="h-5 px-3 flex items-center gap-1.5 bg-discord-darker/60 border-t border-black/20">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              pingMs < 100 ? 'bg-discord-green' : pingMs < 250 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
          />
          <span className="text-[10px] text-discord-text-muted font-mono">{pingMs}ms</span>
        </div>
      )}
      <div className="relative h-[52px] bg-discord-darker/60 px-2 flex items-center gap-1">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 flex-1 min-w-0 px-1 py-1 rounded hover:bg-white/5 transition-colors"
      >
        <Avatar name={profile.username} avatarUrl={profile.avatar_url} status={profile.status} userId={profile.id} size={32} />
        <div className="min-w-0 text-left">
          <p className="text-sm font-medium text-white truncate">{profile.display_name || profile.username}</p>
          <p className="text-xs text-discord-text-muted truncate">
            {profile.playing ? `🎮 Jogando ${profile.playing}` : profile.custom_status || `@${profile.username}`}
          </p>
        </div>
      </button>

      <div className="relative shrink-0">
        <button
          title="Volume geral"
          onClick={() => setVolumeOpen((v) => !v)}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-discord-text-muted hover:text-white transition-colors"
        >
          {voice.masterVolume === 0 ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M3 10v4h4l5 5V5L7 10H3zm12.3-1.7a1 1 0 0 1 1.4 0L18 9.6l1.3-1.3a1 1 0 1 1 1.4 1.4L19.4 11l1.3 1.3a1 1 0 0 1-1.4 1.4L18 12.4l-1.3 1.3a1 1 0 0 1-1.4-1.4l1.3-1.3-1.3-1.3a1 1 0 0 1 0-1.4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8zM15 3.2v2.1c2.9.9 5 3.6 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8z" />
            </svg>
          )}
        </button>
        {volumeOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-40 bg-discord-darker rounded-md shadow-xl border border-black/40 p-3 z-20">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-bold uppercase text-discord-text-muted">Volume geral</p>
              <span className="text-xs text-discord-text-muted">{voice.masterVolume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={voice.masterVolume}
              onChange={(e) => voice.setMasterVolume(Number(e.target.value))}
              className="w-full accent-discord-blurple"
            />
            <p className="text-[10px] text-discord-text-muted mt-1.5">
              Afeta o volume de todos que você ouve em canais de voz.
            </p>
          </div>
        )}
      </div>

      {/* Botão de mutar o microfone — antes esse lugar era o atalho pra
          redutor de ruído, mas junto com o mic da barra de voz
          (VoiceChannelView) e o que existia na barra "Voz conectada" da
          sidebar (removido), virava um terceiro controle fazendo a MESMA
          coisa que o mic principal, só que sem ser um. Confundia mais do
          que ajudava — aqui do lado do perfil é onde o Discord de
          verdade coloca o botão de mutar, então virou isso mesmo. O
          redutor de ruído continua em Configurações → Áudio. Lê/escreve
          voice.muted/voice.toggleMute, o mesmo estado compartilhado do
          botão na barra de voz — mutar em um já reflete no outro
          sozinho, sem nada extra pra sincronizar. */}
      <button
        title={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
        onClick={voice.toggleMute}
        className={`w-8 h-8 flex items-center justify-center rounded transition-colors shrink-0 ${
          !voice.connectedChannelId ? 'opacity-40' : ''
        } ${voice.muted ? 'text-red-400 hover:bg-white/10' : 'text-discord-text-muted hover:bg-white/10 hover:text-white'}`}
      >
        {voice.muted ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-8.6 3.5L18 5A1 1 0 1 0 16.6 3.6L3.6 16.6A1 1 0 1 0 5 18l2-2A7 7 0 0 0 19 11zM12 15a3 3 0 0 0 3-3l-5.7 5.7A3 3 0 0 0 12 15zM9 6a3 3 0 0 1 6 0v3.5l2-2V6a5 5 0 0 0-9.9-1L9 6.6V6z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
          </svg>
        )}
      </button>

      <button
        title="Configurações"
        onClick={() => setShowSettings(true)}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-discord-text-muted hover:text-white transition-colors shrink-0"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6l-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
        </svg>
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
