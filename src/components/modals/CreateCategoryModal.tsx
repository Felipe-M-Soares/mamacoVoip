import { useState } from 'react'
import { Modal } from './Modal'
import { useChannels } from '../../hooks/useChannels'

export function CreateCategoryModal({ onClose }: { onClose: () => void }) {
  const { createCategory } = useChannels()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    setError(null)
    if (name.trim().length < 1) {
      setError('Dê um nome à categoria.')
      return
    }
    setLoading(true)
    const { error } = await createCategory(name.trim().toUpperCase())
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  return (
    <Modal title="Criar categoria" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Nome da categoria
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="NOVA CATEGORIA"
            className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors disabled:opacity-60"
        >
          {loading ? 'Criando...' : 'Criar categoria'}
        </button>
      </div>
    </Modal>
  )
}
