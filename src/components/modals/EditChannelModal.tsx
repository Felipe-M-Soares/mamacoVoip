import { useState } from 'react'
import { Modal } from './Modal'
import { useChannels } from '../../hooks/useChannels'
import type { Channel } from '../../types/database'

export function EditChannelModal({
  channel,
  onClose,
}: {
  channel: Channel
  onClose: () => void
}) {
  const { updateChannel, deleteChannel } = useChannels()
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [isStage, setIsStage] = useState(channel.is_stage)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-')
    if (cleanName.length < 1) {
      setError('O nome não pode ficar vazio.')
      return
    }
    setLoading(true)
    const { error } = await updateChannel(channel.id, {
      name: cleanName,
      topic: topic.trim() || null,
      is_stage: channel.type === 'voice' ? isStage : channel.is_stage,
    })
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  async function handleDelete() {
    setLoading(true)
    const { error } = await deleteChannel(channel.id)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onClose()
  }

  if (confirmingDelete) {
    return (
      <Modal title={`Excluir canal '${channel.name}'`} onClose={onClose}>
        <p className="text-sm text-discord-text-muted">
          Tem certeza que deseja excluir{' '}
          <span className="text-white font-medium">
            {channel.type === 'text' ? '#' : '🔊 '}
            {channel.name}
          </span>
          ? Essa ação não pode ser desfeita.
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
            className="px-4 py-2 text-sm rounded btn-danger disabled:opacity-60"
          >
            {loading ? 'Excluindo...' : 'Excluir canal'}
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Editar canal" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
            Nome do canal
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-discord-text-muted">
              {channel.type === 'text' ? '#' : '🔊'}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full pl-8 pr-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
            />
          </div>
        </div>

        {channel.type === 'text' && (
          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Tópico do canal
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Uma frase curta descrevendo o assunto do canal (opcional)"
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple resize-none"
            />
          </div>
        )}

        {channel.type === 'voice' && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isStage}
              onChange={(e) => setIsStage(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-discord-blurple shrink-0"
            />
            <span className="text-xs text-discord-text-muted">
              <span className="text-discord-text font-medium">Canal Palco</span> — só donos/moderadores podem
              falar, o resto só escuta (bom pra anúncios, palestras, eventos)
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
        >
          {loading ? 'Salvando...' : 'Salvar alterações'}
        </button>

        <button
          onClick={() => setConfirmingDelete(true)}
          className="w-full py-2.5 rounded border border-red-600 text-red-500 font-medium hover:bg-red-600/10 transition-colors"
        >
          Excluir canal
        </button>
      </div>
    </Modal>
  )
}
