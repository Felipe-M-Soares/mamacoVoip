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
    const { error } = await createCategory(name.trim())
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  return (
    <Modal
      title="Criar categoria"
      description="Categorias agrupam canais na barra lateral."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary h-9 px-4 text-sm">
            {loading ? 'Criando...' : 'Criar categoria'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="create-category-name" className="field-label">
            Nome da categoria
          </label>
          <input
            id="create-category-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nova categoria"
            className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
          />
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
