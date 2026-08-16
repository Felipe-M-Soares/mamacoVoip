import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { useAuth } from '../../hooks/useAuth'

export function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, updateProfile } = useAuth()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? profile?.username ?? '')
  const [customStatus, setCustomStatus] = useState(profile?.custom_status ?? '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.avatar_url ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  async function handleSave() {
    setError(null)
    setLoading(true)
    const { error } = await updateProfile(
      { display_name: displayName.trim() || undefined, custom_status: customStatus.trim() || null },
      avatarFile
    )
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  return (
    <Modal title="Editar perfil" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex justify-center">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-20 h-20 rounded-full bg-discord-darker border-2 border-dashed border-discord-text-muted flex items-center justify-center overflow-hidden hover:border-discord-blurple transition-colors"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-discord-text-muted text-center px-2">Enviar foto</span>
            )}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Nome de exibição
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Status personalizado
          </label>
          <input
            type="text"
            value={customStatus}
            onChange={(e) => setCustomStatus(e.target.value)}
            placeholder="O que você está pensando?"
            maxLength={100}
            className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
        >
          {loading ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </Modal>
  )
}
