import { useState } from 'react'
import { Modal } from './Modal'
import { useChannels } from '../../hooks/useChannels'
import type { Category, ChannelType } from '../../types/database'

export function CreateChannelModal({
  serverId,
  categories,
  defaultCategoryId,
  onClose,
}: {
  serverId: string
  categories: Category[]
  defaultCategoryId?: string | null
  onClose: () => void
}) {
  const { createChannel } = useChannels(serverId)
  const [name, setName] = useState('')
  const [type, setType] = useState<ChannelType>('text')
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    setError(null)
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-')
    if (cleanName.length < 1) {
      setError('Dê um nome ao canal.')
      return
    }
    setLoading(true)
    const { error } = await createChannel(cleanName, type, categoryId || null)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  return (
    <Modal title="Criar canal" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Tipo de canal</label>
          <div className="space-y-2">
            <button
              onClick={() => setType('text')}
              className={`w-full flex items-center gap-3 p-3 rounded border transition-colors text-left ${
                type === 'text'
                  ? 'border-discord-blurple bg-discord-blurple/10'
                  : 'border-transparent bg-discord-darker hover:bg-discord-lighter'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted shrink-0">
                <path d="M5.5 4.5c.5-.5 1.2-.8 2-.8h1.4l-.3 15h-1c-.8 0-1.5-.3-2-.8-.6-.5-.9-1.2-.9-2v-9.4c0-.8.3-1.5.8-2zm10 0c.5.5.8 1.2.8 2v9.4c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8h-1l-.3-15h1.4c.8 0 1.5.3 2 .8z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-white">Texto</p>
                <p className="text-xs text-discord-text-muted">Enviar mensagens, imagens e links</p>
              </div>
            </button>
            <button
              onClick={() => setType('voice')}
              className={`w-full flex items-center gap-3 p-3 rounded border transition-colors text-left ${
                type === 'voice'
                  ? 'border-discord-blurple bg-discord-blurple/10'
                  : 'border-transparent bg-discord-darker hover:bg-discord-lighter'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted shrink-0">
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-white">Voz</p>
                <p className="text-xs text-discord-text-muted">Conversar por voz e vídeo</p>
              </div>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Nome do canal</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-discord-text-muted">
              {type === 'text' ? '#' : '🔊'}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="novo-canal"
              className="w-full pl-8 pr-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            />
          </div>
        </div>

        {categories.length > 0 && (
          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Categoria</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            >
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:bg-indigo-600 transition-colors disabled:opacity-60"
        >
          {loading ? 'Criando...' : 'Criar canal'}
        </button>
      </div>
    </Modal>
  )
}
