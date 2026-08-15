import { useState } from 'react'
import { Modal } from './Modal'
import { useServers } from '../../hooks/useServers'

export function LeaveServerModal({
  serverId,
  serverName,
  onClose,
  onLeft,
}: {
  serverId: string
  serverName: string
  onClose: () => void
  onLeft: () => void
}) {
  const { leaveServer } = useServers()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLeave() {
    setLoading(true)
    const { error } = await leaveServer(serverId)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onLeft()
  }

  return (
    <Modal title={`Sair de '${serverName}'`} onClose={onClose}>
      <p className="text-sm text-discord-text-muted">
        Tem certeza que deseja sair de <span className="text-white font-medium">{serverName}</span>? Você vai
        precisar de um novo convite para entrar de novo.
      </p>
      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
      <div className="flex justify-end gap-3 mt-5">
        <button onClick={onClose} className="px-4 py-2 text-sm text-discord-text-muted hover:underline">
          Cancelar
        </button>
        <button
          onClick={handleLeave}
          disabled={loading}
          className="px-4 py-2 text-sm rounded bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
        >
          {loading ? 'Saindo...' : 'Sair do servidor'}
        </button>
      </div>
    </Modal>
  )
}
