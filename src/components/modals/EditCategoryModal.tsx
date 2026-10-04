import { useState } from 'react'
import { Modal } from './Modal'
import { useChannels } from '../../hooks/useChannels'
import type { Category } from '../../types/database'

// Editar (renomear) ou excluir uma categoria da barra de canais.
export function EditCategoryModal({
  category,
  startDeleting = false,
  onClose,
}: {
  category: Category
  startDeleting?: boolean
  onClose: () => void
}) {
  const { updateCategory, deleteCategory, channels } = useChannels()
  const [name, setName] = useState(category.name)
  const [confirmingDelete, setConfirmingDelete] = useState(startDeleting)
  const [alsoChannels, setAlsoChannels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inside = channels.filter((c) => c.category_id === category.id)

  async function handleSave() {
    setError(null)
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 100)
    if (!clean) {
      setError('Dê um nome à categoria.')
      return
    }
    setLoading(true)
    const { error } = await updateCategory(category.id, clean)
    setLoading(false)
    if (error) setError(error)
    else onClose()
  }

  async function handleDelete() {
    setError(null)
    setLoading(true)
    const { error } = await deleteCategory(category.id, alsoChannels)
    setLoading(false)
    if (error) setError(error)
    else onClose()
  }

  if (confirmingDelete) {
    return (
      <Modal
        title={`Excluir categoria '${category.name}'`}
        onClose={onClose}
        maxWidth="max-w-sm"
        footer={
          <>
            <button onClick={() => setConfirmingDelete(false)} className="btn-secondary h-9 px-4 text-sm">
              Cancelar
            </button>
            <button onClick={handleDelete} disabled={loading} className="btn-danger h-9 px-4 text-sm">
              {loading ? 'Excluindo...' : 'Excluir categoria'}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-[13.5px] text-mv-muted">
          {inside.length === 0 ? (
            <p>A categoria está vazia. Isso não pode ser desfeito.</p>
          ) : (
            <>
              <p>
                {alsoChannels
                  ? `Os ${inside.length} canais dela também serão excluídos, com todas as mensagens. Isso não pode ser desfeito.`
                  : `Os ${inside.length} canais dela continuam no servidor, só que sem categoria.`}
              </p>
              <label className="flex items-start gap-2 cursor-pointer text-mv-text">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-rose-500"
                  checked={alsoChannels}
                  onChange={(e) => setAlsoChannels(e.target.checked)}
                />
                <span>Excluir também os canais dela</span>
              </label>
            </>
          )}
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Editar categoria"
      onClose={onClose}
      footer={
        <>
          <button onClick={() => setConfirmingDelete(true)} className="btn-danger h-9 px-4 text-sm mr-auto">
            Excluir
          </button>
          <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading} className="btn-primary h-9 px-4 text-sm">
            {loading ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="edit-category-name" className="field-label">
            Nome da categoria
          </label>
          <input
            id="edit-category-name"
            type="text"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave()
            }}
            className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none"
          />
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
