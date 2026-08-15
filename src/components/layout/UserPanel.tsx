import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  if (!profile) return null

  return (
    <div className="relative h-[52px] bg-discord-darker/60 px-2 flex items-center gap-2 shrink-0">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 flex-1 min-w-0 px-1 py-1 rounded hover:bg-white/5 transition-colors"
      >
        <Avatar name={profile.username} avatarUrl={profile.avatar_url} status={profile.status} size={32} />
        <div className="min-w-0 text-left">
          <p className="text-sm font-medium text-white truncate">{profile.display_name || profile.username}</p>
          <p className="text-xs text-discord-text-muted truncate">
            {profile.custom_status || `@${profile.username}`}
          </p>
        </div>
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
        <div className="absolute bottom-full left-2 mb-2 w-52 bg-[#111214] rounded-md shadow-xl border border-black/40 py-1.5 z-20">
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
  )
}
