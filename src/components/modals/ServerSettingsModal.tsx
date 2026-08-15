import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { useServers } from '../../hooks/useServers'
import type { Server } from '../../types/database'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function ServerSettingsModal({
  server,
  isOwner,
  onClose,
  onDeleted,
}: {
  server: Server
  isOwner: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  const { updateServer, deleteServer } = useServers()
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description ?? '')
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(server.icon_url)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setIconFile(file)
    setIconPreview(URL.createObjectURL(file))
  }

  async function handleSave() {
    setError(null)
    if (description.length > 300) {
      setError('A descrição pode ter no máximo 300 caracteres.')
      return
    }
    setLoading(true)
    const { error } = await updateServer(server.id, { name, description: description.trim() || null, iconFile })
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  async function handleDelete() {
    setLoading(true)
    const { error } = await deleteServer(server.id)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onDeleted()
  }

  if (confirmingDelete) {
    return (
      <Modal title={`Excluir '${server.name}'`} onClose={onClose}>
        <p className="text-sm text-discord-text-muted">
          Tem certeza que deseja excluir <span className="text-white font-medium">{server.name}</span>? Essa ação
          não pode ser desfeita — todos os canais e mensagens serão perdidos.
        </p>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button
            onClick={() => setConfirmingDelete(false)}
            className="px-4 py-2 text-sm text-discord-text-muted hover:underline"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="px-4 py-2 text-sm rounded bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {loading ? 'Excluindo...' : 'Excluir servidor'}
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Configurações do servidor" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex justify-center">
          <button
            onClick={() => isOwner && fileInputRef.current?.click()}
            className={`w-20 h-20 rounded-full bg-discord-darker border-2 border-dashed border-discord-text-muted flex items-center justify-center overflow-hidden ${
              isOwner ? 'hover:border-discord-blurple transition-colors' : 'cursor-not-allowed opacity-70'
            }`}
          >
            {iconPreview ? (
              <img src={iconPreview} alt="Ícone" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-discord-text-muted text-center px-2">Sem ícone</span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleIconChange}
            disabled={!isOwner}
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Nome do servidor
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple disabled:opacity-60"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label className="block text-xs font-bold uppercase text-discord-text-muted">
              Descrição
            </label>
            <span className="text-xs text-discord-text-muted">{description.length}/300</span>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!isOwner}
            maxLength={300}
            rows={3}
            placeholder="Do que se trata este servidor?"
            className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple disabled:opacity-60 resize-none"
          />
        </div>

        <div className="bg-discord-darker rounded-lg p-3 text-xs text-discord-text-muted">
          Servidor criado em {formatDate(server.created_at)}
        </div>

        {!isOwner && (
          <p className="text-xs text-discord-text-muted">
            Só o dono do servidor pode alterar nome, descrição e ícone.
          </p>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {isOwner && (
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors disabled:opacity-60"
          >
            {loading ? 'Salvando...' : 'Salvar alterações'}
          </button>
        )}

        {isOwner && (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="w-full py-2.5 rounded border border-red-600 text-red-500 font-medium hover:bg-red-600/10 transition-colors"
          >
            Excluir servidor
          </button>
        )}
      </div>
    </Modal>
  )
}
