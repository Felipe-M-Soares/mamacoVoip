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
    <Modal
      title={`Sair de '${serverName}'`}
      onClose={onClose}
      maxWidth="max-w-sm"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
            Cancelar
          </button>
          <button onClick={handleLeave} disabled={loading} className="btn-danger h-9 px-4 text-sm">
            {loading ? 'Saindo...' : 'Sair do servidor'}
          </button>
        </>
      }
    >
      <p className="text-[14px] text-discord-text-muted leading-relaxed">
        Tem certeza que deseja sair de <span className="text-white font-medium">{serverName}</span>? Você vai
        precisar de um novo convite para entrar de novo.
      </p>
      {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}
    </Modal>
  )
}
